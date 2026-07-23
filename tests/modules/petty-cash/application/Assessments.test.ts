import { describe, test, expect, mock } from 'bun:test';
import { PreviewAssessments } from '@/modules/petty-cash/application/use-cases/PreviewAssessments';
import { GenerateAssessments } from '@/modules/petty-cash/application/use-cases/GenerateAssessments';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag, PettyCashCategory } from '@/core/domain/enums';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { PettyCashAssessment } from '@/modules/petty-cash/domain/entities/PettyCashAssessment';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeUnit(id: string, name: string) {
    return { id, name, building_id: 'b1', floor: '1', aliquot: 0, toJSON: () => ({ id, name }) };
}

function makeUnitInvoice(unitId: string, amount: number, status: InvoiceStatus = InvoiceStatus.PENDING) {
    return new Invoice({
        id: crypto.randomUUID(),
        unit_id: unitId,
        building_id: 'b1',
        amount,
        period: '2026-04',
        issue_date: new Date(),
        status,
        type: InvoiceType.EXPENSE,
        tag: InvoiceTag.PETTY_CASH,
        description: 'Cuota reposición caja chica'
    });
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
        findOrCreateFund: mock(() => Promise.resolve(fund ?? new PettyCashFund('f1', 'b1', new Date()))),
        getBalance: mock(() => Promise.resolve(options.balance ?? 0)),
        addEntry: mock((e: any) => Promise.resolve(e)),
        findEntriesByFundId: mock(() => Promise.resolve([])),
        findEntriesByFundIdPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
        findEntriesByReference: mock(() => Promise.resolve([])),
        createAssessment: mock((a: PettyCashAssessment) => Promise.resolve(
            new PettyCashAssessment({
                id: 'batch-1',
                fund_id: a.fund_id,
                period: a.period,
                description: a.description,
                category: a.category,
                total_amount: a.total_amount,
                created_by: a.created_by,
            })
        )),
        findAssessmentsByFundId: mock(() => Promise.resolve([])),
        findAssessmentsByPeriod: mock(() => Promise.resolve([])),
    };
}

// ── Preview ─────────────────────────────────────────────────────────────────

describe('PreviewAssessments', () => {
    test('calculates overage from a negative ledger balance', async () => {
        // Balance = -100 → overage = 100. No already_assessed → pending = 100.
        // Prorated across 2 units → 50 each.
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, balance: -100 }) as any
        );
        const result = await preview.execute('b1');

        expect(result.current_balance).toBe(-100);
        expect(result.total_overage).toBe(100);
        expect(result.already_assessed).toBe(0);
        expect(result.pending_to_assess).toBe(100);
        expect(result.units[0].amount).toBe(50);
        expect(result.units[1].amount).toBe(50);
    });

    test('subtracts already assessed unit invoices', async () => {
        // Balance = -200 → overage 200. Two unit invoices of 100 each
        // already cover the overage → pending = 0.
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const unitInvoices = [makeUnitInvoice('u1', 100), makeUnitInvoice('u2', 100)];
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo(unitInvoices),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, balance: -200 }) as any
        );
        const result = await preview.execute('b1');

        expect(result.total_overage).toBe(200);
        expect(result.already_assessed).toBe(200);
        expect(result.pending_to_assess).toBe(0);
    });

    test('CANCELLED unit invoices are excluded from already_assessed', async () => {
        // Overage = 200. One PENDING invoice of 100 and one CANCELLED
        // invoice of 100. Only the PENDING one counts → already_assessed = 100.
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const invoices = [
            makeUnitInvoice('u1', 100, InvoiceStatus.PENDING),
            makeUnitInvoice('u2', 100, InvoiceStatus.CANCELLED),
        ];
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo(invoices),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, balance: -200 }) as any
        );
        const result = await preview.execute('b1');

        expect(result.total_overage).toBe(200);
        expect(result.already_assessed).toBe(100);
        expect(result.pending_to_assess).toBe(100);
    });

    test('no overage when balance is non-negative', async () => {
        // Positive balance → overage clamped to 0.
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, balance: 50 }) as any
        );
        const result = await preview.execute('b1');

        expect(result.current_balance).toBe(50);
        expect(result.total_overage).toBe(0);
        expect(result.pending_to_assess).toBe(0);
    });

    test('returns zero when no fund exists', async () => {
        const units = [makeUnit('u1', '1A')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund: null }) as any
        );
        const result = await preview.execute('b1');

        expect(result.current_balance).toBe(0);
        expect(result.total_overage).toBe(0);
        expect(result.pending_to_assess).toBe(0);
    });

    // Regression: ticket #46 — $8000 / 38 units with legacy drifted data.
    // Previously, summing 38 float-stored invoices produced noise.
    // With integer cents the sum is exact.
    test('no float drift when summing drifted invoice amounts (ticket #46)', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        // 38 legacy invoices of 210.52 each. Naive float-sum reduce
        // would drift; integer cents gives the exact 799976.
        const units = Array.from({ length: 38 }, (_, i) => makeUnit(`u${i + 1}`, `Apto ${i + 1}`));
        const drifted = units.map(u => makeUnitInvoice(u.id, 210.52));

        const preview = new PreviewAssessments(
            mockInvoiceRepo(drifted),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, balance: -8000 }) as any
        );
        const result = await preview.execute('b1');

        // Overage = 8000 (800000 cents)
        // Already assessed = 38 * 210.52 = 7999.76 (799976 cents — exact)
        // Pending = 24 cents = 0.24, no trailing float noise.
        expect(result.total_overage).toBe(8000);
        expect(result.already_assessed).toBe(7999.76);
        expect(result.pending_to_assess).toBe(0.24);
        expect(String(result.pending_to_assess)).not.toMatch(/\d{6,}/);
        expect(String(result.already_assessed)).not.toMatch(/\d{6,}/);
    });

    test('clamps sub-cent pending_to_assess to exactly 0', async () => {
        // Balance -100.001 rounds to -10000 cents overage → 10000.
        // Already assessed is 10000 cents. Pending = 0, clamp keeps it clean.
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const unitInvoices = [makeUnitInvoice('u1', 100)];
        const units = [makeUnit('u1', '1A')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo(unitInvoices),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, balance: -100.001 }) as any
        );
        const result = await preview.execute('b1');

        expect(result.pending_to_assess).toBe(0);
        expect(String(result.pending_to_assess)).toBe('0');
    });

    test('fair cent-level distribution: unit amounts sum exactly to pending_to_assess', async () => {
        // $100 across 3 units → 10000 cents / 3 = 3333 remainder 1.
        // Expected: [33.34, 33.33, 33.33] and sum = 100.00 exact.
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B'), makeUnit('u3', '1C')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo(units),
            mockPettyCashRepo({ fund, balance: -100 }) as any
        );
        const result = await preview.execute('b1');

        expect(result.pending_to_assess).toBe(100);
        expect(result.units[0].amount).toBe(33.34);
        expect(result.units[1].amount).toBe(33.33);
        expect(result.units[2].amount).toBe(33.33);

        const sumCents = result.units.reduce((s, u) => s + Math.round(u.amount * 100), 0);
        const pendingCents = Math.round(result.pending_to_assess * 100);
        expect(sumCents).toBe(pendingCents);
    });
});

