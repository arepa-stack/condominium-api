import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GetAllInvoices } from '@/modules/billing/application/use-cases/GetAllInvoices';
import { GetUnitInvoices } from '@/modules/billing/application/use-cases/GetUnitInvoices';
import { IInvoiceRepository, FindAllInvoicesFilters } from '@/modules/billing/domain/repository';
import { InvoiceTag } from '@/core/domain/enums';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';

const makeInvoice = (overrides: Partial<ConstructorParameters<typeof Invoice>[0]> = {}) =>
    new Invoice({
        id: 'inv-1',
        unit_id: 'unit-1',
        amount: 100,
        period: '2024-01',
        issue_date: new Date('2024-01-01'),
        status: InvoiceStatus.PENDING,
        type: InvoiceType.EXPENSE,
        ...overrides,
    });

const makeAdminResult = () => ({
    id: 'inv-1',
    amount: 100,
    paid_amount: 0,
    status: 'PENDING',
    period: '2024-01',
    year: 2024,
    month: 1,
    issue_date: '2024-01-01',
    created_at: '2024-01-01T00:00:00.000Z',
    unit: { id: 'unit-1', name: 'Unit 1' },
    user: null,
});

const createMockRepo = (): IInvoiceRepository => ({
    create: mock(async (inv: Invoice) => inv),
    findById: mock(async (_id: string) => null),
    findAll: mock(async (_filters?: FindAllInvoicesFilters) => []),
    findAllPaginated: mock(async () => ({ items: [], total: 0 })),
    findInvoicesForAdmin: mock(async () => ({ items: [], total: 0 })),
    findByBuildingId: mock(async () => ({ items: [], total: 0 })),
    update: mock(async (inv: Invoice) => inv),
    createBatch: mock(async (invoices: Invoice[]) => invoices),
});

describe('GetAllInvoices — tag filter', () => {
    let mockRepo: IInvoiceRepository;

    const firstCallFilters = (spy: any) => (spy.mock.calls[0] ?? [])[0];
    const firstCallPagination = (spy: any) => (spy.mock.calls[0] ?? [])[1];

    beforeEach(() => {
        mockRepo = createMockRepo();
    });

    it('returns a PaginatedResult wrapper with six metadata fields', async () => {
        const useCase = new GetAllInvoices(mockRepo);
        const result = await useCase.execute();
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.metadata).toMatchObject({
            total: expect.any(Number),
            page: expect.any(Number),
            limit: expect.any(Number),
            total_pages: expect.any(Number),
            has_next_page: expect.any(Boolean),
            has_prev_page: expect.any(Boolean),
        });
    });

    it('should call findInvoicesForAdmin with empty filters when no filters provided', async () => {
        const useCase = new GetAllInvoices(mockRepo);
        await useCase.execute();
        expect(mockRepo.findInvoicesForAdmin).toHaveBeenCalled();
        expect(firstCallFilters(mockRepo.findInvoicesForAdmin)).toEqual({});
    });

    it('should forward tag filter to findInvoicesForAdmin', async () => {
        const useCase = new GetAllInvoices(mockRepo);
        await useCase.execute({ tag: InvoiceTag.PETTY_CASH });
        expect(firstCallFilters(mockRepo.findInvoicesForAdmin)).toEqual({ tag: InvoiceTag.PETTY_CASH });
    });

    it('should forward tag NORMAL to findInvoicesForAdmin', async () => {
        const useCase = new GetAllInvoices(mockRepo);
        await useCase.execute({ tag: InvoiceTag.NORMAL });
        expect(firstCallFilters(mockRepo.findInvoicesForAdmin)).toEqual({ tag: InvoiceTag.NORMAL });
    });

    it('should forward combined filters including tag', async () => {
        const useCase = new GetAllInvoices(mockRepo);
        const filters = { building_id: 'bldg-1', tag: InvoiceTag.PETTY_CASH, status: 'PENDING' };
        await useCase.execute(filters);
        expect(firstCallFilters(mockRepo.findInvoicesForAdmin)).toEqual(filters);
    });

    it('forwards pagination params (page + limit) to the repo', async () => {
        // Regression: the /admin/billing/invoices handler previously
        // accepted page/limit in the Elysia query schema but never
        // passed them down — the repo always saw undefined and fell
        // back to page=1, limit=10 regardless of what the client sent.
        const useCase = new GetAllInvoices(mockRepo);
        await useCase.execute({ page: 3, limit: 25 });
        const pagination = firstCallPagination(mockRepo.findInvoicesForAdmin);
        expect(pagination).toMatchObject({ page: 3, limit: 25, isAll: false });
    });

    it('honors limit="all" by flagging isAll on the pagination passed to the repo', async () => {
        const useCase = new GetAllInvoices(mockRepo);
        await useCase.execute({ limit: 'all' });
        const pagination = firstCallPagination(mockRepo.findInvoicesForAdmin);
        expect(pagination.isAll).toBe(true);
    });
});

describe('GetUnitInvoices — tag filter', () => {
    let mockRepo: IInvoiceRepository;

    beforeEach(() => {
        mockRepo = createMockRepo();
    });

    it('paginated path forwards unit_id only when no tag provided', async () => {
        const useCase = new GetUnitInvoices(mockRepo);
        const result = await useCase.execute('unit-1');
        expect(mockRepo.findAllPaginated).toHaveBeenCalled();
        const firstCall = (mockRepo.findAllPaginated as any).mock.calls[0];
        expect(firstCall[0]).toEqual({ unit_id: 'unit-1' });
        expect(result.data).toBeArray();
        expect(result.metadata).toBeDefined();
    });

    it('paginated path forwards tag + unit_id together', async () => {
        const useCase = new GetUnitInvoices(mockRepo);
        await useCase.execute('unit-1', { tag: InvoiceTag.PETTY_CASH });
        const firstCall = (mockRepo.findAllPaginated as any).mock.calls[0];
        expect(firstCall[0]).toEqual({ unit_id: 'unit-1', tag: InvoiceTag.PETTY_CASH });
    });

    it('paginated path honors explicit page + limit', async () => {
        const useCase = new GetUnitInvoices(mockRepo);
        await useCase.execute('unit-1', { page: 2, limit: 5 });
        const firstCall = (mockRepo.findAllPaginated as any).mock.calls[0];
        expect(firstCall[1]).toMatchObject({ page: 2, limit: 5, isAll: false });
    });

    it('executeAll keeps the legacy array shape used by the APK', async () => {
        const useCase = new GetUnitInvoices(mockRepo);
        await useCase.executeAll('unit-1', InvoiceTag.NORMAL);
        expect(mockRepo.findAll).toHaveBeenCalledWith({ unit_id: 'unit-1', tag: InvoiceTag.NORMAL });
    });
});

describe('GetAllInvoices — findByBuildingId delegation', () => {
    let mockRepo: IInvoiceRepository;

    beforeEach(() => {
        mockRepo = createMockRepo();
    });

    it('repository should expose findByBuildingId method', () => {
        expect(typeof mockRepo.findByBuildingId).toBe('function');
    });

    it('findByBuildingId should be callable with buildingId, filters and pagination', async () => {
        await mockRepo.findByBuildingId!(
            'bldg-1',
            { tag: InvoiceTag.PETTY_CASH },
            { page: 1, limit: 20, isAll: false }
        );
        expect(mockRepo.findByBuildingId).toHaveBeenCalledWith(
            'bldg-1',
            { tag: InvoiceTag.PETTY_CASH },
            { page: 1, limit: 20, isAll: false }
        );
    });
});
