import { IPaymentRepository } from '../../domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { IPaymentAllocationRepository, IInvoiceRepository } from '@/modules/billing/domain/repository';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import { ProcessInvoiceOverpayment } from '@/modules/billing/application/use-cases/ProcessInvoiceOverpayment';
import { Payment } from '../../domain/entities/Payment';
import {
    PaymentStatus,
    InvoiceTag,
    PettyCashEntryType,
    PettyCashEntryReferenceType,
} from '@/core/domain/enums';
import { PettyCashRepository } from '@/modules/petty-cash/domain/repositories/PettyCashRepository';
import { PettyCashEntry } from '@/modules/petty-cash/domain/entities/PettyCashEntry';

export interface ApprovePaymentDTO {
    paymentId: string;
    approverId: string;
    notes?: string;
}

export interface RejectPaymentDTO {
    paymentId: string;
    approverId: string;
    notes?: string;
}

export class ApprovePayment {
    constructor(
        private paymentRepo: IPaymentRepository,
        private userRepo: IUserRepository,
        private allocationRepo: IPaymentAllocationRepository,
        private processOverpayment: ProcessInvoiceOverpayment,
        private invoiceRepo: IInvoiceRepository,
        private pettyCashRepo: PettyCashRepository
    ) { }

    async approve({ paymentId, approverId, notes }: ApprovePaymentDTO): Promise<void> {
        const { payment } = await this.loadAndAuthorize(paymentId, approverId, 'approve');

        // Idempotency: short-circuit on retry. Without this, the allocation
        // loop below re-runs and ProcessInvoiceOverpayment would produce
        // duplicate credit entries on double-click / network retry.
        // NOTE: this is NOT a transaction — if the loop fails mid-way on the
        // first call, the payment is already APPROVED and a retry will be
        // blocked by this guard, leaving allocations partially processed.
        // The real fix is wrapping approve() in a DB transaction (Supabase
        // RPC or unit-of-work). Out of scope for this commit.
        if (payment.status === PaymentStatus.APPROVED) {
            return;
        }

        const allocations = await this.allocationRepo.findByPaymentId(paymentId);

        // Pre-flight validation: verify EVERY allocated invoice can accept a
        // payment right now, BEFORE we persist payment.status = APPROVED.
        //
        // Without this, approving a payment that targets a CANCELLED invoice
        // produces a zombie state:
        //   1. payment.approve() + update → payment persisted as APPROVED.
        //   2. Loop hits the CANCELLED invoice → invoice.updateStatus()
        //      throws INVALID_STATE_TRANSITION (from aabf4dd).
        //   3. Error propagates; payment stays APPROVED, invoice untouched,
        //      allocation orphaned.
        //   4. Retry short-circuits via the idempotency guard above and
        //      returns success without actually fixing the partial state.
        //
        // Failing HERE leaves the payment in PENDING so the admin can reject
        // it cleanly or re-allocate to a valid invoice.
        for (const alloc of allocations) {
            await this.processOverpayment.assertInvoiceCanAcceptPayment(alloc.invoice_id);
        }

        payment.approve(approverId, notes);
        await this.paymentRepo.update(payment);

        let totalAllocated = 0;
        for (const alloc of allocations) {
            const result = await this.processOverpayment.execute({
                invoiceId: alloc.invoice_id,
                paymentId: payment.id,
                paymentAmount: alloc.amount
            });

            // Auto-collection (Phase 2 of petty-cash redesign): if this
            // allocation lands on a PETTY_CASH unit-level invoice, the
            // amount that actually reduced the invoice balance also
            // replenishes the building's petty-cash fund. The
            // overpayment portion, if any, already went to the unit's
            // credit ledger via processOverpayment and is NOT duplicated
            // in petty cash.
            if (result.appliedToInvoice > 0) {
                await this.replenishPettyCashIfApplicable(
                    alloc.invoice_id,
                    result.appliedToInvoice,
                    payment.id,
                    approverId
                );
            }

            totalAllocated += alloc.amount;
        }

        // Unallocated portion of the payment becomes a direct credit on the
        // unit. This covers three real-world scenarios:
        //
        //   1. APK sends allocation.amount = invoice.amount (e.g. pay 100
        //      against an invoice of 40 → allocation=40, surplus=60 → credit).
        //   2. Resident reports a payment with no allocations (pure credit
        //      deposit for future use).
        //   3. Multi-invoice payment where sum(allocations) < payment.amount.
        //
        // `allocation.amount` is a first-class intent — "apply this much to
        // this invoice" — not a fraction of the payment the backend has to
        // split. The residue is what makes the arithmetic close.
        const unallocatedSurplus = payment.amount - totalAllocated;
        if (unallocatedSurplus > 0) {
            if (payment.unit_id) {
                await this.processOverpayment.processUnallocatedSurplus(
                    payment.id,
                    payment.unit_id,
                    unallocatedSurplus
                );
            } else {
                // Building-level payment with surplus — no unit to credit.
                // Drop with a warning; spec does not define a destination.
                console.warn(
                    `[ApprovePayment] Dropping ${unallocatedSurplus} surplus on building-level payment ${payment.id} — no unit to credit.`
                );
            }
        }
    }

