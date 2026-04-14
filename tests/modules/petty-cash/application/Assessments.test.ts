import { describe, test, expect, mock } from 'bun:test';
import { PreviewAssessments } from '@/modules/petty-cash/application/use-cases/PreviewAssessments';
import { GenerateAssessments } from '@/modules/petty-cash/application/use-cases/GenerateAssessments';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag, PettyCashTransactionType, PettyCashCategory } from '@/core/domain/enums';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { PettyCashTransaction } from '@/modules/petty-cash/domain/entities/PettyCashTransaction';

// Helpers
function makeUnit(id: string, name: string) {
    return { id, name, building_id: 'b1', floor: '1', aliquot: 0, toJSON: () => ({ id, name }) };
}

function makeUnitInvoice(unitId: string, amount: number) {
    return new Invoice({
        id: crypto.randomUUID(),
        unit_id: unitId,
        building_id: 'b1',
        amount,
        period: '2026-04',
        issue_date: new Date(),
        status: InvoiceStatus.PENDING,
        type: InvoiceType.EXPENSE,
        tag: InvoiceTag.PETTY_CASH,
        description: 'Cuota reposición caja chica'
    });
}

function mockInvoiceRepo(invoices: Invoice[]) {
    return {
        findAll: mock(() => Promise.resolve(invoices)),
        findById: mock(() => Promise.resolve(null)),
        findInvoicesForAdmin: mock(() => Promise.resolve([])),
        findByBuildingId: mock(() => Promise.resolve([])),
        create: mock((inv: Invoice) => Promise.resolve(inv)),
        update: mock((inv: Invoice) => Promise.resolve(inv)),
        createBatch: mock((invs: Invoice[]) => Promise.resolve(invs)),
    };
}

function mockUnitRepo(units: ReturnType<typeof makeUnit>[]) {
    return {
        findByBuildingId: mock(() => Promise.resolve(units)),
        findById: mock(() => Promise.resolve(null)),
        create: mock(() => Promise.resolve(units[0])),
        update: mock(() => Promise.resolve(units[0])),
        delete: mock(() => Promise.resolve()),
        createBatch: mock(() => Promise.resolve(units)),
    };
}

function mockPettyCashRepo(options: {
    fund?: PettyCashFund | null;
    transactions?: PettyCashTransaction[];
}) {
    return {
        findFundByBuildingId: mock(() => Promise.resolve(options.fund ?? null)),
        saveFund: mock((f: PettyCashFund) => Promise.resolve(f)),
        saveTransaction: mock((t: PettyCashTransaction) => Promise.resolve(t)),
        findTransactionsByFundId: mock(() => Promise.resolve(options.transactions ?? [])),
    };
}

// ── Preview ─────────────────────────────────────────────────────────────────

