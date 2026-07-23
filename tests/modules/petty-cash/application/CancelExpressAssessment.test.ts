/**
 * TDD tests for CancelExpressAssessment use case (Slice B — B8).
 *
 * RED phase: tests written BEFORE the implementation exists.
 *
 * Scenarios (≥10 per spec):
 *   1. PENDING invoice cancelled + reason appended to description.
 *   2. PARTIAL invoice cancelled, PAID untouched.
 *   3. All-PAID → 409 NOT_CANCELLABLE.
 *   4. Short reason (< 10 chars) → 400 VALIDATION_ERROR.
 *   5. Assessment not found → 404 NOT_FOUND.
 *   6. Kind is GENERAL → 409 INVALID_OPERATION.
 *   7. Assessment belongs to another building → FORBIDDEN.
 *   8. Returns correct summary (cancelled count, total_remainder_returned).
 *   9. All invoices already CANCELLED → 409 NOT_CANCELLABLE.
 *  10. Multiple PENDING invoices all cancelled.
 */

import { describe, it, expect, mock } from 'bun:test';
import { CancelExpressAssessment } from '@/modules/petty-cash/application/use-cases/CancelExpressAssessment';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { PettyCashAssessment } from '@/modules/petty-cash/domain/entities/PettyCashAssessment';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAssessment(id: string, fundId: string, kind: 'GENERAL' | 'EXPRESS' = 'EXPRESS'): PettyCashAssessment {
    return new PettyCashAssessment({
        id,
        fund_id: fundId,
        period: '2026-07',
        description: 'Test assessment',
        total_amount: 100,
        created_by: 'user-1',
        kind,
    });
}

function makeFund(id: string, buildingId: string): PettyCashFund {
    return new PettyCashFund(id, buildingId, new Date(), 0);
}

