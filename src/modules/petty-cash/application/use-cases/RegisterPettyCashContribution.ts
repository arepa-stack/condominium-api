import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashAssessment } from '../../domain/entities/PettyCashAssessment';
import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository, IBuildingRepository } from '@/modules/buildings/domain/repository';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';
import { DomainError, ForbiddenError } from '@/core/errors';
import { RegisterPayment } from '@/modules/payments/application/use-cases/RegisterPayment';
import { ApprovePayment } from '@/modules/payments/application/use-cases/ApprovePayment';
import { IPaymentRepository } from '@/modules/payments/domain/repository';
import { Payment } from '@/modules/payments/domain/entities/Payment';
import { PaymentMethod, PaymentStatus } from '@/core/domain/enums';
import type { IExchangeRateService } from '@/core/domain/ports/IExchangeRateService';
import { computeCoverage } from './computeCoverage';
import { resolvePettyCashCurrency } from './resolvePettyCashCurrency';

export interface RegisterContributionDTO {
    buildingId: string;
    unitId: string;
    amount: number;
    /** Proof URL already uploaded by the caller before invoking this use case. */
    proofUrl: string;
    /** Overrides the default description. Must be non-empty when provided. */
    description?: string;
    /** Defaults to USD. */
    currency?: 'USD' | 'VES';
    /** Acting admin/board user id. Becomes both the payment user_id and the approverId. */
    userId: string;
}

export interface RegisterContributionResult {
    invoice: ReturnType<Invoice['toJSON']>;
    payment: ReturnType<Payment['toJSON']>;
    fund_balance: number;
    coverage: {
        pending_to_assess: number;
        balance: number;
        target_fund: number;
    };
}

const toCents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

/**
 * Payment-first direct contribution to petty cash from a single unit.
 *
 * Flow:
 *   1. Validate amount, proof, unit membership.
 *   2. Resolve description default.
 *   3. findOrCreateFund.
 *   4. Create assessment (kind=CONTRIBUTION).
 *   5. Create invoice (PETTY_CASH tag, unit, amount, assessment_id).
 *   6. RegisterPayment.execute with allocation to the invoice + proof.
 *   7. ApprovePayment.approve (auto-approve → triggers fund COLLECTION).
 *   8. On failure after step 5: compensate (invoice.cancel + invoiceRepo.update,
 *      best-effort payment delete).
 *   9. Return invoice, fund_balance, coverage.
 */
export class RegisterPettyCashContribution {
    constructor(
        private pettyCashRepo: PettyCashRepository,
        private invoiceRepo: IInvoiceRepository,
        private unitRepo: IUnitRepository,
        private registerPayment: RegisterPayment,
        private approvePayment: ApprovePayment,
        private paymentRepo: IPaymentRepository,
        private buildingRepo?: IBuildingRepository,
        private exchangeRateService?: IExchangeRateService
    ) {}