// ── Generate ────────────────────────────────────────────────────────────────

describe('GenerateAssessments', () => {
    test('creates the assessment batch and one invoice per unit (with assessment_id)', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];
        const invoiceRepo = mockInvoiceRepo([]);
        const unitRepo = mockUnitRepo(units);
        const pcRepo = mockPettyCashRepo({ fund, balance: -200 });

        const generate = new GenerateAssessments(invoiceRepo, unitRepo as any, pcRepo as any);
        const result = await generate.execute({
            buildingId: 'b1',
            description: 'Ascensor abril',
            amount: 200,
            userId: 'user-1'
        });

        // 1) Batch row created before invoices.
        expect(pcRepo.createAssessment).toHaveBeenCalledTimes(1);
        const assessmentArg: PettyCashAssessment = pcRepo.createAssessment.mock.calls[0][0];
        expect(assessmentArg.description).toBe('Ascensor abril');
        expect(assessmentArg.total_amount).toBe(200);
        expect(assessmentArg.fund_id).toBe('f1');

        // 2) Invoices created with assessment_id pointing at the batch.
        expect(invoiceRepo.createBatch).toHaveBeenCalledTimes(1);
        const invoicesArg: Invoice[] = invoiceRepo.createBatch.mock.calls[0][0];
        expect(invoicesArg.length).toBe(2);
        for (const inv of invoicesArg) {
            expect(inv.assessment_id).toBe('batch-1');
            expect(inv.tag).toBe(InvoiceTag.PETTY_CASH);
            expect(inv.description).toBe('Ascensor abril');
        }

        expect(result.invoices_created).toBe(2);
        expect(result.total_assessed).toBe(200);
        expect(result.assessment_id).toBe('batch-1');
        expect(result.invoices[0].amount).toBe(100);
        expect(result.invoices[1].amount).toBe(100);
    });

    test('creates invoices only for the selected units', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B'), makeUnit('u3', '1C')];
        const invoiceRepo = mockInvoiceRepo([]);
        const unitRepo = mockUnitRepo(units);
        const pcRepo = mockPettyCashRepo({ fund, balance: -100.01 });

        const generate = new GenerateAssessments(invoiceRepo, unitRepo as any, pcRepo as any);
        const result = await generate.execute({
            buildingId: 'b1',
            description: 'Mantenimiento',
            amount: 100.01,
            userId: 'u',
            unitIds: ['u1', 'u3'],
        });

        expect(invoiceRepo.createBatch).toHaveBeenCalledTimes(1);
        const invoicesArg: Invoice[] = invoiceRepo.createBatch.mock.calls[0][0];
        expect(invoicesArg.map((inv) => inv.unit_id)).toEqual(['u1', 'u3']);
        expect(result.invoices_created).toBe(2);
        expect(result.invoices.map((inv) => inv.unit_id)).toEqual(['u1', 'u3']);
        expect(result.invoices.map((inv) => inv.amount)).toEqual([50.01, 50]);
    });

    test('throws NO_UNITS_SELECTED for an explicit empty selection', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];
        const invoiceRepo = mockInvoiceRepo([]);
        const unitRepo = mockUnitRepo(units);
        const pcRepo = mockPettyCashRepo({ fund, balance: -100 });

        const generate = new GenerateAssessments(invoiceRepo, unitRepo as any, pcRepo as any);
        const action = generate.execute({
            buildingId: 'b1',
            description: 'Mantenimiento',
            amount: 100,
            userId: 'u',
            unitIds: [],
        });

        await expect(action).rejects.toMatchObject({ code: 'NO_UNITS_SELECTED' });
        expect(invoiceRepo.createBatch).not.toHaveBeenCalled();
        expect(pcRepo.createAssessment).not.toHaveBeenCalled();
    });

    test('throws INVALID_UNIT_SELECTION when any selected unit is unknown', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];
        const invoiceRepo = mockInvoiceRepo([]);
        const unitRepo = mockUnitRepo(units);
        const pcRepo = mockPettyCashRepo({ fund, balance: -100 });

        const generate = new GenerateAssessments(invoiceRepo, unitRepo as any, pcRepo as any);
        const action = generate.execute({
            buildingId: 'b1',
            description: 'Mantenimiento',
            amount: 100,
            userId: 'u',
            unitIds: ['u1', 'unknown'],
        });

        await expect(action).rejects.toMatchObject({ code: 'INVALID_UNIT_SELECTION' });
        expect(invoiceRepo.createBatch).not.toHaveBeenCalled();
        expect(pcRepo.createAssessment).not.toHaveBeenCalled();
    });

    test('throws INVALID_UNIT_SELECTION for duplicate unit IDs', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];
        const invoiceRepo = mockInvoiceRepo([]);
        const unitRepo = mockUnitRepo(units);
        const pcRepo = mockPettyCashRepo({ fund, balance: -100 });

        const generate = new GenerateAssessments(invoiceRepo, unitRepo as any, pcRepo as any);
        const action = generate.execute({
            buildingId: 'b1',
            description: 'Mantenimiento',
            amount: 100,
            userId: 'u',
            unitIds: ['u1', 'u1'],
        });

        await expect(action).rejects.toMatchObject({ code: 'INVALID_UNIT_SELECTION' });
        expect(invoiceRepo.createBatch).not.toHaveBeenCalled();
        expect(pcRepo.createAssessment).not.toHaveBeenCalled();
    });

    test('throws VALIDATION_ERROR when description is empty', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const pcRepo = mockPettyCashRepo({ fund, balance: -100 });

        const generate = new GenerateAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo([makeUnit('u1', '1A')]) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({ buildingId: 'b1', description: '', amount: 100, userId: 'u' })
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('throws VALIDATION_ERROR when amount is zero or negative', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const pcRepo = mockPettyCashRepo({ fund, balance: -100 });

        const generate = new GenerateAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo([makeUnit('u1', '1A')]) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({ buildingId: 'b1', description: 'Test', amount: 0, userId: 'u' })
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

        await expect(
            generate.execute({ buildingId: 'b1', description: 'Test', amount: -5, userId: 'u' })
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('throws NO_UNITS when no units in building', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const pcRepo = mockPettyCashRepo({ fund, balance: -100 });

        const generate = new GenerateAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo([]) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({ buildingId: 'b1', description: 'Test', amount: 100, userId: 'u' })
        ).rejects.toMatchObject({ code: 'NO_UNITS' });
    });

    test('throws AMOUNT_TOO_SMALL_TO_DISTRIBUTE when cents < unit count', async () => {
        // $0.08 (8 cents) across 38 units → 8 < 38, reject.
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = Array.from({ length: 38 }, (_, i) => makeUnit(`u${i + 1}`, `Apto ${i + 1}`));
        const pcRepo = mockPettyCashRepo({ fund, balance: -0.08 });

        const generate = new GenerateAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({ buildingId: 'b1', description: 'Drift', amount: 0.08, userId: 'u' })
        ).rejects.toMatchObject({ code: 'AMOUNT_TOO_SMALL_TO_DISTRIBUTE' });
    });

    test('propagates category when provided', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const pcRepo = mockPettyCashRepo({ fund, balance: -100 });
        const generate = new GenerateAssessments(
            mockInvoiceRepo([]),
            mockUnitRepo([makeUnit('u1', '1A')]) as any,
            pcRepo as any
        );

        await generate.execute({
            buildingId: 'b1',
            description: 'Mantenimiento',
            amount: 100,
            userId: 'u',
            category: PettyCashCategory.REPAIR,
        });

        const assessmentArg: PettyCashAssessment = pcRepo.createAssessment.mock.calls[0][0];
        expect(assessmentArg.category).toBe(PettyCashCategory.REPAIR);
    });
});
