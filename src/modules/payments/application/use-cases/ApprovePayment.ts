import { IPaymentRepository } from '../../domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { IPaymentAllocationRepository } from '@/modules/billing/domain/repository';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import { ProcessInvoiceOverpayment } from '@/modules/billing/application/use-cases/ProcessInvoiceOverpayment';

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
            // Actually, we delegate the "processing" (status update and credit generation) to billing use case
            await this.processOverpayment.execute({
                invoiceId: alloc.invoice_id,
                paymentId: payment.id,
                paymentAmount: alloc.amount
            });
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
