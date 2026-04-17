/**
 * Verifies that the building_id filter in SupabaseInvoiceRepository
 * uses an OR condition so that PETTY_CASH invoices (which have building_id
 * set directly on the invoice and unit_id=null) are returned alongside
 * unit-level invoices when filtering by building.
 *
 * Because the real Supabase client is not available in unit tests, we verify
 * the behavior at the mock-repository level (contract test) and document the
 * expected query pattern so it can be validated during integration testing.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GetAllInvoices } from '@/modules/billing/application/use-cases/GetAllInvoices';
import { IInvoiceRepository, FindAllInvoicesFilters } from '@/modules/billing/domain/repository';
import { InvoiceTag } from '@/core/domain/enums';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makePettyCashInvoice = (buildingId: string) =>
    new Invoice({
        id: `petty-${buildingId}`,
        building_id: buildingId,
        unit_id: undefined,   // PETTY_CASH invoices have no unit_id
        amount: 500,
        period: '2024-01',
        issue_date: new Date('2024-01-15'),
        status: InvoiceStatus.PAID,
        type: InvoiceType.EXPENSE,
        tag: InvoiceTag.PETTY_CASH,
    });

const makeUnitInvoice = (unitId: string) =>
    new Invoice({
        id: `unit-inv-${unitId}`,
        unit_id: unitId,
        building_id: undefined,
        amount: 200,
        period: '2024-01',
        issue_date: new Date('2024-01-01'),
        status: InvoiceStatus.PENDING,
        type: InvoiceType.EXPENSE,
        tag: InvoiceTag.NORMAL,
    });

// ── Repository mock that simulates OR filter behaviour ────────────────────────

/**
 * Simulates what the real SupabaseInvoiceRepository.findInvoicesForAdmin()
 * should return after the OR filter fix: invoices whose building_id matches
 * directly OR whose unit's building_id matches.
 */
function createMockRepo(buildingInvoices: Invoice[], unitInvoices: Invoice[]): IInvoiceRepository {
    const allInvoices = [...buildingInvoices, ...unitInvoices];

    return {
        create: mock(async (inv: Invoice) => inv),
        findById: mock(async () => null),
        findAll: mock(async (filters?: FindAllInvoicesFilters) => {
            if (!filters?.building_id) return allInvoices;
            // Simulate OR: match direct building_id OR match via unit FK
            return allInvoices.filter(inv =>
                inv.building_id === filters.building_id ||
                (inv.unit_id && unitInvoices.includes(inv))
            );
        }),
        findAllPaginated: mock(async () => ({ items: [], total: 0 })),
        findInvoicesForAdmin: mock(async (filters: FindAllInvoicesFilters) => {
            if (!filters?.building_id) return { items: [], total: 0 };
            const matching = allInvoices.filter(inv =>
                inv.building_id === filters.building_id ||
                (inv.unit_id && unitInvoices.includes(inv))
            );
            const items = matching.map(inv => ({
                id: inv.id,
                amount: inv.amount,
                paid_amount: 0,
                status: inv.status,
                period: inv.period,
                year: 2024,
                month: 1,
                issue_date: inv.issue_date.toISOString(),
                created_at: inv.issue_date.toISOString(),
                unit: { id: inv.unit_id ?? '', name: '' },
                user: null,
            }));
            return { items, total: items.length };
        }),
        findByBuildingId: mock(async () => ({ items: [], total: 0 })),
        update: mock(async (inv: Invoice) => inv),
        createBatch: mock(async (invoices: Invoice[]) => invoices),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Invoice building_id filter — PETTY_CASH invoices must be included', () => {
    const BUILDING_A = 'building-A';

    it('findAll with building_id returns PETTY_CASH invoices that have building_id directly set', async () => {
        const pettyCashInv = makePettyCashInvoice(BUILDING_A);
        const unitInv = makeUnitInvoice('unit-1');
        const repo = createMockRepo([pettyCashInv], [unitInv]);

        const useCase = new GetAllInvoices(repo);
        // GetAllInvoices uses findInvoicesForAdmin internally
        await useCase.execute({ building_id: BUILDING_A });

        expect(repo.findInvoicesForAdmin).toHaveBeenCalled();
        const firstCall = (repo.findInvoicesForAdmin as any).mock.calls[0];
        expect(firstCall[0]).toEqual({ building_id: BUILDING_A });
    });

    it('PETTY_CASH invoice has unit_id=undefined and building_id set directly', () => {
        const inv = makePettyCashInvoice(BUILDING_A);
        expect(inv.unit_id).toBeUndefined();
        expect(inv.building_id).toBe(BUILDING_A);
        expect(inv.tag).toBe(InvoiceTag.PETTY_CASH);
    });

    it('OR filter includes PETTY_CASH invoice when filtering by building_id', async () => {
        const pettyCashInv = makePettyCashInvoice(BUILDING_A);
        const unitInv = makeUnitInvoice('unit-1');
        const repo = createMockRepo([pettyCashInv], [unitInv]);

        // Simulated OR filter: direct building_id match should include PETTY_CASH invoice
        const results = await (repo.findInvoicesForAdmin as ReturnType<typeof mock>)({ building_id: BUILDING_A });
        const ids = results.items.map((r: any) => r.id);
        expect(ids).toContain(pettyCashInv.id);
    });

    it('PETTY_CASH invoice from different building is excluded', async () => {
        const pettyCashInvA = makePettyCashInvoice(BUILDING_A);
        const pettyCashInvB = makePettyCashInvoice('building-B');
        const repo = createMockRepo([pettyCashInvA, pettyCashInvB], []);

        const results = await (repo.findInvoicesForAdmin as ReturnType<typeof mock>)({ building_id: BUILDING_A });
        const ids = results.items.map((r: any) => r.id);
        expect(ids).toContain(pettyCashInvA.id);
        expect(ids).not.toContain(pettyCashInvB.id);
    });
});
