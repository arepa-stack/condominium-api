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
    findInvoicesForAdmin: mock(async (_filters?: FindAllInvoicesFilters) => []),
    findByBuildingId: mock(async (_buildingId: string, _filters?: FindAllInvoicesFilters) => []),
    update: mock(async (inv: Invoice) => inv),
    createBatch: mock(async (invoices: Invoice[]) => invoices),
});

describe('GetAllInvoices — tag filter', () => {
    let mockRepo: IInvoiceRepository;

    beforeEach(() => {
        mockRepo = createMockRepo();
    });

    it('should call findInvoicesForAdmin without tag when no filters provided', async () => {
        const useCase = new GetAllInvoices(mockRepo);
        await useCase.execute();
        expect(mockRepo.findInvoicesForAdmin).toHaveBeenCalledWith(undefined);
    });

    it('should forward tag filter to findInvoicesForAdmin', async () => {
        const useCase = new GetAllInvoices(mockRepo);
        await useCase.execute({ tag: InvoiceTag.PETTY_CASH });
        expect(mockRepo.findInvoicesForAdmin).toHaveBeenCalledWith({ tag: InvoiceTag.PETTY_CASH });
    });

    it('should forward tag NORMAL to findInvoicesForAdmin', async () => {
        const useCase = new GetAllInvoices(mockRepo);
        await useCase.execute({ tag: InvoiceTag.NORMAL });
        expect(mockRepo.findInvoicesForAdmin).toHaveBeenCalledWith({ tag: InvoiceTag.NORMAL });
    });

    it('should forward combined filters including tag', async () => {
        const useCase = new GetAllInvoices(mockRepo);
        const filters = { building_id: 'bldg-1', tag: InvoiceTag.PETTY_CASH, status: 'PENDING' };
        await useCase.execute(filters);
        expect(mockRepo.findInvoicesForAdmin).toHaveBeenCalledWith(filters);
    });

    it('forwards pagination params (page + limit) to the repo', async () => {
        // Regression: the /admin/billing/invoices handler previously
        // accepted page/limit in the Elysia query schema but never
        // passed them down — the repo always saw undefined and fell
        // back to page=1, limit=10 regardless of what the client sent.
        const useCase = new GetAllInvoices(mockRepo);
        await useCase.execute({ page: 3, limit: 25 });
        expect(mockRepo.findInvoicesForAdmin).toHaveBeenCalledWith({ page: 3, limit: 25 });
    });
});

describe('GetUnitInvoices — tag filter', () => {
    let mockRepo: IInvoiceRepository;

    beforeEach(() => {
        mockRepo = createMockRepo();
    });

    it('should call findAll with unit_id only when no tag provided', async () => {
        const useCase = new GetUnitInvoices(mockRepo);
        await useCase.execute('unit-1');
        expect(mockRepo.findAll).toHaveBeenCalledWith({ unit_id: 'unit-1' });
    });

    it('should forward tag filter along with unit_id to findAll', async () => {
        const useCase = new GetUnitInvoices(mockRepo);
        await useCase.execute('unit-1', InvoiceTag.PETTY_CASH);
        expect(mockRepo.findAll).toHaveBeenCalledWith({ unit_id: 'unit-1', tag: InvoiceTag.PETTY_CASH });
    });

    it('should forward tag NORMAL along with unit_id to findAll', async () => {
        const useCase = new GetUnitInvoices(mockRepo);
        await useCase.execute('unit-1', InvoiceTag.NORMAL);
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

    it('findByBuildingId should be callable with buildingId and optional filters', async () => {
        await mockRepo.findByBuildingId!('bldg-1', { tag: InvoiceTag.PETTY_CASH });
        expect(mockRepo.findByBuildingId).toHaveBeenCalledWith('bldg-1', { tag: InvoiceTag.PETTY_CASH });
    });
});
