import { IInvoiceRepository } from '../../domain/repository';
import { Invoice, InvoiceStatus, InvoiceType } from '../../domain/entities/Invoice';
import { DomainError } from '@/core/errors';
import { PaymentMethod } from '@/core/domain/enums';
import type { RateSource } from '@/core/domain/ports/IExchangeRateService';
import type { RecordInvoicePayment } from '@/modules/payments/application/use-cases/RecordInvoicePayment';
import type { ChargeConceptGuard } from '../services/ChargeConceptGuard';

export interface LoadDebtDTO {
    unitId: string;
    amount: number;
    period: string;
    description?: string;
    conceptId?: string;
    dueDate?: Date;
    receiptNumber?: string;
    status?: InvoiceStatus;
    paidAmount?: number;
    // Payment already received for this debt (status PAID or paidAmount > 0).
    actorId?: string;
    paymentMethod?: PaymentMethod;
    paymentDate?: Date;
    amountVes?: number;
    exchangeRate?: number;
    rateSource?: RateSource | null;
}

export class LoadDebt {
    constructor(
        private invoiceRepository: IInvoiceRepository,
        private recordInvoicePayment?: RecordInvoicePayment,
        private conceptGuard?: Pick<ChargeConceptGuard, 'assertBillableForUnit'>
    ) { }

    async execute(dto: LoadDebtDTO): Promise<Invoice> {
        if (dto.amount <= 0) {
            throw new DomainError('Amount must be positive', 'VALIDATION_ERROR', 400);
        }

        const paidAmount = dto.status === InvoiceStatus.PAID ? dto.amount : (dto.paidAmount ?? 0);
        if (paidAmount > dto.amount) {
            throw new DomainError('Paid amount cannot exceed the invoice amount', 'VALIDATION_ERROR', 400);
        }

        if (dto.conceptId) {
            if (!this.conceptGuard) {
                throw new DomainError('Cannot check the charge concept of this debt', 'CONFIGURATION_ERROR', 500);
            }
            await this.conceptGuard.assertBillableForUnit(dto.conceptId, dto.unitId);
        }

        // Always stored unpaid: a received payment moves the balance through the
        // payment path, so the invoice never shows money without a payment record.
        const invoice = await this.invoiceRepository.create(new Invoice({
            id: crypto.randomUUID(),
            unit_id: dto.unitId,
            amount: dto.amount,
            paid_amount: 0,
            period: dto.period,
            issue_date: new Date(),
            due_date: dto.dueDate,
            status: InvoiceStatus.PENDING,
            type: InvoiceType.DEBT,
            description: dto.description,
            receipt_number: dto.receiptNumber,
            concept_id: dto.conceptId ?? null,
        }));

        if (paidAmount <= 0) return invoice;

        try {
            if (!this.recordInvoicePayment || !dto.actorId) {
                throw new DomainError('Cannot record the payment of this debt', 'CONFIGURATION_ERROR', 500);
            }
            const { invoice: paidInvoice } = await this.recordInvoicePayment.execute({
                invoiceId: invoice.id,
                actorId: dto.actorId,
                amount: paidAmount,
                method: dto.paymentMethod ?? PaymentMethod.CASH,
                paymentDate: dto.paymentDate ?? new Date(),
                reference: dto.receiptNumber,
                amountVes: dto.amountVes,
                exchangeRate: dto.exchangeRate,
                rateSource: dto.rateSource,
            });
            return paidInvoice;
        } catch (err) {
            // Do not leave behind a debt the resident already paid; but if the
            // payment reached the invoice anyway, keep it for manual reconciliation.
            const current = (await this.invoiceRepository.findById(invoice.id)) ?? invoice;
            if (current.status === InvoiceStatus.PENDING && current.paid_amount === 0) {
                current.cancel();
                await this.invoiceRepository.update(current);
            }
            throw err;
        }
    }
}
