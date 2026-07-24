/**
 * Tests for PreviewAssessments — outstanding-receivables semantics.
 *
 * Bug: alreadyAssessedCents was summing the FULL amount of every non-CANCELLED
 * PETTY_CASH invoice. For PAID invoices, that portion was already collected via
 * COLLECTION entries and therefore already lifted the ledger balance. Summing
 * full amounts double-counts the collected portion, causing pending_to_assess
 * to stay 0 even after the ledger goes negative again from new expenses.
 *
 * Fix: sum max(0, amount - paid_amount) (outstanding remainder) instead of amount.
 */

import { describe, test, expect } from 'bun:test';
import { mock } from 'bun:test';
import { PreviewAssessments } from '@/modules/petty-cash/application/use-cases/PreviewAssessments';
import { computeCoverage } from '@/modules/petty-cash/application/use-cases/computeCoverage';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { PettyCashAssessment } from '@/modules/petty-cash/domain/entities/PettyCashAssessment';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeUnit(id: string, name: string) {
    return { id, name, building_id: 'b1', floor: '1', aliquot: 0, toJSON: () => ({ id, name }) };
}

interface InvoiceOverrides {
    status?: InvoiceStatus;
    paid_amount?: number;
    unit_id?: string;
}

function makeInvoice(amount: number, overrides: InvoiceOverrides = {}): Invoice {
    return new Invoice({
        id: crypto.randomUUID(),
        unit_id: overrides.unit_id ?? 'u1',
        building_id: 'b1',
        amount,
        period: '2026-07',
        issue_date: new Date(),
        status: overrides.status ?? InvoiceStatus.PENDING,
        type: InvoiceType.EXPENSE,
        tag: InvoiceTag.PETTY_CASH,
        description: 'Cuota caja chica',
        paid_amount: overrides.paid_amount ?? 0,
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

function mockPettyCashRepo(options: { fund?: PettyCashFund | null; balance?: number }) {
    const fund = options.fund ?? null;
    return {
        findFundByBuildingId: mock(() => Promise.resolve(fund)),
        findOrCreateFund: mock(() =>
            Promise.resolve(fund ?? new PettyCashFund('f1', 'b1', new Date()))
        ),
        getBalance: mock(() => Promise.resolve(options.balance ?? 0)),
        addEntry: mock((e: any) => Promise.resolve(e)),
        findEntryById: mock(() => Promise.resolve(null)),
        findEntriesByFundId: mock(() => Promise.resolve([])),
        findEntriesByFundIdPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
        findEntriesByReference: mock(() => Promise.resolve([])),
        createAssessment: mock((a: PettyCashAssessment) =>
            Promise.resolve(
                new PettyCashAssessment({
                    id: 'batch-1',
                    fund_id: a.fund_id,
                    period: a.period,
                    description: a.description,
                    category: a.category,
                    total_amount: a.total_amount,
                    created_by: a.created_by,
                })
            )
        ),
        findAssessmentsByFundId: mock(() => Promise.resolve([])),
        findAssessmentsByPeriod: mock(() => Promise.resolve([])),
        findReversedOriginalIds: mock(() => Promise.resolve(new Set<string>())),
    };
}

// ── BUG REGRESSION ──────────────────────────────────────────────────────────

describe('PreviewAssessments — outstanding-receivables fix', () => {
    /**
     * Scenario: fund started with balance 0.
     * Expense of -100 → balance = -100, assessment generated → one invoice
     *   amount=100, status=PENDING, paid_amount=0 → pending=0 (fully covered).
     * Resident pays → COLLECTION entry +100 → balance = 0.
     * Invoice moves to PAID, paid_amount=100.
     * New expense of -60 → balance = -60.
     *
     * BUG (old formula): alreadyAssessed = invoice.amount = 100, overage = 60
     *   → pending = max(0, 60 - 100) = 0.  WRONG — the "Generar prorrateo" button
     *   stays hidden forever.
     *
     * FIX (new formula): alreadyAssessed = max(0, invoice.amount - invoice.paid_amount)
     *   = max(0, 100 - 100) = 0 → pending = 60.  CORRECT.
     */
    test('BUG REGRESSION: PAID invoice with paid_amount=amount no longer blocks pending_to_assess', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];

        // One fully-paid invoice that was previously assessed and collected.
        const paidInvoice = makeInvoice(100, { status: InvoiceStatus.PAID, paid_amount: 100 });

        // Balance is -60 after a new expense hit the fund.
        const preview = new PreviewAssessments(
            mockInvoiceRepo([paidInvoice]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo({ fund, balance: -60 }) as any
        );

        const result = await preview.execute('b1');

        // outstanding receivable from the PAID invoice = max(0, 100 - 100) = 0
        // pending = max(0, 60 - 0) = 60
        expect(result.pending_to_assess).toBe(60);
        expect(result.total_overage).toBe(60);
        // already_assessed now reflects the OUTSTANDING remainder, not the full amount
        expect(result.already_assessed).toBe(0);
    });

    /**
     * PARTIAL invoice: amount=100, paid_amount=60.
     * Outstanding = 40. Balance = -40 (already in deficit).
     * pending = max(0, 40 - 40) = 0.
     */
    test('PARTIAL invoice contributes only outstanding remainder to already_assessed', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A')];

        const partialInvoice = makeInvoice(100, {
            status: InvoiceStatus.PARTIAL,
            paid_amount: 60,
        });

        const preview = new PreviewAssessments(
            mockInvoiceRepo([partialInvoice]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo({ fund, balance: -40 }) as any
        );

        const result = await preview.execute('b1');

        // outstanding = 100 - 60 = 40; overage = 40; pending = max(0, 40 - 40) = 0
        expect(result.already_assessed).toBe(40);
        expect(result.total_overage).toBe(40);
        expect(result.pending_to_assess).toBe(0);
    });

    /**
     * PAID invoice contributes 0 outstanding.
     * CANCELLED invoice must be fully excluded (its remainder returns to pool).
     */
    test('PAID contributes 0; CANCELLED is excluded entirely', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];

        const paidInvoice = makeInvoice(100, {
            status: InvoiceStatus.PAID,
            paid_amount: 100,
            unit_id: 'u1',
        });
        const cancelledInvoice = makeInvoice(100, {
            status: InvoiceStatus.CANCELLED,
            paid_amount: 0,
            unit_id: 'u2',
        });

        // overage = 80 (balance = -80), both invoices exist but only outstanding counts
        const preview = new PreviewAssessments(
            mockInvoiceRepo([paidInvoice, cancelledInvoice]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo({ fund, balance: -80 }) as any
        );

        const result = await preview.execute('b1');

        // PAID: outstanding=0; CANCELLED: excluded
        // pending = max(0, 80 - 0) = 80
        expect(result.already_assessed).toBe(0);
        expect(result.pending_to_assess).toBe(80);
    });

    /** No fund row → all zeros, no crash. */
    test('no fund row returns balance 0, target 0, pending 0', async () => {
        const units = [makeUnit('u1', '1A')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo({ fund: null }) as any
        );

        const result = await preview.execute('b1');

        expect(result.current_balance).toBe(0);
        expect(result.total_overage).toBe(0);
        expect(result.pending_to_assess).toBe(0);
        // target_fund defaults to 0 when no target has been configured
        expect(result.target_fund).toBe(0);
    });

    /** Cent fairness: 100 across 3 units → exact integer-cent distribution summing to 100. */
    test('cent fairness: pending 100 across 3 units sums exactly to pending_to_assess', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B'), makeUnit('u3', '1C')];

        const preview = new PreviewAssessments(
            mockInvoiceRepo([]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo({ fund, balance: -100 }) as any
        );

        const result = await preview.execute('b1');

        expect(result.pending_to_assess).toBe(100);

        const sumCents = result.units.reduce(
            (s, u) => s + Math.round(u.amount * 100),
            0
        );
        expect(sumCents).toBe(10000); // 100.00 exact
        // Distribution: 34/33/33 with first unit getting the remainder cent
        expect(result.units[0].amount).toBe(33.34);
        expect(result.units[1].amount).toBe(33.33);
        expect(result.units[2].amount).toBe(33.33);
    });

    /**
     * Imprest self-adjust: gas expense 200 + water expense 100 = total deficit 300.
     * No prior invoices → pending = 300.
     * Balance = -(200 + 100) = -300.
     */
    test('imprest self-adjust sequence: expenses regenerate pending correctly', async () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const units = [makeUnit('u1', '1A'), makeUnit('u2', '1B')];

        // No prior invoices outstanding
        const preview = new PreviewAssessments(
            mockInvoiceRepo([]) as any,
            mockUnitRepo(units) as any,
            mockPettyCashRepo({ fund, balance: -300 }) as any
        );

        const result = await preview.execute('b1');

        expect(result.total_overage).toBe(300);
        expect(result.already_assessed).toBe(0);
        expect(result.pending_to_assess).toBe(300);
    });
});

