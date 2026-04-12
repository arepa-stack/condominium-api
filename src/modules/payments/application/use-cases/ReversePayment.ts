import { IPaymentRepository } from '../../domain/repository';
import { IInvoiceRepository, IPaymentAllocationRepository, ICreditLedgerRepository } from '@/modules/billing/domain/repository';
import { NotFoundError, ForbiddenError } from '@/core/errors';
import { CreditLedgerEntry } from '@/modules/billing/domain/entities/CreditLedgerEntry';
import { PaymentStatus } from '@/core/domain/enums';

export interface ReversePaymentDTO {
    paymentId: string;
    requesterId: string; // Admin only
    reason: string;
}

export class ReversePayment {
    constructor(
        private paymentRepo: IPaymentRepository,
        private invoiceRepo: IInvoiceRepository,
        private allocationRepo: IPaymentAllocationRepository,
        private creditLedgerRepo: ICreditLedgerRepository
    ) { }

    async execute(dto: ReversePaymentDTO): Promise<void> {
        const payment = await this.paymentRepo.findById(dto.paymentId);
        if (!payment) {
            throw new NotFoundError(`Payment ${dto.paymentId} not found`);
        }

        if (payment.status !== PaymentStatus.APPROVED) {
            throw new ForbiddenError('Only approved payments can be reversed');
        }

        // 1. Mark payment as REJECTED (representing reversal)
        payment.reject(dto.requesterId, `REVERSED: ${dto.reason}`);
        await this.paymentRepo.update(payment);

        // 2. Find and revert generated credits
        const entries = await this.creditLedgerRepo.findByReferenceId(dto.paymentId);
        for (const entry of entries) {
            if (entry.isCredit) {
                const reversalEntry = CreditLedgerEntry.reversalOf(
                    entry,
                    `Reversión de pago ${dto.paymentId}: ${dto.reason}`
                );
                await this.creditLedgerRepo.deductCredit(reversalEntry);
            }
        }

        // 3. Update related invoices (status will be recalculated by trigger via allocations update, 
        // but we should ensure domain model is consistent if needed)
        // Since we don't have a "delete allocation" operation that triggers a recount easily without 
        // a complex trigger, usually the trigger handles it on updated_at or similar.
        // For this implementation, we assume the DB trigger handles paid_amount recount.
        // We just need to trigger the recalculation if necessary.
        
        const allocations = await this.allocationRepo.findByPaymentId(dto.paymentId);
        for (const alloc of allocations) {
            const invoice = await this.invoiceRepo.findById(alloc.invoice_id);
            if (invoice) {
                // Force status update logic
                invoice.updateStatus();
                await this.invoiceRepo.update(invoice);
            }
        }
    }
}