    async execute(dto: RegisterContributionDTO): Promise<RegisterContributionResult> {
        const { buildingId, unitId, amount, proofUrl, userId } = dto;
        const currency = dto.currency ?? 'USD';

        // ── Validation ────────────────────────────────────────────────────────
        if (!(amount > 0)) {
            throw new DomainError(
                'Contribution amount must be greater than zero',
                'VALIDATION_ERROR',
                400
            );
        }

        if (!proofUrl?.trim()) {
            throw new DomainError(
                'Proof is required for a direct contribution',
                'MISSING_PROOF',
                400
            );
        }

        // Resolve and validate description
        const period = new Date().toISOString().substring(0, 7); // YYYY-MM
        const defaultDescription = `Aporte caja chica — ${period}`;
        let description: string;
        if (dto.description !== undefined) {
            if (!dto.description.trim()) {
                throw new DomainError(
                    'Contribution description cannot be empty when provided',
                    'VALIDATION_ERROR',
                    400
                );
            }
            description = dto.description.trim();
        } else {
            description = defaultDescription;
        }

        // ── Unit membership guard ─────────────────────────────────────────────
        const buildingUnits = await this.unitRepo.findByBuildingId(buildingId);
        const unitBelongsToBuilding = buildingUnits.some(u => u.id === unitId);
        if (!unitBelongsToBuilding) {
            throw new ForbiddenError(
                `Unit ${unitId} does not belong to building ${buildingId}`
            );
        }

        // ── Canonical amount resolution ───────────────────────────────────────
        // The payment is registered in `currency` (USD physical or VES), but the
        // assessment total, invoice amount, and allocation must be expressed in the
        // canonical base unit. RegisterPayment converts the payment amount the same
        // way and validates allocations against the canonical value — so a raw VES
        // figure here would overflow the converted allocation ceiling and be rejected.
        const conv = await resolvePettyCashCurrency({
            buildingId,
            amount,
            currency,
            sign: 1,
            buildingRepo: this.buildingRepo,
            exchangeRateService: this.exchangeRateService,
        });
        const canonicalAmount = conv.canonical;

        // ── Fund resolution ───────────────────────────────────────────────────
        const fund = await this.pettyCashRepo.findOrCreateFund(buildingId);

        // ── Assessment ────────────────────────────────────────────────────────
        const assessment = await this.pettyCashRepo.createAssessment(
            new PettyCashAssessment({
                fund_id: fund.id,
                period,
                description,
                total_amount: canonicalAmount,
                created_by: userId,
                kind: 'CONTRIBUTION',
            })
        );

        // ── Invoice ───────────────────────────────────────────────────────────
        const invoice = new Invoice({
            id: crypto.randomUUID(),
            unit_id: unitId,
            building_id: buildingId,
            amount: canonicalAmount,
            period,
            issue_date: new Date(),
            status: InvoiceStatus.PENDING,
            type: InvoiceType.EXPENSE,
            tag: InvoiceTag.PETTY_CASH,
            description,
            assessment_id: assessment.id,
        });

        const createdInvoice = await this.invoiceRepo.create(invoice);

        // ── RegisterPayment + ApprovePayment with compensation on failure ─────
        let createdPayment: Payment | null = null;
        try {
            // The payment keeps its original currency/amount (VES provenance),
            // while the allocation is in canonical base units.
            createdPayment = await this.registerPayment.execute({
                userId,
                unitId,
                buildingId,
                amount,
                currency,
                method: PaymentMethod.CASH,
                paymentDate: new Date(),
                proofUrl: proofUrl.trim(),
                allocations: [{ invoiceId: createdInvoice.id, amount: canonicalAmount }],
            });

            await this.approvePayment.approve({
                paymentId: createdPayment.id,
                approverId: userId,
            });

            // approve() persists the transition but returns void, leaving the
            // in-memory entity PENDING. Re-read so the response mirrors the stored
            // APPROVED state (processed_by/processed_at); fall back to the in-memory
            // entity if the row cannot be fetched.
            const approvedPayment = await this.paymentRepo.findById(createdPayment.id);
            if (approvedPayment) {
                createdPayment = approvedPayment;
            }
        } catch (err) {
            await this.compensate(createdInvoice, createdPayment);
            throw err;
        }

        // ── Post-approve: read balance and compute coverage ───────────────────
        const balance = await this.pettyCashRepo.getBalance(fund.id);
        const balanceCents = toCents(balance);
        const targetFundCents = toCents(fund.target_fund ?? 0);

        const allInvoices = await this.invoiceRepo.findAll({
            building_id: buildingId,
            tag: InvoiceTag.PETTY_CASH,
        });

        const { pendingCents } = computeCoverage({
            balanceCents,
            targetFundCents,
            invoices: allInvoices,
        });

        return {
            invoice: createdInvoice.toJSON(),
            payment: createdPayment.toJSON(),
            fund_balance: balance,
            coverage: {
                pending_to_assess: fromCents(pendingCents),
                balance,
                target_fund: fromCents(targetFundCents),
            },
        };
    }

    /**
     * Best-effort compensation after a failure in the payment/approve step.
     *
     * The failure may have occurred before or after the COLLECTION was written.
     * Blindly cancelling the in-memory invoice and force-updating the DB could
     * clobber an already-settled (PAID) invoice or reverse a valid collection.
     * So we re-read authoritative state first:
     *   - Only cancel+persist the invoice if the DB still reports it PENDING.
     *   - Only delete the payment if it is not already APPROVED.
     *   - If the invoice is already PAID (collection landed), do NOT mutate —
     *     rethrow with a reconciliation-flavored message for manual review.
     */
    private async compensate(createdInvoice: Invoice, payment: Payment | null): Promise<void> {
        // Re-read authoritative invoice state; fall back to the freshly created
        // in-memory entity when the row cannot be fetched.
        const dbInvoice = await this.invoiceRepo.findById(createdInvoice.id);
        const invoice = dbInvoice ?? createdInvoice;

        // Invoice settled — a COLLECTION was written. Do not touch anything.
        if (invoice.status === InvoiceStatus.PAID) {
            throw new DomainError(
                `Contribution failed after the fund collection was recorded for invoice ${invoice.id}. ` +
                `The invoice is already PAID and was left intact; manual reconciliation is required.`,
                'RECONCILIATION_REQUIRED',
                500
            );
        }

        // Invoice still PENDING — safe to cancel and persist.
        if (invoice.status === InvoiceStatus.PENDING) {
            invoice.cancel();
            await this.invoiceRepo.update(invoice);
        }

        // Best-effort payment delete, but never delete an APPROVED payment.
        // Re-read the authoritative status; fall back to the in-memory entity
        // when the row cannot be fetched.
        if (payment) {
            const dbPayment = await this.paymentRepo.findById(payment.id);
            const status = dbPayment?.status ?? payment.status;
            if (status !== PaymentStatus.APPROVED) {
                try {
                    await this.paymentRepo.delete(payment.id);
                } catch (deleteErr) {
                    console.warn(
                        `[RegisterPettyCashContribution] Could not delete orphaned payment ${payment.id}:`,
                        deleteErr
                    );
                }
            }
        }
    }
}
