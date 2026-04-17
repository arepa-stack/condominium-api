import { IInvoiceRepository, FindAllInvoicesFilters, AdminInvoiceResult } from '../../domain/repository';
import { PaginatedResult, buildPaginatedResult, parsePaginationFilters } from '@/core/domain/pagination';

export class GetAllInvoices {
    constructor(private invoiceRepository: IInvoiceRepository) { }

    async execute(filters?: FindAllInvoicesFilters): Promise<PaginatedResult<AdminInvoiceResult>> {
        const pagination = parsePaginationFilters({
            page: filters?.page,
            limit: filters?.limit,
        });
        const { items, total } = await this.invoiceRepository.findInvoicesForAdmin(
            filters ?? {},
            pagination
        );
        return buildPaginatedResult(items, total, pagination);
    }
}
