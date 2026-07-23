/**
 * TDD tests for GetPettyCashTransparency — assessing kind and source_entry_id
 * fields in the per-batch DTO (Slice B, API touch-up #1).
 *
 * RED phase: tests written BEFORE the implementation change.
 *
 * Scenarios:
 *   1. GENERAL assessment → kind: 'GENERAL', source_entry_id: null.
 *   2. EXPRESS assessment → kind: 'EXPRESS', source_entry_id populated.
 *   3. Legacy/orphan batch → kind and source_entry_id absent (no assessment row).
 *   4. Mixed period: GENERAL + EXPRESS batches both included correctly.
 *   5. EXPRESS with null source_entry_id → source_entry_id: null in DTO.
 */

import { describe, it, expect, mock } from 'bun:test';
import { GetPettyCashTransparency } from '@/modules/petty-cash/application/use-cases/GetPettyCashTransparency';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { PettyCashAssessment } from '@/modules/petty-cash/domain/entities/PettyCashAssessment';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUnit(id: string, name: string) {
    return { id, name, building_id: 'b1', floor: '1', aliquot: 0, toJSON: () => ({ id, name }) };
}

function makeAssessment(
    id: string,
    fundId: string,
    kind: 'GENERAL' | 'EXPRESS' = 'GENERAL',
    sourceEntryId: string | null = null
): PettyCashAssessment {
    return new PettyCashAssessment({
        id,
        fund_id: fundId,
        period: '2026-07',
        description: `Assessment ${id}`,
        total_amount: 100,
        created_by: 'user-1',
        kind,
        source_entry_id: sourceEntryId,
    });
}

