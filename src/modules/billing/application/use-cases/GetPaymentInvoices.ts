import { IPaymentAllocationRepository } from '../../domain/repository';
import {
    PaginatedResult,
    PaginationInput,
    buildPaginatedResult,
    parsePaginationFilters,
} from '@/core/domain/pagination';

export class GetPaymentInvoices {
    constructor(private allocationRepository: IPaymentAllocationRepository) { }

    async execute(
        paymentId: string,
        input?: PaginationInput
    ): Promise<PaginatedResult<any>> {
        const pagination = parsePaginationFilters(input);
        const { items, total } = await this.allocationRepository.findInvoicesByPaymentIdPaginated(
            paymentId,
            pagination
        );
        return buildPaginatedResult(items, total, pagination);
    }
}
