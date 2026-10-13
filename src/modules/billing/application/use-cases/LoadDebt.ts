import { IInvoiceRepository } from '../../domain/repository';
import { Invoice, InvoiceStatus, InvoiceType } from '../../domain/entities/Invoice';
import { DomainError } from '@/core/errors';

export interface LoadDebtDTO {
    unitId: string;
    amount: number;
    period: string;
    description?: string;
    dueDate?: Date;
    receiptNumber?: string;
    status?: InvoiceStatus;
    paidAmount?: number;
}

export class LoadDebt {
    constructor(private invoiceRepository: IInvoiceRepository) { }

    async execute(dto: LoadDebtDTO): Promise<Invoice> {
        if (dto.amount <= 0) {
            throw new DomainError('Amount must be positive', 'VALIDATION_ERROR', 400);
        }

        const isPaid = dto.status === InvoiceStatus.PAID;
        const paidAmount = isPaid ? dto.amount : (dto.paidAmount ?? 0);
        const status = isPaid
            ? InvoiceStatus.PAID
            : (paidAmount >= dto.amount && dto.amount > 0
                ? InvoiceStatus.PAID
                : (paidAmount > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.PENDING));

        const invoice = new Invoice({
            id: crypto.randomUUID(),
            unit_id: dto.unitId,
            amount: dto.amount,
            paid_amount: paidAmount,
            period: dto.period,
            issue_date: new Date(),
            due_date: dto.dueDate,
            status: status,
            type: InvoiceType.DEBT,
            description: dto.description,
            receipt_number: dto.receiptNumber,
        });

        return await this.invoiceRepository.create(invoice);
    }
}
