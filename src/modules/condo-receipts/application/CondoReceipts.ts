import { DomainError } from '@/core/errors';
import type { IExchangeRateService } from '@/core/domain/ports/IExchangeRateService';
import type { IBuildingRepository, IBuildingPaymentInfoRepository, IUnitRepository } from '@/modules/buildings/domain/repository';
import type { IChargeConceptRepository, IInvoiceRepository } from '@/modules/billing/domain/repository';
import { ChargeConcept, ChargeConceptKind, ChargeDistribution } from '@/modules/billing/domain/entities/ChargeConcept';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { calculateReceipt, lineShare, type ExpenseCurrency } from '../domain/ReceiptCalculator';
import { compareCodes, RESERVE_FUND_CODE, STANDARD_EXPENSE_CODES } from '../domain/StandardExpenseCodes';
import type { ExpenseInvoiceFile, ICondoReceiptRepository, IExpenseInvoiceStorage, MonthlyExpense } from '../domain/repository';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CONCEPT_NAME = 'Condominio';
const RESERVE_LABEL = 'FONDO DE RESERVA';

function assertPeriod(period: string) {
    if (!PERIOD_PATTERN.test(period)) throw new DomainError('Period must be YYYY-MM', 'VALIDATION_ERROR', 400);
}

const notFound = (what: string) => new DomainError(`${what} not found`, 'NOT_FOUND', 404);

export interface AddExpenseDTO {
    buildingId: string;
    period: string;
    codeId: string;
    detail?: string;
    amount: number;
    currency: ExpenseCurrency;
    expenseDate?: string;
    file?: ExpenseInvoiceFile;
    userId: string;
}

export interface GenerateReceiptDTO {
    buildingId: string;
    period: string;
    reservePercent: number;
    /** YYYY-MM-DD of the rate to apply; defaults to today. */
    rateDate?: string;
    dueDate?: Date;
    userId: string;
}

/**
 * The monthly condominium receipt: expenses of the period (with their invoice
 * files) and, at month end, the receipt that bills every unit by aliquot.
 * A generated receipt closes its period until it is voided.
 */
export class CondoReceipts {
    constructor(
        private repo: ICondoReceiptRepository,
        private storage: IExpenseInvoiceStorage,
        private deps: {
            buildingRepo: Pick<IBuildingRepository, 'findById'>;
            unitRepo: Pick<IUnitRepository, 'findByBuildingId'>;
            conceptRepo: Pick<IChargeConceptRepository, 'findByBuildingId' | 'create'>;
            invoiceRepo: Pick<IInvoiceRepository, 'findAll' | 'createBatch' | 'update'>;
            paymentInfoRepo: Pick<IBuildingPaymentInfoRepository, 'find'>;
            exchangeRates: Pick<IExchangeRateService, 'getRatesForDate'>;
        }
    ) { }

    // ── Expense codes ─────────────────────────────────────────────────────────

    async listCodes(buildingId: string) {
        return (await this.repo.listCodes(buildingId)).sort((a, b) => compareCodes(a.code, b.code));
    }

    /** Adds the standard catalog's codes the building does not have yet. Returns the full catalog. */
    async loadStandardCodes(buildingId: string) {
        const existing = new Set((await this.repo.listCodes(buildingId)).map(c => c.code));
        await this.repo.createCodes(
            STANDARD_EXPENSE_CODES.filter(c => !existing.has(c.code)).map(c => ({ building_id: buildingId, ...c }))
        );
        return this.listCodes(buildingId);
    }

    async createCode(buildingId: string, code: string, description: string) {
        code = code.trim();
        description = description.trim().toUpperCase();
        if (!code || !description) throw new DomainError('Code and description are required', 'VALIDATION_ERROR', 400);
        if (code === RESERVE_FUND_CODE) {
            throw new DomainError(`Code ${code} is reserved for the reserve fund line the receipt adds by itself`, 'VALIDATION_ERROR', 400);
        }
        return this.repo.createCode({ building_id: buildingId, code, description });
    }

    // ── Expenses of the month ─────────────────────────────────────────────────

    async listExpenses(buildingId: string, period: string) {
        assertPeriod(period);
        const [expenses, receipt] = await Promise.all([
            this.repo.listExpenses(buildingId, period),
            this.repo.findReceipt(buildingId, period),
        ]);
        const urls = await this.storage.signedUrls(expenses.flatMap(e => (e.invoice_path ? [e.invoice_path] : [])));
        return {
            period,
            closed: receipt !== null,
            totals: totalsByCurrency(expenses),
            expenses: expenses.map(({ invoice_path, ...e }) => ({
                ...e,
                invoice_url: invoice_path ? urls[invoice_path] ?? null : null,
            })),
        };
    }