describe('PreviewAssessments', () => {
    test('calculates overage from transactions (expenses > income)', async () => {
        const fund = new PettyCashFund('f1', 'b1', 0, 'USD', new Date());
        const transactions = [
            new PettyCashTransaction('t1', 'f1', PettyCashTransactionType.INCOME, 100, 'income', PettyCashCategory.OTHER, 'u1'),
            new PettyCashTransaction('t2', 'f1', PettyCashTransactionType.EXPENSE, 200, 'expense', PettyCashCategory.REPAIR, 'u1'),
        ];
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, transactions })
        );
        const result = await preview.execute('b1');

        // overage = expenses(200) - income(100) - balance(0) = 100
        expect(result.total_overage).toBe(100);
        expect(result.total_expenses).toBe(200);
        expect(result.total_income).toBe(100);
        expect(result.pending_to_assess).toBe(100);
        expect(result.units[0].amount).toBe(50);
        expect(result.units[1].amount).toBe(50);
    });

    test('subtracts already assessed unit invoices', async () => {
        const fund = new PettyCashFund('f1', 'b1', 0, 'USD', new Date());
        const transactions = [
            new PettyCashTransaction('t1', 'f1', PettyCashTransactionType.EXPENSE, 200, 'expense', PettyCashCategory.REPAIR, 'u1'),
        ];
        const unitInvoices = [makeUnitInvoice('u1', 100), makeUnitInvoice('u2', 100)];
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo(unitInvoices),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, transactions })
        );
        const result = await preview.execute('b1');

        // overage = 200 - 0 - 0 = 200, already assessed = 200, pending = 0
        expect(result.total_overage).toBe(200);
        expect(result.already_assessed).toBe(200);
        expect(result.pending_to_assess).toBe(0);
    });

    test('no overage when income covers expenses', async () => {
        const fund = new PettyCashFund('f1', 'b1', 50, 'USD', new Date());
        const transactions = [
            new PettyCashTransaction('t1', 'f1', PettyCashTransactionType.INCOME, 200, 'income', PettyCashCategory.OTHER, 'u1'),
            new PettyCashTransaction('t2', 'f1', PettyCashTransactionType.EXPENSE, 150, 'expense', PettyCashCategory.REPAIR, 'u1'),
        ];
        const units = [makeUnit('u1', '1A')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, transactions })
        );
        const result = await preview.execute('b1');

        // overage = 150 - 200 - 50 = -100 → clamped to 0
        expect(result.total_overage).toBe(0);
        expect(result.pending_to_assess).toBe(0);
    });

    test('returns zero when no fund exists', async () => {
        const units = [makeUnit('u1', '1A')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund: null })
        );
        const result = await preview.execute('b1');

        expect(result.total_overage).toBe(0);
        expect(result.pending_to_assess).toBe(0);
    });

    // Regression: ticket #46 — $8000 / 38 units with legacy drifted data.
    // Previously, summing 38 float-stored invoices produced
    // already_assessed = 7999.92000000...01 and
    // pending_to_assess  = 0.07999999999901775. With integer cents the
    // sum is exact: 799992 cents → pending = 8 cents = 0.08, clean.
    test('no float drift when summing drifted invoice amounts (ticket #46)', async () => {
        const fund = new PettyCashFund('f1', 'b1', 0, 'USD', new Date());
        const transactions = [
            new PettyCashTransaction('t1', 'f1', PettyCashTransactionType.EXPENSE, 25000, 'expense', PettyCashCategory.REPAIR, 'u1'),
            new PettyCashTransaction('t2', 'f1', PettyCashTransactionType.INCOME, 17000, 'income', PettyCashCategory.OTHER, 'u1'),
        ];
        // 38 legacy invoices of 210.52 each. Naive float-sum reduce
        // would drift; integer cents gives the exact 799976.
        const units = Array.from({ length: 38 }, (_, i) => makeUnit(`u${i + 1}`, `Apto ${i + 1}`));
        const drifted = units.map(u => makeUnitInvoice(u.id, 210.52));

        const preview = new PreviewAssessments(
            mockInvoiceRepo(drifted),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, transactions })
        );
        const result = await preview.execute('b1');

        // Overage = 25000 - 17000 - 0 = 8000 (800000 cents)
        // Already assessed = 38 * 210.52 = 7999.76 (799976 cents — exact)
        // Pending = 24 cents = 0.24, no trailing float noise.
        expect(result.total_overage).toBe(8000);
        expect(result.already_assessed).toBe(7999.76);
        expect(result.pending_to_assess).toBe(0.24);
        // The key assertion: the output contains NO float drift.
        expect(String(result.pending_to_assess)).not.toMatch(/\d{6,}/);
        expect(String(result.already_assessed)).not.toMatch(/\d{6,}/);
    });

    test('clamps sub-cent pending_to_assess to exactly 0', async () => {
        // Sub-cent drift in an input amount: 100.001 rounds to 10000
        // cents. Already assessed is 10000 cents. pending = 0, clamp
        // keeps it clean (no 0.0009999...-style leftover).
        const fund = new PettyCashFund('f1', 'b1', 0, 'USD', new Date());
        const transactions = [
            new PettyCashTransaction('t1', 'f1', PettyCashTransactionType.EXPENSE, 100.001, 'expense', PettyCashCategory.REPAIR, 'u1'),
        ];
        const unitInvoices = [makeUnitInvoice('u1', 100)];
        const units = [makeUnit('u1', '1A')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo(unitInvoices),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, transactions })
        );
        const result = await preview.execute('b1');

        expect(result.pending_to_assess).toBe(0);
        expect(String(result.pending_to_assess)).toBe('0');
    });

    test('fair cent-level distribution: unit amounts sum exactly to pending_to_assess', async () => {
        // $100 across 3 units → 10000 cents / 3 = 3333 remainder 1.
        // Expected: [33.34, 33.33, 33.33] and sum = 100.00 exact.
        const fund = new PettyCashFund('f1', 'b1', 0, 'USD', new Date());
        const transactions = [
            new PettyCashTransaction('t1', 'f1', PettyCashTransactionType.EXPENSE, 100, 'expense', PettyCashCategory.REPAIR, 'u1'),
        ];
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B'), makeUnit('u3', '1C')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, transactions })
        );
        const result = await preview.execute('b1');

        expect(result.pending_to_assess).toBe(100);
        expect(result.units[0].amount).toBe(33.34);
        expect(result.units[1].amount).toBe(33.33);
        expect(result.units[2].amount).toBe(33.33);

        // The critical invariant: sum of unit amounts equals
        // pending_to_assess at the cent level.
        const sumCents = result.units.reduce((s, u) => s + Math.round(u.amount * 100), 0);
        const pendingCents = Math.round(result.pending_to_assess * 100);
        expect(sumCents).toBe(pendingCents);
    });
});

