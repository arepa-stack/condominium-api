// Note: Payment repo is likely in modules/payments/domain/repository
import { Payment } from '../../domain/entities/Payment';
import { PaymentAllocation } from '@/modules/billing/domain/entities/PaymentAllocation';
import { PaymentStatus, PaymentMethod } from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

// We need to import IInvoiceRepository and IPaymentAllocationRepository from billing module
// but here we are in Payments module (users said module/payments).
// However, RegisterPaymentUseCase crosses domains (Payments -> Billing).
// It should probably reside in Payments module but use Billing repositories.

import { IPaymentAllocationRepository as IBillingAllocationRepository } from '@/modules/billing/domain/repository';
// And PaymentRepository from local module
import { IPaymentRepository as ILocalPaymentRepository } from '../../domain/repository';

export interface RegisterPaymentDTO {
    userId: string;
    unitId: string;
    buildingId?: string;
    amount: number;
    method: PaymentMethod;
    paymentDate: Date;
    reference?: string;
    bank?: string;
    proofUrl?: string;
    notes?: string;
    allocations?: {
        invoiceId: string;
        amount: number;
    }[];
}

export class RegisterPayment {
    constructor(
        private paymentRepository: ILocalPaymentRepository,
        private paymentAllocationRepository: IBillingAllocationRepository
    ) { }

    async execute(dto: RegisterPaymentDTO): Promise<Payment> {
        this.validateAmount(dto.amount);
        this.validatePaymentDate(dto.paymentDate);
        this.validateProof(dto.proofUrl);
        this.validateBankFields(dto);
        this.validateAllocations(dto);

        const payment = this.initializePayment(dto);
        const createdPayment = await this.paymentRepository.create(payment);

        await this.createAllocations(createdPayment.id, dto.allocations);

        return createdPayment;
    }

    private validateAmount(amount: number): void {
        if (amount <= 0) {
            throw new DomainError('Payment amount must be positive', 'VALIDATION_ERROR', 400);
        }
    }

    private validatePaymentDate(paymentDate: Date): void {
        if (!(paymentDate instanceof Date) || isNaN(paymentDate.getTime())) {
            throw new DomainError('Payment date is invalid', 'VALIDATION_ERROR', 400);
        }
        if (paymentDate.getTime() > Date.now()) {
            throw new DomainError('Payment date cannot be in the future', 'FUTURE_DATE', 400);
        }
    }

    private validateProof(proofUrl?: string): void {
        if (!proofUrl || proofUrl.trim().length === 0) {
            throw new DomainError('Payment proof is required', 'MISSING_PROOF', 400);
        }
    }

    private validateBankFields(dto: RegisterPaymentDTO): void {
        if (dto.method === PaymentMethod.CASH) return;
        if (!dto.reference || dto.reference.trim().length === 0) {
            throw new DomainError(
                'Reference is required for PAGO_MOVIL and TRANSFER payments',
                'MISSING_BANK_INFO',
                400
            );
        }
        if (!dto.bank || dto.bank.trim().length === 0) {
            throw new DomainError(
                'Bank is required for PAGO_MOVIL and TRANSFER payments',
                'MISSING_BANK_INFO',
                400
            );
        }
    }

    private validateAllocations(dto: RegisterPaymentDTO): void {
        if (!dto.allocations) return;

        let allocatedAmount = 0;
        for (const alloc of dto.allocations) {
            if (alloc.amount <= 0) {
                throw new DomainError('Allocation amount must be positive', 'VALIDATION_ERROR', 400);
            }
            allocatedAmount += alloc.amount;
        }

        if (allocatedAmount > dto.amount) {
            throw new DomainError('Allocated amount cannot exceed payment amount', 'VALIDATION_ERROR', 400);
        }
    }

    private initializePayment(dto: RegisterPaymentDTO): Payment {
        return new Payment({
            id: crypto.randomUUID(),
            user_id: dto.userId,
            unit_id: dto.unitId,
            building_id: dto.buildingId,
            amount: dto.amount,
            payment_date: dto.paymentDate,
            method: dto.method,
            reference: dto.reference,
            bank: dto.bank,
            proof_url: dto.proofUrl,
            status: PaymentStatus.PENDING,
            notes: dto.notes
        });
    }

    private async createAllocations(paymentId: string, allocations?: Array<{ invoiceId: string, amount: number }>): Promise<void> {
        if (!allocations) return;

        for (const alloc of allocations) {
            const allocation = new PaymentAllocation({
                id: crypto.randomUUID(),
                payment_id: paymentId,
                invoice_id: alloc.invoiceId,
                amount: alloc.amount
            });
            await this.paymentAllocationRepository.create(allocation);
        }
    }
}
