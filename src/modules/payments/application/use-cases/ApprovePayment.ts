import { IPaymentRepository } from '../../domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { IPaymentAllocationRepository, ICreditLedgerRepository } from '@/modules/billing/domain/repository';
import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import { CreditLedgerEntry } from '@/modules/billing/domain/entities/CreditLedgerEntry';

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
        private invoiceRepo: IInvoiceRepository,
        private creditLedgerRepo: ICreditLedgerRepository
    ) { }

    async approve({ paymentId, approverId, notes }: ApprovePaymentDTO): Promise<void> {
        const approver = await this.userRepo.findById(approverId);
        if (!approver) {
            throw new NotFoundError('Approver not found');
        }

        const payment = await this.paymentRepo.findById(paymentId);
        if (!payment) {
            throw new NotFoundError('Payment not found');
        }

        // Check permissions
        if (!approver.isAdmin()) {
            if (!payment.building_id || !approver.isBoardInBuilding(payment.building_id)) {
                throw new ForbiddenError('You can only approve payments from your building');
            }
        }

        payment.approve(approverId, notes);
        await this.paymentRepo.update(payment);

        const allocations = await this.allocationRepo.findByPaymentId(paymentId);
        for (const alloc of allocations) {
            // Re-read invoice after allocation insert so DB trigger's paid_amount update is visible
            const invoice = await this.invoiceRepo.findById(alloc.invoice_id);
            if (!invoice) continue;

            // Detect overpayment → credit ledger
            // Only for unit-level invoices (building-level invoices don't generate unit credit)
            if (!invoice.unit_id) continue;

            const surplus = invoice.paid_amount - invoice.amount;
            if (surplus <= 0) continue;

            const creditEntry = new CreditLedgerEntry({
                id: crypto.randomUUID(),
                unit_id: invoice.unit_id,
                amount: surplus,
                reason: `Overpayment on invoice ${invoice.id}`,
                reference_type: 'payment',
                reference_id: payment.id
            });
            await this.creditLedgerRepo.addCredit(creditEntry);
        }
    }

    async reject({ paymentId, approverId, notes }: RejectPaymentDTO): Promise<void> {
        const approver = await this.userRepo.findById(approverId);
        if (!approver) {
            throw new NotFoundError('Approver not found');
        }

        const payment = await this.paymentRepo.findById(paymentId);
        if (!payment) {
            throw new NotFoundError('Payment not found');
        }

        // Check permissions
        if (!approver.isAdmin()) {
            if (!payment.building_id || !approver.isBoardInBuilding(payment.building_id)) {
                throw new ForbiddenError('You can only reject payments from your building');
            }
        }

        payment.reject(approverId, notes);
        await this.paymentRepo.update(payment);
    }
}
