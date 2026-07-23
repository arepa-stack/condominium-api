import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { InvoiceStatus, InvoiceTag } from '@/modules/billing/domain/entities/Invoice';
import { DomainError, NotFoundError, ForbiddenError } from '@/core/errors';

export interface CancelExpressAssessmentDTO {
    assessmentId: string;
    reason: string;
    /** Must come from the route path so requireBuildingAccess protects it. */
    buildingId: string;
}

export interface CancelExpressAssessmentResult {
    assessment_id: string;
    cancelled_invoices: number;
    total_remainder_returned: number;
}

const toCents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

/**
 * Cancel all active (PENDING | PARTIAL) invoices linked to an EXPRESS
 * assessment, appending the reason to each invoice's description.
 *
 * Security: the assessment's fund must belong to the building the caller
 * has access to (enforced via buildingId from route param, checked here
 * against the fund's building_id resolved from the assessment).
 *
 * Constraints:
 *   - reason must be >= 10 chars (same convention as ReversePettyCashEntry).
 *   - Assessment must exist (NOT_FOUND 404 otherwise).
 *   - Assessment must be of kind EXPRESS (INVALID_OPERATION 409 otherwise).
 *   - At least one PENDING or PARTIAL invoice must be present (NOT_CANCELLABLE 409 otherwise).
 *   - PAID and already-CANCELLED invoices are skipped.
 */
export class CancelExpressAssessment {
    constructor(
        private invoiceRepo: IInvoiceRepository,
        private pettyCashRepo: PettyCashRepository
    ) {}

    async execute(dto: CancelExpressAssessmentDTO): Promise<CancelExpressAssessmentResult> {
        const { assessmentId, reason, buildingId } = dto;

        // ── Reason length validation ──────────────────────────────────────────
        if (!reason || reason.trim().length < 10) {
            throw new DomainError(
                'Cancellation reason must be at least 10 characters',
                'VALIDATION_ERROR',
                400
            );
        }

        // ── Assessment lookup ─────────────────────────────────────────────────
        const assessment = await this.pettyCashRepo.findAssessmentById(assessmentId);
        if (!assessment) {
            throw new NotFoundError(`Assessment ${assessmentId} not found`);
        }

        // ── Kind check ────────────────────────────────────────────────────────
        if (assessment.kind !== 'EXPRESS') {
            throw new DomainError(
                'Only EXPRESS assessments can be cancelled via this operation',
                'INVALID_OPERATION',
                409
            );
        }

        // ── Security: verify assessment belongs to the requesting building ────
        // The assessment carries fund_id; we resolve which building owns that fund
        // by finding the fund for the requesting buildingId and comparing.
        const buildingFund = await this.pettyCashRepo.findFundByBuildingId(buildingId);
        if (!buildingFund || assessment.fund_id !== buildingFund.id) {
            throw new ForbiddenError(
                'Assessment does not belong to the requesting building'
            );
        }

        // ── Fetch invoices for this assessment ────────────────────────────────
        // findAll returns all PETTY_CASH invoices for the building; filter in
        // memory by assessment_id (no dedicated repository filter exists yet).
        const allInvoices = await this.invoiceRepo.findAll({
            building_id: buildingId,
            tag: InvoiceTag.PETTY_CASH,
        });

        const assessmentInvoices = allInvoices.filter(
            inv => inv.assessment_id === assessmentId
        );

        const activeInvoices = assessmentInvoices.filter(
            inv =>
                inv.status === InvoiceStatus.PENDING ||
                inv.status === InvoiceStatus.PARTIAL
        );

        if (activeInvoices.length === 0) {
            throw new DomainError(
                'No active invoices (PENDING or PARTIAL) found for this assessment',
                'NOT_CANCELLABLE',
                409
            );
        }

        // ── Cancel each active invoice ────────────────────────────────────────
        let totalRemainderCents = 0;
        for (const invoice of activeInvoices) {
            const remainderCents = Math.max(
                0,
                toCents(invoice.amount) - toCents(invoice.paid_amount)
            );
            totalRemainderCents += remainderCents;

            invoice.cancel();
            invoice.appendToDescription(`Cancelado: ${reason.trim()}`);

            await this.invoiceRepo.update(invoice);
        }

        return {
            assessment_id: assessmentId,
            cancelled_invoices: activeInvoices.length,
            total_remainder_returned: fromCents(totalRemainderCents),
        };
    }
}