    async reject({ paymentId, approverId, notes }: RejectPaymentDTO): Promise<void> {
        const { payment } = await this.loadAndAuthorize(paymentId, approverId, 'reject');
        payment.reject(approverId, notes);
        await this.paymentRepo.update(payment);
    }

    /**
     * If the invoice is a unit-level PETTY_CASH invoice (generated by
     * an assessment batch), record a `collection` entry in the building's
     * petty-cash ledger. Closes the loop between residents paying their
     * assessment quota and the fund being replenished — no more "admin
     * has to remember to log a manual INCOME".
     *
     * Idempotent: skips if an entry already exists for (invoice, payment).
     * Uses a description pattern check — same approach as the credit
     * ledger's hasExistingCreditForInvoice.
     */
    private async replenishPettyCashIfApplicable(
        invoiceId: string,
        appliedAmount: number,
        paymentId: string,
        createdBy: string
    ): Promise<void> {
        if (appliedAmount <= 0) return;

        const invoice = await this.invoiceRepo.findById(invoiceId);
        if (!invoice) return;
        if (invoice.tag !== InvoiceTag.PETTY_CASH) return;
        if (!invoice.unit_id) return;
        if (!invoice.building_id) return;

        // Idempotency: if there's already a collection entry for this
        // (invoice, payment) tuple, skip. Protects against retries and
        // the partial-commit scenario where ApprovePayment failed mid-loop.
        const existing = await this.pettyCashRepo.findEntriesByReference(
            PettyCashEntryReferenceType.INVOICE_PAYMENT,
            invoiceId
        );
        const alreadyCollected = existing.some(
            e => e.description.includes(paymentId) && e.type === PettyCashEntryType.COLLECTION
        );
        if (alreadyCollected) {
            console.log(
                `[ApprovePayment] Petty cash collection already recorded for invoice=${invoiceId} payment=${paymentId} — skipping`
            );
            return;
        }

        const fund = await this.pettyCashRepo.findOrCreateFund(invoice.building_id);
        const entry = new PettyCashEntry({
            fund_id: fund.id,
            type: PettyCashEntryType.COLLECTION,
            amount: appliedAmount,
            description: `Cobro ${invoice.description || 'cuota caja chica'} — pago ${paymentId}`,
            reference_type: PettyCashEntryReferenceType.INVOICE_PAYMENT,
            reference_id: invoiceId,
            created_by: createdBy,
        });
        await this.pettyCashRepo.addEntry(entry);
    }

    private async loadAndAuthorize(
        paymentId: string,
        approverId: string,
        action: 'approve' | 'reject'
    ): Promise<{ payment: Payment }> {
        const approver = await this.userRepo.findById(approverId);
        if (!approver) {
            throw new NotFoundError('Approver not found');
        }

        const payment = await this.paymentRepo.findById(paymentId);
        if (!payment) {
            throw new NotFoundError('Payment not found');
        }

        if (!approver.isAdmin()) {
            if (!payment.building_id || !approver.isBoardInBuilding(payment.building_id)) {
                throw new ForbiddenError(`You can only ${action} payments from your building`);
            }
        }

        return { payment };
    }
}
