import { IPaymentAllocationRepository, PaymentAllocationResult } from '../../domain/repository';
import {
    PaginatedResult,
    PaginationInput,
    buildPaginatedResult,
    parsePaginationFilters,
} from '@/core/domain/pagination';

export class GetInvoicePayments {
    constructor(private allocationRepository: IPaymentAllocationRepository) { }

    async execute(
        invoiceId: string,
        input?: PaginationInput
    ): Promise<PaginatedResult<PaymentAllocationResult>> {
        const pagination = parsePaginationFilters(input);
        const { items, total } = await this.allocationRepository.findPaymentsByInvoiceIdPaginated(
            invoiceId,
            pagination
        );
        return buildPaginatedResult(items, total, pagination);
    }
}
