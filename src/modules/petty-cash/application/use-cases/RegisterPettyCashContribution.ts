import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashAssessment } from '../../domain/entities/PettyCashAssessment';
import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';
import { DomainError, ForbiddenError } from '@/core/errors';
import { RegisterPayment } from '@/modules/payments/application/use-cases/RegisterPayment';
import { ApprovePayment } from '@/modules/payments/application/use-cases/ApprovePayment';
import { IPaymentRepository } from '@/modules/payments/domain/repository';
import { PaymentMethod } from '@/core/domain/enums';
import { computeCoverage } from './computeCoverage';

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
        private paymentRepo: IPaymentRepository
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

        // ── Fund resolution ───────────────────────────────────────────────────
        const fund = await this.pettyCashRepo.findOrCreateFund(buildingId);

        // ── Assessment ────────────────────────────────────────────────────────
        const assessment = await this.pettyCashRepo.createAssessment(
            new PettyCashAssessment({
                fund_id: fund.id,
                period,
                description,
                total_amount: amount,
                created_by: userId,
                kind: 'CONTRIBUTION',
            })
        );

        // ── Invoice ───────────────────────────────────────────────────────────
        const invoice = new Invoice({
            id: crypto.randomUUID(),
            unit_id: unitId,
            building_id: buildingId,
            amount,
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
        let paymentId: string | null = null;
        try {
            const payment = await this.registerPayment.execute({
                userId,
                unitId,
                buildingId,
                amount,
                currency,
                method: PaymentMethod.CASH,
                paymentDate: new Date(),
                proofUrl: proofUrl.trim(),
                allocations: [{ invoiceId: createdInvoice.id, amount }],
            });

            paymentId = payment.id;

            await this.approvePayment.approve({
                paymentId: payment.id,
                approverId: userId,
            });
        } catch (err) {
            // Compensation: cancel the invoice and persist the cancellation.
            createdInvoice.cancel();
            await this.invoiceRepo.update(createdInvoice);

            // Best-effort payment delete. If it fails, log and continue
            // so the original error is what propagates.
            if (paymentId) {
                try {
                    await this.paymentRepo.delete(paymentId);
                } catch (deleteErr) {
                    console.warn(
                        `[RegisterPettyCashContribution] Could not delete orphaned payment ${paymentId}:`,
                        deleteErr
                    );
                }
            }

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

        const { pendingCents: rawPendingCents } = computeCoverage({
            balanceCents,
            targetFundCents,
            invoices: allInvoices,
        });

        const pendingCents = rawPendingCents < 1 ? 0 : rawPendingCents;

        return {
            invoice: createdInvoice.toJSON(),
            fund_balance: balance,
            coverage: {
                pending_to_assess: fromCents(pendingCents),
                balance,
                target_fund: fromCents(targetFundCents),
            },
        };
    }
}
