import { IInvoiceRepository } from '../../domain/repository';
import { Invoice } from '../../domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';

export class GetUnitInvoices {
    constructor(private invoiceRepository: IInvoiceRepository) { }

    async execute(unitId: string, tag?: InvoiceTag): Promise<Invoice[]> {
        return await this.invoiceRepository.findAll({
            unit_id: unitId,
            ...(tag !== undefined ? { tag } : {})
        });
    }
}
