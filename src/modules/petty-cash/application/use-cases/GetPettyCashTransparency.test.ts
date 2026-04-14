import { describe, expect, it, mock } from 'bun:test';
import { GetPettyCashTransparency } from './GetPettyCashTransparency';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';

const makeInvoice = (overrides: {
    id: string;
    unit_id?: string;
    amount: number;
    paid_amount: number;
    status: InvoiceStatus;
    period?: string;
}) => new Invoice({
    id: overrides.id,
    unit_id: overrides.unit_id,
    building_id: 'b1',
    amount: overrides.amount,
    paid_amount: overrides.paid_amount,
    period: overrides.period ?? '2024-01',
    issue_date: new Date(),
    status: overrides.status,
    type: InvoiceType.DEBT,
    tag: InvoiceTag.PETTY_CASH
});

const units = [
    { id: 'u1', name: 'Apto 1' },
    { id: 'u2', name: 'Apto 2' }
];

const makeRepos = (invoices: Invoice[], queriedFilters: { period?: string }[] = []) => ({
    invoiceRepo: {
        findAll: mock(async (filters: any) => {
            queriedFilters.push(filters);
            return invoices.filter(inv => !filters.period || inv.period === filters.period);
        })
    },
    unitRepo: {
        findByBuildingId: mock(async () => units as any)
    }
});

