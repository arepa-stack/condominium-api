/**
 * Tests for PreviewAssessments — target_fund wiring.
 *
 * Verifies that fund.target_fund drives pending_to_assess correctly.
 * Core scenario: balance 20, receivables 0, target 100 → pending 80.
 */

import { describe, test, expect } from 'bun:test';
import { mock } from 'bun:test';
import { PreviewAssessments } from '@/modules/petty-cash/application/use-cases/PreviewAssessments';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';

function makeUnit(id: string, name: string) {
    return { id, name, building_id: 'b1', floor: '1', aliquot: 0, toJSON: () => ({ id, name }) };
}

function mockInvoiceRepo(invoices: Invoice[]) {
    return {
        findAll: mock(() => Promise.resolve(invoices)),
        findAllPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
        findById: mock(() => Promise.resolve(null)),
        findInvoicesForAdmin: mock(() => Promise.resolve({ items: [], total: 0 })),
        findByBuildingId: mock(() => Promise.resolve({ items: [], total: 0 })),
        create: mock((inv: Invoice) => Promise.resolve(inv)),
        update: mock((inv: Invoice) => Promise.resolve(inv)),
        createBatch: mock((invs: Invoice[]) => Promise.resolve(invs)),
    };
}

function mockUnitRepo(units: ReturnType<typeof makeUnit>[]) {
    return {
        findByBuildingId: mock(() => Promise.resolve(units)),
        findByBuildingIdPaginated: mock(() => Promise.resolve({ items: units, total: units.length })),
        findById: mock(() => Promise.resolve(null)),
        create: mock(() => Promise.resolve(units[0])),
        update: mock(() => Promise.resolve(units[0])),
        delete: mock(() => Promise.resolve()),
        createBatch: mock(() => Promise.resolve(units)),
    };
}

function mockPettyCashRepo(options: {
    fund?: PettyCashFund | null;
    balance?: number;
}) {
    const fund = options.fund ?? null;
    return {
        findFundByBuildingId: mock(() => Promise.resolve(fund)),
        findOrCreateFund: mock(() =>
            Promise.resolve(fund ?? new PettyCashFund('f1', 'b1', new Date()))
        ),
        getBalance: mock(() => Promise.resolve(options.balance ?? 0)),
        getBalanceByCurrency: mock(() => Promise.resolve([])),
        addEntry: mock((e: any) => Promise.resolve(e)),
        findEntryById: mock(() => Promise.resolve(null)),
        findEntriesByFundId: mock(() => Promise.resolve([])),
        findEntriesByFundIdPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
        findEntriesByReference: mock(() => Promise.resolve([])),
        findReversedOriginalIds: mock(() => Promise.resolve(new Set<string>())),
        createAssessment: mock((a: any) => Promise.resolve(a)),
        findAssessmentsByFundId: mock(() => Promise.resolve([])),
        findAssessmentsByPeriod: mock(() => Promise.resolve([])),
        updateFundTargetFund: mock(() => Promise.resolve()),
        findAssessmentById: mock(() => Promise.resolve(null)),
    };
}

describe('PreviewAssessments — target_fund from fund entity', () => {
    /**
     * Core B3 scenario from spec:
     * balance 20, receivables 0, target 100 → pending 80
     *
     * With the hardcoded 0, pending would be max(0, 0 - (2000 + 0)) = 0 — WRONG.
     * With real target, pending = max(0, 10000 - (2000 + 0)) = 8000 cents = 80 — CORRECT.
     */
    test('target_fund on fund drives pending_to_assess (balance 20, target 100 → pending 80)', async () => {
        // Fund with target_fund = 100
        const fund = new PettyCashFund('f1', 'b1', new Date(), 100);
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo({ fund, balance: 20 }) as any
        );

        const result = await preview.execute('b1');

        // pending = max(0, 100 - (20 + 0)) = 80
        expect(result.pending_to_assess).toBe(80);
        // target_fund returned in response
        expect(result.target_fund).toBe(100);
        // balance still positive
        expect(result.current_balance).toBe(20);
        // total_overage = max(0, -20) = 0 (no overdraft)
        expect(result.total_overage).toBe(0);
    });

    test('balance above target → pending 0', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date(), 50);
        const units = [makeUnit('u1', '1A')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo({ fund, balance: 150 }) as any
        );

        const result = await preview.execute('b1');
        expect(result.pending_to_assess).toBe(0);
        expect(result.target_fund).toBe(50);
    });

    test('no fund → target_fund returns 0 in response', async () => {
        const units = [makeUnit('u1', '1A')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo({ fund: null, balance: 0 }) as any
        );

        const result = await preview.execute('b1');
        expect(result.target_fund).toBe(0);
        expect(result.pending_to_assess).toBe(0);
    });
});
