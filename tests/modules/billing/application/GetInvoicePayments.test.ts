import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GetInvoicePayments } from '@/modules/billing/application/use-cases/GetInvoicePayments';
import { GetPaymentInvoices } from '@/modules/billing/application/use-cases/GetPaymentInvoices';
import { IPaymentAllocationRepository } from '@/modules/billing/domain/repository';

const makeRepo = (): IPaymentAllocationRepository => ({
    create: mock(async (a: any) => a),
    delete: mock(async () => { }),
    findByPaymentId: mock(async () => []),
    findByInvoiceId: mock(async () => []),
    findPaymentsByInvoiceId: mock(async () => []),
    findInvoicesByPaymentId: mock(async () => []),
    findPaymentsByInvoiceIdPaginated: mock(async () => ({ items: [], total: 0 })),
    findInvoicesByPaymentIdPaginated: mock(async () => ({ items: [], total: 0 })),
});

describe('GetInvoicePayments', () => {
    let repo: IPaymentAllocationRepository;

    beforeEach(() => {
        repo = makeRepo();
    });

    it('forwards page + limit to the paginated repo call and returns a PaginatedResult', async () => {
        const useCase = new GetInvoicePayments(repo);
        const result = await useCase.execute('invoice-1', { page: 2, limit: 5 });

        expect(repo.findPaymentsByInvoiceIdPaginated).toHaveBeenCalled();
        const call = (repo.findPaymentsByInvoiceIdPaginated as any).mock.calls[0];
        expect(call[0]).toBe('invoice-1');
        expect(call[1]).toMatchObject({ page: 2, limit: 5, isAll: false });

        expect(result.data).toBeArray();
        expect(result.metadata).toMatchObject({
            total: expect.any(Number),
            page: expect.any(Number),
            limit: expect.any(Number),
            total_pages: expect.any(Number),
            has_next_page: expect.any(Boolean),
            has_prev_page: expect.any(Boolean),
        });
    });
});

describe('GetPaymentInvoices', () => {
    let repo: IPaymentAllocationRepository;

    beforeEach(() => {
        repo = makeRepo();
    });

    it('forwards page + limit to the paginated repo call and returns a PaginatedResult', async () => {
        const useCase = new GetPaymentInvoices(repo);
        const result = await useCase.execute('payment-1', { page: 2, limit: 5 });

        expect(repo.findInvoicesByPaymentIdPaginated).toHaveBeenCalled();
        const call = (repo.findInvoicesByPaymentIdPaginated as any).mock.calls[0];
        expect(call[0]).toBe('payment-1');
        expect(call[1]).toMatchObject({ page: 2, limit: 5, isAll: false });

        expect(result.data).toBeArray();
        expect(result.metadata).toBeDefined();
    });
});
