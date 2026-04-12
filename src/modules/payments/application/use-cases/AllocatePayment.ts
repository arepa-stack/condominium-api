import { IPaymentRepository } from '../../domain/repository';
import { PaymentAllocation } from '@/modules/billing/domain/entities/PaymentAllocation';
import { DomainError } from '@/core/errors';

// Cross-module imports (Payment -> Billing)
import { IInvoiceRepository as IBillingInvoiceRepository, IPaymentAllocationRepository as IBillingAllocationRepository } from '@/modules/billing/domain/repository';

export interface AllocatePaymentDTO {
    paymentId: string;
    allocations: {
        invoiceId: string;
        amount: number;
    }[];
}

export class AllocatePayment {
    constructor(
        private paymentRepo: IPaymentRepository,
        private invoiceRepository: IBillingInvoiceRepository,
        private paymentAllocationRepository: IBillingAllocationRepository
    ) { }

    async execute(dto: AllocatePaymentDTO): Promise<void> {
        const payment = await this.paymentRepo.findById(dto.paymentId);
        if (!payment) {
            throw new DomainError('Payment not found', 'NOT_FOUND', 404);
        }

        // Calculate total previously allocated
        const existingAllocations = await this.paymentAllocationRepository.findByPaymentId(dto.paymentId);
        const previouslyAllocated = existingAllocations.reduce((sum, a) => sum + a.amount, 0);

        // Calculate new allocations total
        let newAllocationTotal = 0;
        for (const alloc of dto.allocations) {
            if (alloc.amount <= 0) throw new DomainError('Allocation amount must be positive', 'VALIDATION_ERROR', 400);
            newAllocationTotal += alloc.amount;
        }

        // Check if total exceeds payment amount
        if (previouslyAllocated + newAllocationTotal > payment.amount) {
            throw new DomainError('Total allocations exceed payment amount', 'VALIDATION_ERROR', 400);
        }

        // Create new allocations
        for (const alloc of dto.allocations) {
            const invoice = await this.invoiceRepository.findById(alloc.invoiceId);
            if (!invoice) {
                throw new DomainError(`Invoice ${alloc.invoiceId} not found`, 'NOT_FOUND', 404);
            }

            const remaining = invoice.amount - invoice.paid_amount;
            if (alloc.amount > remaining) {
                throw new DomainError(
                    `Allocation amount (${alloc.amount}) exceeds invoice ${alloc.invoiceId} remaining balance (${remaining})`,
                    'VALIDATION_ERROR',
                    400
                );
            }

            const allocation = new PaymentAllocation({
                id: crypto.randomUUID(),
                payment_id: dto.paymentId,
                invoice_id: alloc.invoiceId,
                amount: alloc.amount
            });
            await this.paymentAllocationRepository.create(allocation);
        }

        // If fully allocated, maybe update status? 
        // Payment status usually reflects "money received", not "money used".
        // So we leave it as APPROVED/PENDING.
    }
}
