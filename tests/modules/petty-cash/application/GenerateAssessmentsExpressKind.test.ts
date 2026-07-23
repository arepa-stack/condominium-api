/**
 * Tests for GenerateAssessments — EXPRESS kind, source_entry_id, and
 * unit_amounts override.
 */

import { describe, it, expect, mock } from 'bun:test';
import { GenerateAssessments } from '@/modules/petty-cash/application/use-cases/GenerateAssessments';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { PettyCashAssessment } from '@/modules/petty-cash/domain/entities/PettyCashAssessment';
import { PettyCashEntry } from '@/modules/petty-cash/domain/entities/PettyCashEntry';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag, PettyCashCategory, PettyCashEntryType } from '@/core/domain/enums';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeUnit(id: string, name: string) {
    return { id, name, building_id: 'b1', floor: '1', aliquot: 0, toJSON: () => ({ id, name }) };
}

function makeExpenseEntry(id: string, fundId: string): PettyCashEntry {
    return new PettyCashEntry({
        id,
        fund_id: fundId,
        type: PettyCashEntryType.EXPENSE,
        amount: -100,
        description: 'Test expense',
        created_by: 'user-1',
    });
}

function mockInvoiceRepo(invoices: Invoice[] = []) {
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
    fund?: PettyCashFund;
    entry?: PettyCashEntry | null;
} = {}) {
    const fund = options.fund ?? new PettyCashFund('f1', 'b1', new Date(), 0);
    const entry = options.entry ?? null;
    return {
        findFundByBuildingId: mock(() => Promise.resolve(fund)),
        findOrCreateFund: mock(() => Promise.resolve(fund)),
        getBalance: mock(() => Promise.resolve(0)),
        getBalanceByCurrency: mock(() => Promise.resolve([])),
        addEntry: mock((e: any) => Promise.resolve(e)),
        findEntryById: mock(() => Promise.resolve(entry)),
        findEntriesByFundId: mock(() => Promise.resolve([])),
        findEntriesByFundIdPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
        findEntriesByReference: mock(() => Promise.resolve([])),
        findReversedOriginalIds: mock(() => Promise.resolve(new Set<string>())),
        createAssessment: mock((a: PettyCashAssessment) =>
            Promise.resolve(
                new PettyCashAssessment({
                    id: 'assessment-1',
                    fund_id: a.fund_id,
                    period: a.period,
                    description: a.description,
                    category: a.category,
                    total_amount: a.total_amount,
                    created_by: a.created_by,
                    kind: a.kind,
                    source_entry_id: a.source_entry_id,
                })
            )
        ),
        findAssessmentsByFundId: mock(() => Promise.resolve([])),
        findAssessmentsByPeriod: mock(() => Promise.resolve([])),
        updateFundTargetFund: mock(() => Promise.resolve()),
        findAssessmentById: mock(() => Promise.resolve(null)),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GenerateAssessments — EXPRESS kind', () => {
    const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];
    const fund = new PettyCashFund('f1', 'b1', new Date(), 0);

    it('GENERAL kind (default) persists kind=GENERAL, no source_entry_id', async () => {
        const invoiceRepo = mockInvoiceRepo();
        const pcRepo = mockPettyCashRepo({ fund });

        const generate = new GenerateAssessments(invoiceRepo, mockUnitRepo(units) as any, pcRepo as any);
        const result = await generate.execute({
            buildingId: 'b1',
            description: 'GENERAL assessment',
            amount: 100,
            userId: 'user-1',
            // kind omitted → defaults to GENERAL
        });

        const assessmentArg: PettyCashAssessment = pcRepo.createAssessment.mock.calls[0][0];
        expect(assessmentArg.kind).toBe('GENERAL');
        expect(assessmentArg.source_entry_id).toBeNull();
        expect(result.kind).toBe('GENERAL');
        expect(result.source_entry_id).toBeNull();
    });

    it('EXPRESS kind requires source_entry_id — rejects when missing', async () => {
        const pcRepo = mockPettyCashRepo({ fund });
        const generate = new GenerateAssessments(
            mockInvoiceRepo(),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({
                buildingId: 'b1',
                description: 'EXPRESS no source',
                amount: 100,
                userId: 'user-1',
                kind: 'EXPRESS',
                unitIds: ['u1', 'u2'],
                // source_entry_id missing
            })
        ).rejects.toMatchObject({ code: 'INVALID_SOURCE_ENTRY' });
    });

    it('EXPRESS kind requires source_entry_id that exists and belongs to THIS fund', async () => {
        // entry not found → error
        const pcRepo = mockPettyCashRepo({ fund, entry: null });
        const generate = new GenerateAssessments(
            mockInvoiceRepo(),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({
                buildingId: 'b1',
                description: 'EXPRESS bad source',
                amount: 100,
                userId: 'user-1',
                kind: 'EXPRESS',
                unitIds: ['u1', 'u2'],
                source_entry_id: 'non-existent-entry',
            })
        ).rejects.toMatchObject({ code: 'INVALID_SOURCE_ENTRY' });
    });

    it('EXPRESS kind requires source_entry_id to be an EXPENSE type entry', async () => {
        // entry exists but is INCOME type
        const wrongEntry = new PettyCashEntry({
            id: 'entry-income',
            fund_id: 'f1',
            type: PettyCashEntryType.INCOME,
            amount: 100,
            description: 'Income entry',
            created_by: 'user-1',
        });
        const pcRepo = mockPettyCashRepo({ fund, entry: wrongEntry });
        const generate = new GenerateAssessments(
            mockInvoiceRepo(),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({
                buildingId: 'b1',
                description: 'EXPRESS wrong type',
                amount: 100,
                userId: 'user-1',
                kind: 'EXPRESS',
                unitIds: ['u1', 'u2'],
                source_entry_id: 'entry-income',
            })
        ).rejects.toMatchObject({ code: 'INVALID_SOURCE_ENTRY' });
    });

    it('EXPRESS kind requires source_entry_id to belong to THIS fund (security)', async () => {
        // entry exists but belongs to a different fund
        const otherFundEntry = makeExpenseEntry('entry-other', 'OTHER-FUND');
        const pcRepo = mockPettyCashRepo({ fund, entry: otherFundEntry });
        const generate = new GenerateAssessments(
            mockInvoiceRepo(),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({
                buildingId: 'b1',
                description: 'EXPRESS cross-fund',
                amount: 100,
                userId: 'user-1',
                kind: 'EXPRESS',
                unitIds: ['u1', 'u2'],
                source_entry_id: 'entry-other',
            })
        ).rejects.toMatchObject({ code: 'INVALID_SOURCE_ENTRY' });
    });

    it('EXPRESS kind requires at least one unitId', async () => {
        const validEntry = makeExpenseEntry('entry-1', 'f1');
        const pcRepo = mockPettyCashRepo({ fund, entry: validEntry });
        const generate = new GenerateAssessments(
            mockInvoiceRepo(),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({
                buildingId: 'b1',
                description: 'EXPRESS no units',
                amount: 100,
                userId: 'user-1',
                kind: 'EXPRESS',
                source_entry_id: 'entry-1',
                // unitIds omitted → should require at least 1
            })
        ).rejects.toMatchObject({ code: 'EXPRESS_REQUIRES_UNITS' });
    });

    it('GENERAL kind rejects source_entry_id', async () => {
        const pcRepo = mockPettyCashRepo({ fund });
        const generate = new GenerateAssessments(
            mockInvoiceRepo(),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({
                buildingId: 'b1',
                description: 'GENERAL with source',
                amount: 100,
                userId: 'user-1',
                kind: 'GENERAL',
                source_entry_id: 'entry-1',
            })
        ).rejects.toMatchObject({ code: 'INVALID_SOURCE_ENTRY' });
    });

    it('GENERAL kind rejects unit_amounts', async () => {
        const pcRepo = mockPettyCashRepo({ fund });
        const generate = new GenerateAssessments(
            mockInvoiceRepo(),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({
                buildingId: 'b1',
                description: 'GENERAL with unit_amounts',
                amount: 100,
                userId: 'user-1',
                kind: 'GENERAL',
                unit_amounts: { u1: 60, u2: 40 },
            })
        ).rejects.toMatchObject({ code: 'UNIT_AMOUNTS_MISMATCH' });
    });

    it('EXPRESS with valid source_entry_id creates assessment with kind=EXPRESS', async () => {
        const validEntry = makeExpenseEntry('entry-valid', 'f1');
        const pcRepo = mockPettyCashRepo({ fund, entry: validEntry });
        const invoiceRepo = mockInvoiceRepo();

        const generate = new GenerateAssessments(
            invoiceRepo,
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        const result = await generate.execute({
            buildingId: 'b1',
            description: 'EXPRESS test',
            amount: 100,
            userId: 'user-1',
            kind: 'EXPRESS',
            source_entry_id: 'entry-valid',
            unitIds: ['u1', 'u2'],
        });

        const assessmentArg: PettyCashAssessment = pcRepo.createAssessment.mock.calls[0][0];
        expect(assessmentArg.kind).toBe('EXPRESS');
        expect(assessmentArg.source_entry_id).toBe('entry-valid');
        expect(result.kind).toBe('EXPRESS');
        expect(result.source_entry_id).toBe('entry-valid');
        expect(result.invoices_created).toBe(2);
    });

    it('unit_amounts override distributes per-unit instead of fair split', async () => {
        const validEntry = makeExpenseEntry('entry-valid', 'f1');
        const pcRepo = mockPettyCashRepo({ fund, entry: validEntry });
        const invoiceRepo = mockInvoiceRepo();

        const generate = new GenerateAssessments(
            invoiceRepo,
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await generate.execute({
            buildingId: 'b1',
            description: 'EXPRESS override',
            amount: 100,
            userId: 'user-1',
            kind: 'EXPRESS',
            source_entry_id: 'entry-valid',
            unitIds: ['u1', 'u2'],
            unit_amounts: { u1: 70, u2: 30 },
        });

        const invoicesArg: Invoice[] = invoiceRepo.createBatch.mock.calls[0][0];
        const u1Invoice = invoicesArg.find(inv => inv.unit_id === 'u1')!;
        const u2Invoice = invoicesArg.find(inv => inv.unit_id === 'u2')!;
        expect(u1Invoice.amount).toBe(70);
        expect(u2Invoice.amount).toBe(30);
    });

    it('unit_amounts keys must exactly match unit_ids', async () => {
        const validEntry = makeExpenseEntry('entry-valid', 'f1');
        const pcRepo = mockPettyCashRepo({ fund, entry: validEntry });
        const generate = new GenerateAssessments(
            mockInvoiceRepo(),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        // unit_amounts has u1 and u3, but unit_ids is u1 and u2
        await expect(
            generate.execute({
                buildingId: 'b1',
                description: 'EXPRESS mismatch keys',
                amount: 100,
                userId: 'user-1',
                kind: 'EXPRESS',
                source_entry_id: 'entry-valid',
                unitIds: ['u1', 'u2'],
                unit_amounts: { u1: 60, u3: 40 }, // u3 not in unitIds
            })
        ).rejects.toMatchObject({ code: 'UNIT_AMOUNTS_MISMATCH' });
    });

    it('unit_amounts values must be > 0', async () => {
        const validEntry = makeExpenseEntry('entry-valid', 'f1');
        const pcRepo = mockPettyCashRepo({ fund, entry: validEntry });
        const generate = new GenerateAssessments(
            mockInvoiceRepo(),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({
                buildingId: 'b1',
                description: 'EXPRESS zero value',
                amount: 100,
                userId: 'user-1',
                kind: 'EXPRESS',
                source_entry_id: 'entry-valid',
                unitIds: ['u1', 'u2'],
                unit_amounts: { u1: 100, u2: 0 }, // u2 = 0 is invalid
            })
        ).rejects.toMatchObject({ code: 'UNIT_AMOUNTS_MISMATCH' });
    });

    it('unit_amounts sum must equal amount', async () => {
        const validEntry = makeExpenseEntry('entry-valid', 'f1');
        const pcRepo = mockPettyCashRepo({ fund, entry: validEntry });
        const generate = new GenerateAssessments(
            mockInvoiceRepo(),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        // sum = 60 + 50 = 110 ≠ 100
        await expect(
            generate.execute({
                buildingId: 'b1',
                description: 'EXPRESS sum mismatch',
                amount: 100,
                userId: 'user-1',
                kind: 'EXPRESS',
                source_entry_id: 'entry-valid',
                unitIds: ['u1', 'u2'],
                unit_amounts: { u1: 60, u2: 50 },
            })
        ).rejects.toMatchObject({ code: 'UNIT_AMOUNTS_MISMATCH' });
    });

    it('absent unit_amounts → fair-cent equal split (no change in GENERAL behaviour)', async () => {
        const pcRepo = mockPettyCashRepo({ fund });
        const invoiceRepo = mockInvoiceRepo();

        const generate = new GenerateAssessments(
            invoiceRepo,
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await generate.execute({
            buildingId: 'b1',
            description: 'GENERAL fair split',
            amount: 100,
            userId: 'user-1',
        });

        const invoicesArg: Invoice[] = invoiceRepo.createBatch.mock.calls[0][0];
        expect(invoicesArg[0].amount).toBe(50);
        expect(invoicesArg[1].amount).toBe(50);
    });

    it('rejects CONTRIBUTION kind with INVALID_ASSESSMENT_KIND (must use contribution endpoint)', async () => {
        const pcRepo = mockPettyCashRepo({ fund });
        const generate = new GenerateAssessments(
            mockInvoiceRepo(),
            mockUnitRepo(units) as any,
            pcRepo as any
        );

        await expect(
            generate.execute({
                buildingId: 'b1',
                description: 'Direct contribution attempt',
                amount: 50,
                userId: 'user-1',
                kind: 'CONTRIBUTION' as any, // cast: the DTO type intentionally omits CONTRIBUTION
            })
        ).rejects.toMatchObject({ code: 'INVALID_ASSESSMENT_KIND', status: 400 });
    });
});
