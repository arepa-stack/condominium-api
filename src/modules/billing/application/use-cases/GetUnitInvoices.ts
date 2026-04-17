import { IInvoiceRepository } from '../../domain/repository';
import { Invoice } from '../../domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';
import {
    PaginatedResult,
    PaginationInput,
    buildPaginatedResult,
    parsePaginationFilters,
} from '@/core/domain/pagination';

export interface GetUnitInvoicesOptions extends PaginationInput {
    tag?: InvoiceTag;
}

export class GetUnitInvoices {
    constructor(private invoiceRepository: IInvoiceRepository) { }

    /**
     * Paginated listing of invoices for a unit. Used by the admin route
     * at /admin/billing/units/:id/invoices.
     */
    async execute(
        unitId: string,
        options?: GetUnitInvoicesOptions
    ): Promise<PaginatedResult<Invoice>> {
        const pagination = parsePaginationFilters({
            page: options?.page,
            limit: options?.limit,
        });
        const { items, total } = await this.invoiceRepository.findAllPaginated(
            {
                unit_id: unitId,
                ...(options?.tag !== undefined ? { tag: options.tag } : {}),
            },
            pagination
        );
        return buildPaginatedResult(items, total, pagination);
    }

    /**
     * Legacy non-paginated listing, used by the APK resident view which
     * still returns a plain array.
     */
    async executeAll(unitId: string, tag?: InvoiceTag): Promise<Invoice[]> {
        return await this.invoiceRepository.findAll({
            unit_id: unitId,
            ...(tag !== undefined ? { tag } : {}),
        });
    }
}