// ── Generate ────────────────────────────────────────────────────────────────

describe('GenerateAssessments', () => {
    test('creates one invoice per unit', async () => {
        const fund = new PettyCashFund('f1', 'b1', 0, 'USD', new Date());
        const transactions = [
            new PettyCashTransaction('t1', 'f1', PettyCashTransactionType.EXPENSE, 200, 'expense', PettyCashCategory.REPAIR, 'u1'),
        ];
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];
        const invoiceRepo = mockInvoiceRepo([]);
        const unitRepo = mockUnitRepo(units);
        const pcRepo = mockPettyCashRepo({ fund, transactions });

        const generate = new GenerateAssessments(invoiceRepo, unitRepo, pcRepo);
        const result = await generate.execute('b1');

        expect(result.invoices_created).toBe(2);
        expect(result.total_assessed).toBe(200);
        expect(result.invoices[0].amount).toBe(100);
        expect(result.invoices[1].amount).toBe(100);
        expect(invoiceRepo.createBatch).toHaveBeenCalledTimes(1);
    });

    test('throws when no pending overage', async () => {
        const fund = new PettyCashFund('f1', 'b1', 100, 'USD', new Date());
        const transactions = [
            new PettyCashTransaction('t1', 'f1', PettyCashTransactionType.INCOME, 100, 'income', PettyCashCategory.OTHER, 'u1'),
        ];
        const pcRepo = mockPettyCashRepo({ fund, transactions });

        const generate = new GenerateAssessments(mockInvoiceRepo([]), mockUnitRepo([makeUnit('u1', '1A')]), pcRepo);

        await expect(generate.execute('b1')).rejects.toThrow('No pending overage');
    });

    test('throws when no units in building', async () => {
        const fund = new PettyCashFund('f1', 'b1', 0, 'USD', new Date());
        const transactions = [
            new PettyCashTransaction('t1', 'f1', PettyCashTransactionType.EXPENSE, 100, 'expense', PettyCashCategory.REPAIR, 'u1'),
        ];
        const pcRepo = mockPettyCashRepo({ fund, transactions });

        const generate = new GenerateAssessments(mockInvoiceRepo([]), mockUnitRepo([]), pcRepo);

        await expect(generate.execute('b1')).rejects.toThrow('No units found');
    });

    // Guard for ticket #46 scenario: pending is positive but not
    // enough to give every unit at least 1 cent → must reject with
    // AMOUNT_TOO_SMALL_TO_DISTRIBUTE instead of emitting degenerate
    // invoices.
    test('throws when pending amount cannot give every unit at least 1 cent', async () => {
        const fund = new PettyCashFund('f1', 'b1', 0, 'USD', new Date());
        // Overage of $0.08 (8 cents) across 38 units → 8 < 38, reject.
        const transactions = [
            new PettyCashTransaction('t1', 'f1', PettyCashTransactionType.EXPENSE, 0.08, 'expense', PettyCashCategory.REPAIR, 'u1'),
        ];
        const units = Array.from({ length: 38 }, (_, i) => makeUnit(`u${i + 1}`, `Apto ${i + 1}`));
        const pcRepo = mockPettyCashRepo({ fund, transactions });

        const generate = new GenerateAssessments(mockInvoiceRepo([]), mockUnitRepo(units), pcRepo);

        await expect(generate.execute('b1')).rejects.toThrow(/too small to distribute/i);
    });
});
