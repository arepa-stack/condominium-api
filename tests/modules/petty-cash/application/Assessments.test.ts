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
});