    async addExpense(dto: AddExpenseDTO) {
        assertPeriod(dto.period);
        if (!(dto.amount > 0)) throw new DomainError('Amount must be greater than 0', 'VALIDATION_ERROR', 400);
        await this.assertOpen(dto.buildingId, dto.period);

        const code = await this.repo.findCode(dto.codeId);
        if (!code || code.building_id !== dto.buildingId) throw notFound('Expense code');

        const invoicePath = dto.file ? await this.storage.upload(dto.buildingId, dto.period, dto.file) : null;
        try {
            return await this.repo.createExpense({
                building_id: dto.buildingId,
                period: dto.period,
                code_id: code.id,
                detail: dto.detail?.trim() || null,
                amount: Math.round(dto.amount * 100) / 100,
                currency: dto.currency,
                expense_date: dto.expenseDate ?? new Date().toISOString().slice(0, 10),
                invoice_path: invoicePath,
                created_by: dto.userId,
            });
        } catch (error) {
            if (invoicePath) await this.storage.remove(invoicePath).catch(() => { });
            throw error;
        }
    }

    async deleteExpense(buildingId: string, expenseId: string) {
        const expense = await this.repo.findExpense(expenseId);
        if (!expense || expense.building_id !== buildingId) throw notFound('Expense');
        await this.assertOpen(buildingId, expense.period);
        await this.repo.deleteExpense(expense.id);
        // ponytail: a failed file delete leaves an orphan file; the bucket is cleaned up with old periods anyway.
        if (expense.invoice_path) await this.storage.remove(expense.invoice_path).catch(() => { });
    }

    // ── Receipts ──────────────────────────────────────────────────────────────

    listReceipts(buildingId: string) {
        return this.repo.listReceipts(buildingId);
    }

    async getReceipt(buildingId: string, period: string) {
        assertPeriod(period);
        const receipt = await this.repo.findReceipt(buildingId, period);
        if (!receipt) throw notFound('Receipt');
        return receipt;
    }

    async generate(dto: GenerateReceiptDTO) {
        assertPeriod(dto.period);
        if (await this.repo.findReceipt(dto.buildingId, dto.period)) {
            throw new DomainError(`The receipt for ${dto.period} was already generated`, 'CONFLICT', 409);
        }

        const building = await this.deps.buildingRepo.findById(dto.buildingId);
        if (!building) throw notFound('Building');

        const concept = await this.condoConcept(dto.buildingId);
        const billed = (await this.deps.invoiceRepo.findAll({ concept_id: concept.id, period: dto.period }))
            .filter(inv => inv.status !== InvoiceStatus.CANCELLED);
        if (billed.length > 0) {
            throw new DomainError(`"${CONCEPT_NAME}" was already billed for ${dto.period} (${billed.length} invoices)`, 'CONFLICT', 409);
        }

        const rateDate = dto.rateDate ?? new Date().toISOString().slice(0, 10);
        const rateSource = building.default_rate_source;
        const rate = (await this.deps.exchangeRates.getRatesForDate(rateDate)).rates[rateSource];
        if (!rate) {
            throw new DomainError(`No ${rateSource} rate available for ${rateDate}`, 'EXCHANGE_RATE_UNAVAILABLE', 503);
        }

        const [expenses, units] = await Promise.all([
            this.repo.listExpenses(dto.buildingId, dto.period),
            this.deps.unitRepo.findByBuildingId(dto.buildingId),
        ]);

        const calculated = calculateReceipt({
            period: dto.period,
            expenses: expenses.map(e => ({ code: e.code, description: e.code_description, amount: e.amount, currency: e.currency })),
            rate: rate.bs_per_unit,
            reservePercent: dto.reservePercent,
            reserveLabel: `${dto.reservePercent}% ${RESERVE_LABEL}`,
            reserveCode: RESERVE_FUND_CODE,
            units: units.map(u => ({ id: u.id, name: u.name, aliquot: u.aliquot })),
        });

        const receipt = await this.repo.createReceipt({
            building_id: dto.buildingId,
            period: dto.period,
            concept_id: concept.id,
            reserve_percent: dto.reservePercent,
            exchange_rate: rate.bs_per_unit,
            rate_source: rateSource,
            rate_date: rateDate,
            ...calculated,
            created_by: dto.userId,
        });

        const issueDate = new Date();
        const invoices = calculated.units
            .filter(u => u.total_usd > 0)
            .map(u => new Invoice({
                id: crypto.randomUUID(),
                unit_id: u.unit_id,
                amount: u.total_usd,
                paid_amount: 0,
                period: dto.period,
                issue_date: issueDate,
                due_date: dto.dueDate,
                status: InvoiceStatus.PENDING,
                type: InvoiceType.DEBT,
                description: `${CONCEPT_NAME} ${dto.period}`,
                receipt_number: u.control_number,
                concept_id: concept.id,
            }));

        try {
            await this.deps.invoiceRepo.createBatch(invoices);
        } catch (error) {
            await this.repo.deleteReceipt(receipt.id);
            throw error;
        }
        return receipt;
    }