function makeInvoice(
    id: string,
    unitId: string,
    assessmentId: string,
    amount = 50,
    paidAmount = 0,
    status = InvoiceStatus.PENDING
): Invoice {
    return new Invoice({
        id,
        unit_id: unitId,
        building_id: 'b1',
        amount,
        paid_amount: paidAmount,
        period: '2026-07',
        issue_date: new Date(),
        status,
        type: InvoiceType.EXPENSE,
        tag: InvoiceTag.PETTY_CASH,
        description: 'Cuota caja chica',
        assessment_id: assessmentId,
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

function mockPettyCashRepo(
    fund: PettyCashFund | null,
    assessments: PettyCashAssessment[] = []
) {
    return {
        findFundByBuildingId: mock(() => Promise.resolve(fund)),
        findOrCreateFund: mock(() => Promise.resolve(fund)),
        getBalance: mock(() => Promise.resolve(0)),
        getBalanceByCurrency: mock(() => Promise.resolve([])),
        addEntry: mock((e: any) => Promise.resolve(e)),
        findEntryById: mock(() => Promise.resolve(null)),
        findEntriesByFundId: mock(() => Promise.resolve([])),
        findEntriesByFundIdPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
        findEntriesByReference: mock(() => Promise.resolve([])),
        findReversedOriginalIds: mock(() => Promise.resolve(new Set<string>())),
        createAssessment: mock((a: any) => Promise.resolve(a)),
        findAssessmentsByFundId: mock(() => Promise.resolve(assessments)),
        findAssessmentsByPeriod: mock(() => Promise.resolve(assessments)),
        updateFundTargetFund: mock(() => Promise.resolve()),
        findAssessmentById: mock(() => Promise.resolve(null)),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GetPettyCashTransparency — kind and source_entry_id in DTO', () => {
    const buildingId = 'b1';
    const fund = new PettyCashFund('f1', buildingId, new Date(), 0);
    const units = [makeUnit('u1', 'Apto 1'), makeUnit('u2', 'Apto 2')];

    it('GENERAL assessment emits kind: GENERAL and source_entry_id: null', async () => {
        const assessment = makeAssessment('a1', 'f1', 'GENERAL', null);
        const invoice = makeInvoice('inv-1', 'u1', 'a1');

        const useCase = new GetPettyCashTransparency(
            mockInvoiceRepo([invoice]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo(fund, [assessment]) as any
        );

        const result = await useCase.execute(buildingId, '2026-07');

        expect(result.assessments).toHaveLength(1);
        const batch = result.assessments[0];
        expect(batch.id).toBe('a1');
        expect(batch.kind).toBe('GENERAL');
        expect(batch.source_entry_id).toBeNull();
    });

    it('EXPRESS assessment emits kind: EXPRESS and correct source_entry_id', async () => {
        const assessment = makeAssessment('a2', 'f1', 'EXPRESS', 'entry-xyz-123');
        const invoice = makeInvoice('inv-2', 'u1', 'a2');

        const useCase = new GetPettyCashTransparency(
            mockInvoiceRepo([invoice]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo(fund, [assessment]) as any
        );

        const result = await useCase.execute(buildingId, '2026-07');

        expect(result.assessments).toHaveLength(1);
        const batch = result.assessments[0];
        expect(batch.kind).toBe('EXPRESS');
        expect(batch.source_entry_id).toBe('entry-xyz-123');
    });

    it('legacy/orphan batch (no assessment row) — kind undefined, source_entry_id undefined', async () => {
        // Invoice with no assessment_id → goes to __legacy__ bucket
        const orphanInvoice = new Invoice({
            id: 'inv-orphan',
            unit_id: 'u1',
            building_id: buildingId,
            amount: 50,
            paid_amount: 0,
            period: '2026-07',
            issue_date: new Date(),
            status: InvoiceStatus.PENDING,
            type: InvoiceType.EXPENSE,
            tag: InvoiceTag.PETTY_CASH,
            description: 'Cuota legacy',
            assessment_id: undefined,
        });

        const useCase = new GetPettyCashTransparency(
            mockInvoiceRepo([orphanInvoice]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo(fund, []) as any
        );

        const result = await useCase.execute(buildingId, '2026-07');

        expect(result.assessments).toHaveLength(1);
        const legacyBatch = result.assessments[0];
        expect(legacyBatch.id).toBe('__legacy__');
        // Legacy batches have no assessment row → kind and source_entry_id should be undefined/absent
        expect(legacyBatch.kind).toBeUndefined();
        expect(legacyBatch.source_entry_id).toBeUndefined();
    });

    it('mixed period: GENERAL and EXPRESS both appear with correct kind fields', async () => {
        const generalAssessment = makeAssessment('a-gen', 'f1', 'GENERAL', null);
        const expressAssessment = makeAssessment('a-exp', 'f1', 'EXPRESS', 'entry-abc');
        const inv1 = makeInvoice('inv-1', 'u1', 'a-gen');
        const inv2 = makeInvoice('inv-2', 'u2', 'a-exp');

        const useCase = new GetPettyCashTransparency(
            mockInvoiceRepo([inv1, inv2]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo(fund, [generalAssessment, expressAssessment]) as any
        );

        const result = await useCase.execute(buildingId, '2026-07');

        expect(result.assessments).toHaveLength(2);

        const genBatch = result.assessments.find(b => b.id === 'a-gen');
        const expBatch = result.assessments.find(b => b.id === 'a-exp');

        expect(genBatch?.kind).toBe('GENERAL');
        expect(genBatch?.source_entry_id).toBeNull();
        expect(expBatch?.kind).toBe('EXPRESS');
        expect(expBatch?.source_entry_id).toBe('entry-abc');
    });

    it('EXPRESS assessment with null source_entry_id → source_entry_id: null', async () => {
        // EXPRESS without an explicit source_entry_id (null stored)
        const assessment = makeAssessment('a3', 'f1', 'EXPRESS', null);
        const invoice = makeInvoice('inv-3', 'u1', 'a3');

        const useCase = new GetPettyCashTransparency(
            mockInvoiceRepo([invoice]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo(fund, [assessment]) as any
        );

        const result = await useCase.execute(buildingId, '2026-07');

        const batch = result.assessments[0];
        expect(batch.kind).toBe('EXPRESS');
        expect(batch.source_entry_id).toBeNull();
    });
});