function makeInvoice(
    id: string,
    assessmentId: string,
    status: InvoiceStatus,
    amount: number = 50,
    paidAmount: number = 0
): Invoice {
    return new Invoice({
        id,
        unit_id: `unit-${id}`,
        building_id: 'b1',
        amount,
        period: '2026-07',
        issue_date: new Date(),
        status,
        type: InvoiceType.EXPENSE,
        tag: InvoiceTag.PETTY_CASH,
        description: 'Cuota caja chica',
        assessment_id: assessmentId,
        paid_amount: paidAmount,
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

function mockPettyCashRepo(options: {
    fund?: PettyCashFund | null;
    assessment?: PettyCashAssessment | null;
} = {}) {
    return {
        findFundByBuildingId: mock(() => Promise.resolve(options.fund ?? null)),
        findOrCreateFund: mock(() => Promise.resolve(options.fund ?? makeFund('f1', 'b1'))),
        getBalance: mock(() => Promise.resolve(0)),
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
        findAssessmentById: mock(() => Promise.resolve(options.assessment ?? null)),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CancelExpressAssessment', () => {
    const buildingId = 'b1';
    const fund = makeFund('f1', buildingId);

    it('cancels PENDING invoice and appends reason to description', async () => {
        const assessment = makeAssessment('assessment-1', 'f1', 'EXPRESS');
        const pendingInvoice = makeInvoice('inv-1', 'assessment-1', InvoiceStatus.PENDING, 50, 0);

        const invoiceRepo = mockInvoiceRepo([pendingInvoice]);
        const pcRepo = mockPettyCashRepo({ fund, assessment });

        const useCase = new CancelExpressAssessment(invoiceRepo as any, pcRepo as any);
        const result = await useCase.execute({
            assessmentId: 'assessment-1',
            reason: 'Error en el monto original',
            buildingId,
        });

        expect(result.cancelled_invoices).toBe(1);
        expect(result.assessment_id).toBe('assessment-1');
        // invoice.update must have been called
        expect(invoiceRepo.update).toHaveBeenCalledTimes(1);
        const updatedInvoice: Invoice = invoiceRepo.update.mock.calls[0][0];
        expect(updatedInvoice.status).toBe(InvoiceStatus.CANCELLED);
        // reason appended to description
        expect(updatedInvoice.description).toContain('Error en el monto original');
    });

    it('PARTIAL invoice is cancelled, PAID invoice is not touched', async () => {
        const assessment = makeAssessment('assessment-1', 'f1', 'EXPRESS');
        const partialInvoice = makeInvoice('inv-partial', 'assessment-1', InvoiceStatus.PARTIAL, 50, 20);
        const paidInvoice = makeInvoice('inv-paid', 'assessment-1', InvoiceStatus.PAID, 50, 50);

        const invoiceRepo = mockInvoiceRepo([partialInvoice, paidInvoice]);
        const pcRepo = mockPettyCashRepo({ fund, assessment });

        const useCase = new CancelExpressAssessment(invoiceRepo as any, pcRepo as any);
        const result = await useCase.execute({
            assessmentId: 'assessment-1',
            reason: 'Correction required here',
            buildingId,
        });

        expect(result.cancelled_invoices).toBe(1);
        // Only the PARTIAL invoice is updated
        expect(invoiceRepo.update).toHaveBeenCalledTimes(1);
        const updatedInvoice: Invoice = invoiceRepo.update.mock.calls[0][0];
        expect(updatedInvoice.id).toBe('inv-partial');
        expect(updatedInvoice.status).toBe(InvoiceStatus.CANCELLED);
        // remainder returned = amount - paid = 50 - 20 = 30
        expect(result.total_remainder_returned).toBeCloseTo(30);
    });

    it('all PAID invoices → 409 NOT_CANCELLABLE', async () => {
        const assessment = makeAssessment('assessment-1', 'f1', 'EXPRESS');
        const paidInvoice = makeInvoice('inv-paid', 'assessment-1', InvoiceStatus.PAID, 50, 50);

        const invoiceRepo = mockInvoiceRepo([paidInvoice]);
        const pcRepo = mockPettyCashRepo({ fund, assessment });

        const useCase = new CancelExpressAssessment(invoiceRepo as any, pcRepo as any);

        await expect(
            useCase.execute({ assessmentId: 'assessment-1', reason: 'Cannot cancel paid', buildingId })
        ).rejects.toMatchObject({ code: 'NOT_CANCELLABLE', status: 409 });

        expect(invoiceRepo.update).not.toHaveBeenCalled();
    });

    it('reason shorter than 10 chars → 400 VALIDATION_ERROR', async () => {
        const assessment = makeAssessment('assessment-1', 'f1', 'EXPRESS');
        const pcRepo = mockPettyCashRepo({ fund, assessment });

        const useCase = new CancelExpressAssessment(mockInvoiceRepo([]) as any, pcRepo as any);

        await expect(
            useCase.execute({ assessmentId: 'assessment-1', reason: 'Short', buildingId })
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    });

    it('assessment not found → 404 NOT_FOUND', async () => {
        const pcRepo = mockPettyCashRepo({ fund, assessment: null });

        const useCase = new CancelExpressAssessment(mockInvoiceRepo([]) as any, pcRepo as any);

        await expect(
            useCase.execute({ assessmentId: 'non-existent', reason: 'Assessment does not exist', buildingId })
        ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('GENERAL kind → 409 INVALID_OPERATION', async () => {
        const generalAssessment = makeAssessment('assessment-general', 'f1', 'GENERAL');
        const pcRepo = mockPettyCashRepo({ fund, assessment: generalAssessment });

        const useCase = new CancelExpressAssessment(mockInvoiceRepo([]) as any, pcRepo as any);

        await expect(
            useCase.execute({ assessmentId: 'assessment-general', reason: 'Wrong kind assessment', buildingId })
        ).rejects.toMatchObject({ code: 'INVALID_OPERATION', status: 409 });
    });

    it('security: assessment from another building → FORBIDDEN', async () => {
        // Fund belongs to a DIFFERENT building than the route's buildingId
        const otherFund = makeFund('f-other', 'b-other');
        const assessment = makeAssessment('assessment-1', 'f-other', 'EXPRESS');
        const pcRepo = mockPettyCashRepo({ fund: otherFund, assessment });
        // findFundByBuildingId returns the requesting building's fund (f1, b1)
        pcRepo.findFundByBuildingId = mock(() => Promise.resolve(fund)); // building b1 has fund f1
        // But assessment.fund_id is f-other, not f1

        const useCase = new CancelExpressAssessment(mockInvoiceRepo([]) as any, pcRepo as any);

        await expect(
            useCase.execute({ assessmentId: 'assessment-1', reason: 'Cross-building attempt here', buildingId: 'b1' })
        ).rejects.toMatchObject({ status: 403 });
    });

    it('all CANCELLED invoices → 409 NOT_CANCELLABLE', async () => {
        const assessment = makeAssessment('assessment-1', 'f1', 'EXPRESS');
        const cancelledInvoice = makeInvoice('inv-cancelled', 'assessment-1', InvoiceStatus.CANCELLED, 50, 0);

        const pcRepo = mockPettyCashRepo({ fund, assessment });

        const useCase = new CancelExpressAssessment(mockInvoiceRepo([cancelledInvoice]) as any, pcRepo as any);

        await expect(
            useCase.execute({ assessmentId: 'assessment-1', reason: 'Already all cancelled here', buildingId })
        ).rejects.toMatchObject({ code: 'NOT_CANCELLABLE', status: 409 });
    });

    it('multiple PENDING invoices all cancelled and counted', async () => {
        const assessment = makeAssessment('assessment-1', 'f1', 'EXPRESS');
        const inv1 = makeInvoice('inv-1', 'assessment-1', InvoiceStatus.PENDING, 50, 0);
        const inv2 = makeInvoice('inv-2', 'assessment-1', InvoiceStatus.PENDING, 50, 0);

        const invoiceRepo = mockInvoiceRepo([inv1, inv2]);
        const pcRepo = mockPettyCashRepo({ fund, assessment });

        const useCase = new CancelExpressAssessment(invoiceRepo as any, pcRepo as any);
        const result = await useCase.execute({
            assessmentId: 'assessment-1',
            reason: 'Cancel all pending invoices now',
            buildingId,
        });

        expect(result.cancelled_invoices).toBe(2);
        expect(invoiceRepo.update).toHaveBeenCalledTimes(2);
        expect(result.total_remainder_returned).toBe(100); // 50 + 50
    });

    it('total_remainder_returned accounts for partial paid amounts', async () => {
        const assessment = makeAssessment('assessment-1', 'f1', 'EXPRESS');
        const inv1 = makeInvoice('inv-1', 'assessment-1', InvoiceStatus.PENDING, 100, 0);
        const inv2 = makeInvoice('inv-2', 'assessment-1', InvoiceStatus.PARTIAL, 100, 60);

        const invoiceRepo = mockInvoiceRepo([inv1, inv2]);
        const pcRepo = mockPettyCashRepo({ fund, assessment });

        const useCase = new CancelExpressAssessment(invoiceRepo as any, pcRepo as any);
        const result = await useCase.execute({
            assessmentId: 'assessment-1',
            reason: 'Reversing partial and pending invoices',
            buildingId,
        });

        // inv1 remainder = 100 - 0 = 100; inv2 remainder = 100 - 60 = 40
        expect(result.total_remainder_returned).toBeCloseTo(140);
        expect(result.cancelled_invoices).toBe(2);
    });

    it('invoices from another assessment on same building are not affected', async () => {
        const assessment = makeAssessment('assessment-1', 'f1', 'EXPRESS');
        const targetInvoice = makeInvoice('inv-target', 'assessment-1', InvoiceStatus.PENDING, 50, 0);
        const otherInvoice = makeInvoice('inv-other', 'assessment-OTHER', InvoiceStatus.PENDING, 50, 0);

        const invoiceRepo = mockInvoiceRepo([targetInvoice, otherInvoice]);
        const pcRepo = mockPettyCashRepo({ fund, assessment });

        const useCase = new CancelExpressAssessment(invoiceRepo as any, pcRepo as any);
        const result = await useCase.execute({
            assessmentId: 'assessment-1',
            reason: 'Only target assessment invoices here',
            buildingId,
        });

        expect(result.cancelled_invoices).toBe(1); // only inv-target
        expect(invoiceRepo.update).toHaveBeenCalledTimes(1);
        const updated: Invoice = invoiceRepo.update.mock.calls[0][0];
        expect(updated.id).toBe('inv-target');
    });
});