    /** Undoes a generated receipt (cancels its invoices) so the period can be corrected. */
    async void(buildingId: string, period: string) {
        const receipt = await this.getReceipt(buildingId, period);
        const invoices = (await this.deps.invoiceRepo.findAll({ concept_id: receipt.concept_id, period }))
            .filter(inv => inv.status !== InvoiceStatus.CANCELLED);
        const paid = invoices.filter(inv => inv.paid_amount > 0);
        if (paid.length > 0) {
            throw new DomainError(`Cannot void: ${paid.length} invoices of ${period} already have payments`, 'CONFLICT', 409);
        }
        for (const invoice of invoices) {
            invoice.cancel();
            await this.deps.invoiceRepo.update(invoice);
        }
        await this.repo.deleteReceipt(receipt.id);
    }

    /** Everything the printed notice of one unit shows. */
    async getUnitReceipt(buildingId: string, period: string, unitId: string) {
        const receipt = await this.getReceipt(buildingId, period);
        const unit = receipt.units.find(u => u.unit_id === unitId);
        if (!unit) throw notFound('Unit in receipt');

        const [building, paymentInfo, statement] = await Promise.all([
            this.deps.buildingRepo.findById(buildingId),
            this.deps.paymentInfoRepo.find(buildingId),
            this.repo.getUnitStatement(unitId),
        ]);

        return {
            building: { id: buildingId, name: building?.name ?? '', address: building?.address ?? '' },
            period,
            control_number: unit.control_number,
            issued_at: receipt.created_at,
            exchange_rate: receipt.exchange_rate,
            rate_source: receipt.rate_source,
            rate_date: receipt.rate_date,
            unit: { id: unit.unit_id, name: unit.unit_name, aliquot: unit.aliquot, owners: statement.owners },
            lines: receipt.lines.map(line => ({ ...line, share_bs: lineShare(line.amount_bs, unit.aliquot) })),
            total_bs: receipt.total_bs,
            net_bs: unit.total_bs,
            net_usd: unit.total_usd,
            debt_usd: statement.debt_usd,
            debt_bs: Math.round(statement.debt_usd * receipt.exchange_rate * 100) / 100,
            pending_invoices: statement.pending_invoices,
            last_payments: statement.last_payments,
            payment_info: paymentInfo
                ? {
                    bank_name: paymentInfo.bank_name,
                    account_holder: paymentInfo.account_holder,
                    rif: paymentInfo.rif,
                    account_number: paymentInfo.account_number,
                    pago_movil_phone: paymentInfo.pago_movil_phone,
                    email: paymentInfo.email,
                }
                : null,
        };
    }

    private async assertOpen(buildingId: string, period: string) {
        if (await this.repo.findReceipt(buildingId, period)) {
            throw new DomainError(`The receipt for ${period} was already generated; void it to change its expenses`, 'PERIOD_CLOSED', 409);
        }
    }

    /** The building's "Condominio" concept; created on the first receipt. */
    private async condoConcept(buildingId: string): Promise<ChargeConcept> {
        const existing = (await this.deps.conceptRepo.findByBuildingId(buildingId))
            .find(c => c.name.toLowerCase() === CONCEPT_NAME.toLowerCase());
        if (existing) return existing;
        return this.deps.conceptRepo.create(new ChargeConcept({
            id: crypto.randomUUID(),
            building_id: buildingId,
            name: CONCEPT_NAME,
            kind: ChargeConceptKind.ORDINARY,
            distribution: ChargeDistribution.ALIQUOT,
        }));
    }
}

function totalsByCurrency(expenses: MonthlyExpense[]) {
    const cents = { USD: 0, VES: 0 };
    for (const e of expenses) cents[e.currency] += Math.round(e.amount * 100);
    return { usd: cents.USD / 100, ves: cents.VES / 100, count: expenses.length };
}
