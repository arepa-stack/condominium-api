import { IInvoiceRepository, FindAllInvoicesFilters, AdminInvoiceResult } from '../../domain/repository';
import { PaginatedResult } from '@/core/domain/pagination';

export class GetAllInvoices {
    constructor(private invoiceRepository: IInvoiceRepository) { }

    async execute(filters?: FindAllInvoicesFilters): Promise<PaginatedResult<AdminInvoiceResult>> {
        return await this.invoiceRepository.findInvoicesForAdmin(filters);
    }
}
