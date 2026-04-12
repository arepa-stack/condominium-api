import { IPaymentRepository } from '../../domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { IPaymentAllocationRepository } from '@/modules/billing/domain/repository';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import { ProcessInvoiceOverpayment } from '@/modules/billing/application/use-cases/ProcessInvoiceOverpayment';
import { Payment } from '../../domain/entities/Payment';
import { PaymentStatus } from '@/core/domain/enums';

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
        private processOverpayment: ProcessInvoiceOverpayment
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

        payment.approve(approverId, notes);
        await this.paymentRepo.update(payment);

        const allocations = await this.allocationRepo.findByPaymentId(paymentId);
        for (const alloc of allocations) {
            await this.processOverpayment.execute({
                invoiceId: alloc.invoice_id,
                paymentId: payment.id,
                paymentAmount: alloc.amount
            });
        }
    }

    async reject({ paymentId, approverId, notes }: RejectPaymentDTO): Promise<void> {
        const { payment } = await this.loadAndAuthorize(paymentId, approverId, 'reject');
        payment.reject(approverId, notes);
        await this.paymentRepo.update(payment);
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