// ── computeCoverage pure function ────────────────────────────────────────────

describe('computeCoverage', () => {
    /**
     * target_fund term: balance 20, receivables 0, target 100 → pending 80.
     * pending_cents = max(0, target_fund_cents - (balance_cents + receivables_cents))
     *              = max(0, 10000 - (2000 + 0)) = 8000 → 80.
     */
    test('target_fund term: balance 20, receivables 0, target 100 → pending 80', () => {
        const result = computeCoverage({
            balanceCents: 2000,        // $20.00
            targetFundCents: 10000,    // $100.00
            invoices: [],
        });

        expect(result.outstandingReceivablesCents).toBe(0);
        expect(result.pendingCents).toBe(8000); // 80.00
    });

    test('balance above target → pending 0 (no replenishment needed)', () => {
        const result = computeCoverage({
            balanceCents: 15000,   // $150 — above target
            targetFundCents: 10000,
            invoices: [],
        });

        expect(result.pendingCents).toBe(0);
    });

    test('overage mode (target=0): negative balance surfaces as pending', () => {
        const result = computeCoverage({
            balanceCents: -6000,   // -$60
            targetFundCents: 0,
            invoices: [],
        });

        // pending = max(0, 0 - (-6000 + 0)) = 6000
        expect(result.pendingCents).toBe(6000);
    });

    test('PARTIAL invoice outstanding is counted in receivables', () => {
        const partialInvoice = makeInvoice(100, {
            status: InvoiceStatus.PARTIAL,
            paid_amount: 40,
        });

        const result = computeCoverage({
            balanceCents: -2000,
            targetFundCents: 0,
            invoices: [partialInvoice],
        });

        // outstanding = 100 - 40 = 60 → 6000 cents
        expect(result.outstandingReceivablesCents).toBe(6000);
        // pending = max(0, 0 - (-2000 + 6000)) = max(0, 0 - 4000) = 0
        expect(result.pendingCents).toBe(0);
    });
});
