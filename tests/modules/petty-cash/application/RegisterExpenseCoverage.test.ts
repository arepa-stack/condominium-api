/**
 * Tests for RegisterPettyCashExpense — coverage output.
 *
 * Scenarios:
 *   1. Coverage present with correct math when invoiceRepo + unitRepo provided.
 *   2. Coverage present even when pending = 0 (balance exactly at target).
 *   3. Coverage absent (undefined) when deps not provided (backward compat).
 *   4. Parity: coverage.pending_to_assess === PreviewAssessments result for same state.
 */

import { describe, it, expect, mock } from 'bun:test';
import {
    RegisterPettyCashExpense,
    RegisterExpenseDTO,
} from '@/modules/petty-cash/application/use-cases/RegisterPettyCashExpense';
import { PreviewAssessments } from '@/modules/petty-cash/application/use-cases/PreviewAssessments';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { PettyCashEntry } from '@/modules/petty-cash/domain/entities/PettyCashEntry';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag, PettyCashCategory } from '@/core/domain/enums';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUnit(id: string, name: string) {
    return { id, name, building_id: 'b1', floor: '1', aliquot: 0, toJSON: () => ({ id, name }) };
}

function makePettyCashRepo(options: {
    fund?: PettyCashFund;
    balance?: number;
} = {}) {
    const fund = options.fund ?? new PettyCashFund('f1', 'b1', new Date(), 0);
    return {
        findFundByBuildingId: mock(() => Promise.resolve(fund)),
        findOrCreateFund: mock(() => Promise.resolve(fund)),
        getBalance: mock(() => Promise.resolve(options.balance ?? 0)),
        getBalanceByCurrency: mock(() => Promise.resolve([])),
        addEntry: mock(async (e: PettyCashEntry) => e),
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

function makeInvoiceRepo(invoices: Invoice[] = []) {
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

function makeUnitRepo(units: ReturnType<typeof makeUnit>[]) {
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

function baseExpenseDTO(overrides: Partial<RegisterExpenseDTO> = {}): RegisterExpenseDTO {
    return {
        buildingId: 'b1',
        amount: 100,
        description: 'Office supplies expense',
        category: PettyCashCategory.OTHER,
        userId: 'user-1',
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RegisterPettyCashExpense — coverage output', () => {
    it('returns coverage with correct math when invoiceRepo + unitRepo provided', async () => {
        // Fund with target_fund = 200. After expense of 100, balance = -100
        // (mocked getBalance returns post-save balance).
        // coverage.pending = max(0, 200 - (-100 + 0)) = 300
        const fund = new PettyCashFund('f1', 'b1', new Date(), 200);
        const pcRepo = makePettyCashRepo({ fund, balance: -100 });
        // Post-save balance is -100 (no invoices outstanding)
        const invoiceRepo = makeInvoiceRepo([]);

        const useCase = new RegisterPettyCashExpense(
            pcRepo as any,
            undefined, // buildingRepo — not needed for USD
            undefined, // exchangeRateService
            invoiceRepo as any
        );

        const result = await useCase.execute(baseExpenseDTO({ amount: 100 }));

        expect(result.coverage).toBeDefined();
        expect(result.coverage!.pending_to_assess).toBe(300);
        expect(result.coverage!.target_fund).toBe(200);
        expect(result.coverage!.balance).toBe(-100);
    });

    it('coverage present even when pending_to_assess = 0 (balance at or above target)', async () => {
        // Fund target = 50, balance after expense = 100 — above target, pending = 0
        const fund = new PettyCashFund('f1', 'b1', new Date(), 50);
        const pcRepo = makePettyCashRepo({ fund, balance: 100 });
        const invoiceRepo = makeInvoiceRepo([]);

        const useCase = new RegisterPettyCashExpense(
            pcRepo as any,
            undefined,
            undefined,
            invoiceRepo as any
        );

        const result = await useCase.execute(baseExpenseDTO({ amount: 10 }));

        expect(result.coverage).toBeDefined();
        expect(result.coverage!.pending_to_assess).toBe(0);
    });

    it('coverage absent (undefined) when invoiceRepo and unitRepo not provided', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date(), 0);
        const pcRepo = makePettyCashRepo({ fund, balance: -100 });

        // Original 3-arg constructor — no coverage deps
        const useCase = new RegisterPettyCashExpense(pcRepo as any);

        const result = await useCase.execute(baseExpenseDTO({ amount: 100 }));

        // Backward compatible: coverage is absent
        expect((result as any).coverage).toBeUndefined();
    });

    it('parity: coverage.pending_to_assess equals PreviewAssessments result for same state', async () => {
        // Setup identical state for both use cases.
        const fund = new PettyCashFund('f1', 'b1', new Date(), 100);
        // Post-expense balance = -50 (mocked)
        const pcRepo = makePettyCashRepo({ fund, balance: -50 });
        const invoiceRepo = makeInvoiceRepo([]);
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];
        const unitRepo = makeUnitRepo(units);

        // RegisterExpense result
        const expenseUseCase = new RegisterPettyCashExpense(
            pcRepo as any,
            undefined,
            undefined,
            invoiceRepo as any
        );
        const expenseResult = await expenseUseCase.execute(baseExpenseDTO({ amount: 50 }));

        // PreviewAssessments for the same fund/balance
        const previewUseCase = new PreviewAssessments(
            invoiceRepo as any,
            unitRepo as any,
            pcRepo as any
        );
        const previewResult = await previewUseCase.execute('b1');

        expect(expenseResult.coverage!.pending_to_assess).toBe(previewResult.pending_to_assess);
    });

    it('entry fields are preserved in result (backward compat)', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date(), 0);
        const pcRepo = makePettyCashRepo({ fund, balance: 0 });

        const useCase = new RegisterPettyCashExpense(pcRepo as any);

        const result = await useCase.execute(baseExpenseDTO({ amount: 200, description: 'Test expense' }));

        // Core entry fields must still be present
        expect(result.amount).toBe(-200);
        expect(result.description).toBe('Test expense');
        expect(result.fund_id).toBe('f1');
    });
});