describe('GetPettyCashTransparency', () => {
    it('caps contribution at quota (RN1, RN5, CA9)', async () => {
        const invoices = [
            makeInvoice({ id: 'i1', unit_id: 'u1', amount: 80, paid_amount: 100, status: InvoiceStatus.PAID }),
            makeInvoice({ id: 'i2', unit_id: 'u2', amount: 80, paid_amount: 30, status: InvoiceStatus.PARTIAL })
        ];
        const { invoiceRepo, unitRepo } = makeRepos(invoices);

        const useCase = new GetPettyCashTransparency(invoiceRepo as any, unitRepo as any);
        const result = await useCase.execute('b1', '2024-01');

        expect(result.period).toBe('2024-01');
        expect(result.total_to_collect).toBe(160);
        // Apto 1 overpaid (100) but capped to its quota (80).
        // Apto 2 paid 30.
        expect(result.total_collected).toBe(110);
        expect(result.collection_percentage).toBe(68.75);

        const apto1 = result.units.find(u => u.unit_id === 'u1');
        expect(apto1?.covered_amount).toBe(80);
        expect(apto1?.expected_amount).toBe(80);

        const apto2 = result.units.find(u => u.unit_id === 'u2');
        expect(apto2?.covered_amount).toBe(30);
        expect(apto2?.expected_amount).toBe(80);
    });

    it('rejects calls without a period', async () => {
        const { invoiceRepo, unitRepo } = makeRepos([]);
        const useCase = new GetPettyCashTransparency(invoiceRepo as any, unitRepo as any);

        await expect(useCase.execute('b1', '')).rejects.toThrow(/period is required/);
        await expect(useCase.execute('b1', '   ')).rejects.toThrow(/period is required/);
    });

    it('passes the period to the invoice repo filter', async () => {
        const queried: { period?: string }[] = [];
        const invoices = [
            makeInvoice({ id: 'i1', unit_id: 'u1', amount: 80, paid_amount: 0, status: InvoiceStatus.PENDING })
        ];
        const { invoiceRepo, unitRepo } = makeRepos(invoices, queried);

        const useCase = new GetPettyCashTransparency(invoiceRepo as any, unitRepo as any);
        await useCase.execute('b1', '2024-03');

        expect(queried).toHaveLength(1);
        expect(queried[0].period).toBe('2024-03');
    });

    it('excludes CANCELLED invoices from the collection total', async () => {
        // Apto 1 has a CANCELLED invoice (must not count in totals or %).
        // Apto 2 has a normal PARTIAL invoice.
        const invoices = [
            makeInvoice({ id: 'i1', unit_id: 'u1', amount: 80, paid_amount: 0, status: InvoiceStatus.CANCELLED }),
            makeInvoice({ id: 'i2', unit_id: 'u2', amount: 80, paid_amount: 30, status: InvoiceStatus.PARTIAL })
        ];
        const { invoiceRepo, unitRepo } = makeRepos(invoices);

        const useCase = new GetPettyCashTransparency(invoiceRepo as any, unitRepo as any);
        const result = await useCase.execute('b1', '2024-01');

        // Only Apto 2 contributes to the totals; Apto 1's cancelled quota
        // is treated as if the unit had no assessment.
        expect(result.total_to_collect).toBe(80);
        expect(result.total_collected).toBe(30);
        expect(result.collection_percentage).toBe(37.5);

        // Apto 1 still appears in the output, but with zeros and PENDING.
        const apto1 = result.units.find(u => u.unit_id === 'u1');
        expect(apto1?.expected_amount).toBe(0);
        expect(apto1?.covered_amount).toBe(0);
        expect(apto1?.status).toBe(InvoiceStatus.PENDING);
    });

    it('only counts invoices from the requested period', async () => {
        // Simulated: repo would return only period-matching invoices
        // because we pass the filter through, but we verify end-to-end
        // by mocking the filter behavior.
        const invoices = [
            makeInvoice({ id: 'i-jan', unit_id: 'u1', amount: 80, paid_amount: 80, status: InvoiceStatus.PAID, period: '2024-01' }),
            makeInvoice({ id: 'i-feb', unit_id: 'u1', amount: 80, paid_amount: 0, status: InvoiceStatus.PENDING, period: '2024-02' })
        ];
        const { invoiceRepo, unitRepo } = makeRepos(invoices);

        const useCase = new GetPettyCashTransparency(invoiceRepo as any, unitRepo as any);
        const febResult = await useCase.execute('b1', '2024-02');

        // Only the Feb invoice counts toward the Feb report.
        expect(febResult.total_to_collect).toBe(80);
        expect(febResult.total_collected).toBe(0);
        expect(febResult.units.find(u => u.unit_id === 'u1')?.status).toBe(InvoiceStatus.PENDING);
    });

    it('lists units with no assessment as PENDING with zero quota', async () => {
        // Only Apto 1 has an invoice this period. Apto 2 has none.
        const invoices = [
            makeInvoice({ id: 'i1', unit_id: 'u1', amount: 80, paid_amount: 80, status: InvoiceStatus.PAID })
        ];
        const { invoiceRepo, unitRepo } = makeRepos(invoices);

        const useCase = new GetPettyCashTransparency(invoiceRepo as any, unitRepo as any);
        const result = await useCase.execute('b1', '2024-01');

        expect(result.units).toHaveLength(2);
        const apto2 = result.units.find(u => u.unit_id === 'u2');
        expect(apto2?.expected_amount).toBe(0);
        expect(apto2?.covered_amount).toBe(0);
        expect(apto2?.status).toBe(InvoiceStatus.PENDING);

        // Totals only reflect Apto 1.
        expect(result.total_to_collect).toBe(80);
        expect(result.total_collected).toBe(80);
        expect(result.collection_percentage).toBe(100);
    });

    it('aggregates multiple active invoices for the same unit in the same period', async () => {
        // A unit can have multiple PETTY_CASH invoices in one period
        // when the overage grows in stages. Each tranche must be summed;
        // the previous implementation (Map last-wins) silently dropped
        // earlier tranches and under-reported total_to_collect.
        const invoices = [
            // Apto 1: two tranches, one fully paid, one partially paid
            makeInvoice({ id: 'i1a', unit_id: 'u1', amount: 50, paid_amount: 50, status: InvoiceStatus.PAID }),
            makeInvoice({ id: 'i1b', unit_id: 'u1', amount: 30, paid_amount: 10, status: InvoiceStatus.PARTIAL }),
            // Apto 2: two tranches, both fully paid
            makeInvoice({ id: 'i2a', unit_id: 'u2', amount: 40, paid_amount: 40, status: InvoiceStatus.PAID }),
            makeInvoice({ id: 'i2b', unit_id: 'u2', amount: 20, paid_amount: 20, status: InvoiceStatus.PAID })
        ];
        const { invoiceRepo, unitRepo } = makeRepos(invoices);

        const useCase = new GetPettyCashTransparency(invoiceRepo as any, unitRepo as any);
        const result = await useCase.execute('b1', '2024-01');

        // Apto 1: expected = 50+30=80, covered = 50+10=60 → PARTIAL
        // Apto 2: expected = 40+20=60, covered = 40+20=60 → PAID
        expect(result.total_to_collect).toBe(140);
        expect(result.total_collected).toBe(120);
        expect(result.collection_percentage).toBeCloseTo(85.71, 2);

        const apto1 = result.units.find(u => u.unit_id === 'u1');
        expect(apto1?.expected_amount).toBe(80);
        expect(apto1?.covered_amount).toBe(60);
        expect(apto1?.status).toBe(InvoiceStatus.PARTIAL);

        const apto2 = result.units.find(u => u.unit_id === 'u2');
        expect(apto2?.expected_amount).toBe(60);
        expect(apto2?.covered_amount).toBe(60);
        expect(apto2?.status).toBe(InvoiceStatus.PAID);
    });

    it('caps each tranche independently when aggregating (overpay on one tranche does not cover another)', async () => {
        // Apto 1: tranche A overpaid (50 paid, 30 quota → excess goes to
        // credit ledger, not to tranche B). Tranche B is unpaid.
        // Expected combined: expected=60, covered=30+0=30, status=PARTIAL.
        const invoices = [
            makeInvoice({ id: 'i1a', unit_id: 'u1', amount: 30, paid_amount: 50, status: InvoiceStatus.PAID }),
            makeInvoice({ id: 'i1b', unit_id: 'u1', amount: 30, paid_amount: 0, status: InvoiceStatus.PENDING })
        ];
        const { invoiceRepo, unitRepo } = makeRepos(invoices);

        const useCase = new GetPettyCashTransparency(invoiceRepo as any, unitRepo as any);
        const result = await useCase.execute('b1', '2024-01');

        const apto1 = result.units.find(u => u.unit_id === 'u1');
        expect(apto1?.expected_amount).toBe(60);
        expect(apto1?.covered_amount).toBe(30);
        expect(apto1?.status).toBe(InvoiceStatus.PARTIAL);
        expect(result.total_to_collect).toBe(60);
        expect(result.total_collected).toBe(30);
    });

    it('returns 0% when there is nothing to collect', async () => {
        const { invoiceRepo, unitRepo } = makeRepos([]);
        const useCase = new GetPettyCashTransparency(invoiceRepo as any, unitRepo as any);
        const result = await useCase.execute('b1', '2024-01');

        expect(result.total_to_collect).toBe(0);
        expect(result.total_collected).toBe(0);
        expect(result.collection_percentage).toBe(0);
    });
});
