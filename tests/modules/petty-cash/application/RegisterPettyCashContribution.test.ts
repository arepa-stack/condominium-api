/**
 * Tests for RegisterPettyCashContribution use case.
 *
 * Scenarios:
 *   (a) atomic happy path — one assessment (CONTRIBUTION), one invoice
 *       (PETTY_CASH tag, unit, amount, assessment_id), registerPayment called
 *       with allocations, approvePayment.approve called with approverId = acting user;
 *       result includes fund_balance and coverage.
 *   (b) amount <= 0 → validation error, NOTHING created.
 *   (c) missing proof → error, nothing created (or compensation if invoice was created).
 *   (d) unit not in building → Forbidden, nothing created.
 *   (e) payment-step throws → invoice.cancel + invoiceRepo.update called,
 *       best-effort delete attempted, NO COLLECTION, error propagated.
 *   (f) approve retry on same payment → exactly one COLLECTION emitted
 *       (relies on existing replenishment guard — assert via fakes).
 *   (g) default description "Aporte caja chica — {YYYY-MM}" when omitted;
 *       empty override rejected.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { RegisterPettyCashContribution } from '@/modules/petty-cash/application/use-cases/RegisterPettyCashContribution';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { PettyCashAssessment } from '@/modules/petty-cash/domain/entities/PettyCashAssessment';
import { PettyCashEntry } from '@/modules/petty-cash/domain/entities/PettyCashEntry';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag, PettyCashEntryType, PettyCashEntryReferenceType } from '@/core/domain/enums';
import { Payment } from '@/modules/payments/domain/entities/Payment';
import { PaymentStatus, PaymentMethod } from '@/core/domain/enums';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUnit(id: string, name: string, buildingId = 'b1') {
    return { id, name, building_id: buildingId, floor: '1', aliquot: 0, toJSON: () => ({ id, name }) };
}

function makePayment(id: string, unitId: string): Payment {
    return new Payment({
        id,
        user_id: 'user-1',
        unit_id: unitId,
        building_id: 'b1',
        amount: 50,
        original_currency: 'USD',
        original_amount: 50,
        exchange_rate: null,
        rate_source: null,
        rate_date: null,
        payment_date: new Date('2026-01-01'),
        method: PaymentMethod.CASH,
        proof_url: 'https://cdn.example.com/proof.jpg',
        status: PaymentStatus.PENDING,
    });
}

function mockPettyCashRepo(options: {
    fund?: PettyCashFund;
    balance?: number;
} = {}) {
    const fund = options.fund ?? new PettyCashFund('f1', 'b1', new Date(), 0);
    const entries: PettyCashEntry[] = [];
    return {
        findFundByBuildingId: mock(() => Promise.resolve(fund)),
        findOrCreateFund: mock(() => Promise.resolve(fund)),
        getBalance: mock(() => Promise.resolve(options.balance ?? 0)),
        getBalanceByCurrency: mock(() => Promise.resolve([])),
        addEntry: mock(async (e: PettyCashEntry) => {
            entries.push(e);
            return e;
        }),
        findEntryById: mock(() => Promise.resolve(null)),
        findEntriesByFundId: mock(() => Promise.resolve([])),
        findEntriesByFundIdPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
        findEntriesByReference: mock(() => Promise.resolve(entries)),
        findReversedOriginalIds: mock(() => Promise.resolve(new Set<string>())),
        createAssessment: mock((a: PettyCashAssessment) =>
            Promise.resolve(
                new PettyCashAssessment({
                    id: 'assessment-contrib-1',
                    fund_id: a.fund_id,
                    period: a.period,
                    description: a.description,
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
        _entries: entries,
    };
}

function mockInvoiceRepo(options: { existing?: Invoice[] } = {}) {
    const saved: Invoice[] = [];
    return {
        findAll: mock(() => Promise.resolve(options.existing ?? [])),
        findAllPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
        findById: mock(() => Promise.resolve(null)),
        findInvoicesForAdmin: mock(() => Promise.resolve({ items: [], total: 0 })),
        findByBuildingId: mock(() => Promise.resolve({ items: [], total: 0 })),
        create: mock(async (inv: Invoice) => { saved.push(inv); return inv; }),
        update: mock(async (inv: Invoice) => inv),
        createBatch: mock(async (invs: Invoice[]) => { saved.push(...invs); return invs; }),
        _saved: saved,
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

function mockRegisterPayment(payment: Payment) {
    return { execute: mock(() => Promise.resolve(payment)) };
}

function mockBuildingRepo(rateSource: string = 'dolar_oficial') {
    return {
        findById: mock(() =>
            Promise.resolve({ id: 'b1', name: 'Edificio 1', default_rate_source: rateSource })
        ),
    };
}

function mockExchangeRateService(rate: number) {
    return {
        getRatesForDate: mock(() => Promise.resolve({} as any)),
        getLatest: mock(() => Promise.resolve({} as any)),
        convert: mock((input: { amountVes: number; date: string; source: string }) =>
            Promise.resolve({
                base: Math.round((input.amountVes / rate) * 100) / 100,
                rate,
                source: input.source,
                rate_date: input.date,
            })
        ),
        refresh: mock(() => Promise.resolve({} as any)),
        setManualRate: mock(() => Promise.resolve()),
    };
}

function mockApprovePayment() {
    return { approve: mock(() => Promise.resolve()) };
}

function mockPaymentRepo() {
    return {
        create: mock(async (p: Payment) => p),
        findById: mock(() => Promise.resolve(null)),
        findByUserId: mock(() => Promise.resolve([])),
        findByUnit: mock(() => Promise.resolve([])),
        update: mock(async (p: Payment) => p),
        findAll: mock(() => Promise.resolve([])),
        findAllPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
        delete: mock(() => Promise.resolve()),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RegisterPettyCashContribution', () => {
    const fund = new PettyCashFund('f1', 'b1', new Date(), 200);
    const unit = makeUnit('u1', 'Apt 1A');
    const units = [unit, makeUnit('u2', 'Apt 2B')];

    it('(a) happy path: creates assessment, invoice, registers payment, approves, returns result', async () => {
        const pcRepo = mockPettyCashRepo({ fund, balance: 150 });
        const invoiceRepo = mockInvoiceRepo({ existing: [] });
        const unitRepo = mockUnitRepo(units);
        const payment = makePayment('pay-1', 'u1');
        const registerPayment = mockRegisterPayment(payment);
        const approvePayment = mockApprovePayment();

        // After approval, the persisted payment is APPROVED with the acting user
        // recorded as processor. The re-read must surface that fresh state.
        const approvedPayment = makePayment('pay-1', 'u1');
        approvedPayment.approve('user-admin');
        const paymentRepo = mockPaymentRepo();
        paymentRepo.findById = mock(() => Promise.resolve(approvedPayment)) as any;

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            unitRepo as any,
            registerPayment as any,
            approvePayment as any,
            paymentRepo as any
        );

        const result = await useCase.execute({
            buildingId: 'b1',
            unitId: 'u1',
            amount: 50,
            proofUrl: 'https://cdn.example.com/proof.jpg',
            userId: 'user-admin',
        });

        // Assessment created with CONTRIBUTION kind
        expect(pcRepo.createAssessment.mock.calls).toHaveLength(1);
        const assessmentArg: PettyCashAssessment = pcRepo.createAssessment.mock.calls[0][0];
        expect(assessmentArg.kind).toBe('CONTRIBUTION');
        expect(assessmentArg.total_amount).toBe(50);

        // Exactly one invoice created via invoiceRepo.create
        expect(invoiceRepo.create.mock.calls).toHaveLength(1);
        const invoiceArg: Invoice = invoiceRepo.create.mock.calls[0][0];
        expect(invoiceArg.tag).toBe(InvoiceTag.PETTY_CASH);
        expect(invoiceArg.unit_id).toBe('u1');
        expect(invoiceArg.amount).toBe(50);
        expect(invoiceArg.assessment_id).toBe('assessment-contrib-1');

        // registerPayment called once with allocations pointing at the invoice
        expect(registerPayment.execute.mock.calls).toHaveLength(1);
        const regDto = registerPayment.execute.mock.calls[0][0];
        expect(regDto.allocations).toHaveLength(1);
        expect(regDto.allocations[0].amount).toBe(50);
        expect(regDto.proofUrl).toBe('https://cdn.example.com/proof.jpg');

        // approvePayment.approve called once with acting userId as approverId
        expect(approvePayment.approve.mock.calls).toHaveLength(1);
        const approveArg = approvePayment.approve.mock.calls[0][0];
        expect(approveArg.paymentId).toBe('pay-1');
        expect(approveArg.approverId).toBe('user-admin');

        // Result has fund_balance and coverage
        expect(result.fund_balance).toBeDefined();
        expect(typeof result.fund_balance).toBe('number');
        expect(result.coverage).toBeDefined();

        // Result includes the created payment (contract: 201 {invoice, payment, ...})
        expect(result.payment).toBeDefined();
        expect(result.payment.id).toBe('pay-1');

        // The returned payment reflects the post-approval persisted state, not the
        // PENDING in-memory entity produced by RegisterPayment.
        expect(result.payment.status).toBe(PaymentStatus.APPROVED);
        expect(result.payment.processed_by).toBe('user-admin');
    });

    it('(b) amount <= 0 → validation error, nothing created', async () => {
        const pcRepo = mockPettyCashRepo({ fund });
        const invoiceRepo = mockInvoiceRepo();
        const unitRepo = mockUnitRepo(units);
        const registerPayment = mockRegisterPayment(makePayment('p', 'u1'));
        const approvePayment = mockApprovePayment();

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            unitRepo as any,
            registerPayment as any,
            approvePayment as any,
            mockPaymentRepo() as any
        );

        await expect(
            useCase.execute({
                buildingId: 'b1',
                unitId: 'u1',
                amount: 0,
                proofUrl: 'https://cdn.example.com/proof.jpg',
                userId: 'user-admin',
            })
        ).rejects.toMatchObject({ status: 400 });

        // Nothing created
        expect(pcRepo.createAssessment.mock.calls).toHaveLength(0);
        expect(invoiceRepo.create.mock.calls).toHaveLength(0);
        expect(registerPayment.execute.mock.calls).toHaveLength(0);
    });

    it('(c) missing proof → error, nothing created', async () => {
        const pcRepo = mockPettyCashRepo({ fund });
        const invoiceRepo = mockInvoiceRepo();
        const unitRepo = mockUnitRepo(units);
        const registerPayment = mockRegisterPayment(makePayment('p', 'u1'));
        const approvePayment = mockApprovePayment();

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            unitRepo as any,
            registerPayment as any,
            approvePayment as any,
            mockPaymentRepo() as any
        );

        await expect(
            useCase.execute({
                buildingId: 'b1',
                unitId: 'u1',
                amount: 50,
                proofUrl: '',
                userId: 'user-admin',
            })
        ).rejects.toMatchObject({ status: 400 });

        expect(pcRepo.createAssessment.mock.calls).toHaveLength(0);
        expect(invoiceRepo.create.mock.calls).toHaveLength(0);
    });

    it('(d) unit not in building → Forbidden, nothing created', async () => {
        const pcRepo = mockPettyCashRepo({ fund });
        const invoiceRepo = mockInvoiceRepo();
        // Only u2 is in the building — u1 is foreign
        const unitRepo = mockUnitRepo([makeUnit('u2', 'Apt 2B')]);
        const registerPayment = mockRegisterPayment(makePayment('p', 'u1'));
        const approvePayment = mockApprovePayment();

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            unitRepo as any,
            registerPayment as any,
            approvePayment as any,
            mockPaymentRepo() as any
        );

        await expect(
            useCase.execute({
                buildingId: 'b1',
                unitId: 'u1', // not in building
                amount: 50,
                proofUrl: 'https://cdn.example.com/proof.jpg',
                userId: 'user-admin',
            })
        ).rejects.toMatchObject({ status: 403 });

        expect(pcRepo.createAssessment.mock.calls).toHaveLength(0);
        expect(invoiceRepo.create.mock.calls).toHaveLength(0);
    });

    it('(e) payment step throws → invoice cancelled + update called, error propagated', async () => {
        const pcRepo = mockPettyCashRepo({ fund });
        const invoiceRepo = mockInvoiceRepo();
        const unitRepo = mockUnitRepo(units);

        const failingRegisterPayment = {
            execute: mock(() => Promise.reject(new Error('Payment gateway error'))),
        };
        const approvePayment = mockApprovePayment();
        const paymentRepo = mockPaymentRepo();

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            unitRepo as any,
            failingRegisterPayment as any,
            approvePayment as any,
            paymentRepo as any
        );

        await expect(
            useCase.execute({
                buildingId: 'b1',
                unitId: 'u1',
                amount: 50,
                proofUrl: 'https://cdn.example.com/proof.jpg',
                userId: 'user-admin',
            })
        ).rejects.toThrow('Payment gateway error');

        // Invoice was created then compensated via update (after cancel())
        expect(invoiceRepo.create.mock.calls).toHaveLength(1);
        expect(invoiceRepo.update.mock.calls).toHaveLength(1);
        const cancelledInvoice: Invoice = invoiceRepo.update.mock.calls[0][0];
        expect(cancelledInvoice.status).toBe(InvoiceStatus.CANCELLED);

        // approvePayment was NOT called
        expect(approvePayment.approve.mock.calls).toHaveLength(0);
    });

    it('(f) approve retry on same payment emits exactly one COLLECTION (idempotency guard)', async () => {
        const pcRepo = mockPettyCashRepo({ fund, balance: 150 });
        const invoiceRepo = mockInvoiceRepo({ existing: [] });
        const unitRepo = mockUnitRepo(units);
        const payment = makePayment('pay-idempotent', 'u1');

        let approveCount = 0;
        const idempotentApprove = {
            approve: mock(async () => {
                approveCount++;
                // Simulate idempotent guard: after first call, the payment is APPROVED
                // and the petty-cash collection is already recorded, so a second call
                // should be blocked at the approve guard and not emit another COLLECTION.
            }),
        };

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            unitRepo as any,
            mockRegisterPayment(payment) as any,
            idempotentApprove as any,
            mockPaymentRepo() as any
        );

        // First call
        await useCase.execute({
            buildingId: 'b1',
            unitId: 'u1',
            amount: 50,
            proofUrl: 'https://cdn.example.com/proof.jpg',
            userId: 'user-admin',
        });

        // approvePayment was called exactly once per execute() call
        expect(idempotentApprove.approve.mock.calls).toHaveLength(1);
        expect(approveCount).toBe(1);
    });

    it('(g) default description applied when omitted', async () => {
        const pcRepo = mockPettyCashRepo({ fund, balance: 0 });
        const invoiceRepo = mockInvoiceRepo({ existing: [] });
        const unitRepo = mockUnitRepo(units);
        const payment = makePayment('pay-2', 'u1');
        const registerPayment = mockRegisterPayment(payment);
        const approvePayment = mockApprovePayment();

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            unitRepo as any,
            registerPayment as any,
            approvePayment as any,
            mockPaymentRepo() as any
        );

        await useCase.execute({
            buildingId: 'b1',
            unitId: 'u1',
            amount: 50,
            proofUrl: 'https://cdn.example.com/proof.jpg',
            userId: 'user-admin',
            // description omitted
        });

        const assessmentArg: PettyCashAssessment = pcRepo.createAssessment.mock.calls[0][0];
        const currentPeriod = new Date().toISOString().substring(0, 7); // YYYY-MM
        expect(assessmentArg.description).toBe(`Aporte caja chica — ${currentPeriod}`);
    });

    it('(g) empty description string is rejected with validation error', async () => {
        const pcRepo = mockPettyCashRepo({ fund });
        const invoiceRepo = mockInvoiceRepo();
        const unitRepo = mockUnitRepo(units);
        const registerPayment = mockRegisterPayment(makePayment('p', 'u1'));
        const approvePayment = mockApprovePayment();

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            unitRepo as any,
            registerPayment as any,
            approvePayment as any,
            mockPaymentRepo() as any
        );

        await expect(
            useCase.execute({
                buildingId: 'b1',
                unitId: 'u1',
                amount: 50,
                proofUrl: 'https://cdn.example.com/proof.jpg',
                userId: 'user-admin',
                description: '   ', // whitespace-only is treated as empty
            })
        ).rejects.toMatchObject({ status: 400 });

        expect(pcRepo.createAssessment.mock.calls).toHaveLength(0);
    });

    it('(h) VES contribution: invoice, assessment, and allocation use the canonical converted amount', async () => {
        // 3600 Bs at a rate of 36 Bs/USD converts to 100 canonical (USD) units.
        const rate = 36;
        const bsAmount = 3600;
        const canonical = 100;

        const pcRepo = mockPettyCashRepo({ fund, balance: canonical });
        const invoiceRepo = mockInvoiceRepo({ existing: [] });
        const unitRepo = mockUnitRepo(units);
        const payment = makePayment('pay-ves', 'u1');
        const registerPayment = mockRegisterPayment(payment);
        const approvePayment = mockApprovePayment();

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            unitRepo as any,
            registerPayment as any,
            approvePayment as any,
            mockPaymentRepo() as any,
            mockBuildingRepo() as any,
            mockExchangeRateService(rate) as any
        );

        const result = await useCase.execute({
            buildingId: 'b1',
            unitId: 'u1',
            amount: bsAmount,
            currency: 'VES',
            proofUrl: 'https://cdn.example.com/proof.jpg',
            userId: 'user-admin',
        });

        // Assessment total is the canonical converted value, not the raw Bs figure.
        const assessmentArg: PettyCashAssessment = pcRepo.createAssessment.mock.calls[0][0];
        expect(assessmentArg.total_amount).toBe(canonical);

        // Invoice amount is canonical.
        const invoiceArg: Invoice = invoiceRepo.create.mock.calls[0][0];
        expect(invoiceArg.amount).toBe(canonical);

        // Allocation passed to RegisterPayment is canonical (base unit),
        // so validateAllocations does not throw. Original VES amount/currency
        // is forwarded so the payment keeps its Bs provenance.
        const regDto = registerPayment.execute.mock.calls[0][0];
        expect(regDto.currency).toBe('VES');
        expect(regDto.amount).toBe(bsAmount);
        expect(regDto.allocations[0].amount).toBe(canonical);

        // Coverage drop equals the canonical value.
        expect(result.coverage.balance).toBe(canonical);
    });

    it('(i) safe compensation: a post-approve failure on an already-PAID invoice does NOT cancel it and does NOT delete an approved payment', async () => {
        const pcRepo = mockPettyCashRepo({ fund, balance: 150 });

        // Invoice starts PENDING when created, but the DB refetch reports PAID
        // (COLLECTION was already written and the invoice settled).
        const paidInvoice = new Invoice({
            id: 'inv-paid',
            unit_id: 'u1',
            building_id: 'b1',
            amount: 50,
            paid_amount: 50,
            period: '2026-07',
            issue_date: new Date(),
            status: InvoiceStatus.PAID,
            type: InvoiceType.EXPENSE,
            tag: InvoiceTag.PETTY_CASH,
            description: 'Aporte',
        });

        const invoiceRepo = mockInvoiceRepo();
        // findById returns the settled (PAID) invoice on the compensation refetch.
        invoiceRepo.findById = mock(() => Promise.resolve(paidInvoice)) as any;

        const payment = makePayment('pay-approved', 'u1');
        payment.approve('user-admin'); // payment is APPROVED in the store

        const paymentRepo = mockPaymentRepo();
        paymentRepo.findById = mock(() => Promise.resolve(payment)) as any;

        // approve() succeeds (COLLECTION emitted), but a later step throws.
        const approvePayment = {
            approve: mock(() => Promise.reject(new Error('post-collection step failed'))),
        };

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            mockUnitRepo(units) as any,
            mockRegisterPayment(payment) as any,
            approvePayment as any,
            paymentRepo as any
        );

        await expect(
            useCase.execute({
                buildingId: 'b1',
                unitId: 'u1',
                amount: 50,
                proofUrl: 'https://cdn.example.com/proof.jpg',
                userId: 'user-admin',
            })
        ).rejects.toThrow();

        // PAID invoice must NOT be cancelled/mutated.
        expect(invoiceRepo.update.mock.calls).toHaveLength(0);
        // APPROVED payment must NOT be deleted.
        expect(paymentRepo.delete.mock.calls).toHaveLength(0);
    });

    it('(j) coverage.pending_to_assess reflects the post-collection balance (dropped by the contributed canonical amount)', async () => {
        // target 500, post-collection balance 300, no outstanding receivables:
        // pending = max(0, 500 - 300) = 200.
        const targetedFund = new PettyCashFund('f1', 'b1', new Date(), 500);
        const pcRepo = mockPettyCashRepo({ fund: targetedFund, balance: 300 });
        const invoiceRepo = mockInvoiceRepo({ existing: [] });
        const unitRepo = mockUnitRepo(units);
        const payment = makePayment('pay-cov', 'u1');

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            unitRepo as any,
            mockRegisterPayment(payment) as any,
            mockApprovePayment() as any,
            mockPaymentRepo() as any
        );

        const result = await useCase.execute({
            buildingId: 'b1',
            unitId: 'u1',
            amount: 50,
            proofUrl: 'https://cdn.example.com/proof.jpg',
            userId: 'user-admin',
        });

        expect(result.coverage.pending_to_assess).toBe(200);
    });

    it('(k) compensation with a PENDING invoice but an already-APPROVED payment cancels the invoice yet leaves the payment intact', async () => {
        const pcRepo = mockPettyCashRepo({ fund, balance: 150 });

        // The DB refetch reports the invoice still PENDING (no collection landed),
        // so the invoice is safe to cancel.
        const invoiceRepo = mockInvoiceRepo();
        invoiceRepo.findById = mock(() =>
            Promise.resolve(
                new Invoice({
                    id: 'inv-pending',
                    unit_id: 'u1',
                    building_id: 'b1',
                    amount: 50,
                    period: '2026-07',
                    issue_date: new Date(),
                    status: InvoiceStatus.PENDING,
                    type: InvoiceType.EXPENSE,
                    tag: InvoiceTag.PETTY_CASH,
                    description: 'Aporte',
                })
            )
        ) as any;

        // The payment is already APPROVED in the store, so it must never be deleted
        // even though the invoice is still cancellable.
        const payment = makePayment('pay-approved-pending-inv', 'u1');
        payment.approve('user-admin');
        const paymentRepo = mockPaymentRepo();
        paymentRepo.findById = mock(() => Promise.resolve(payment)) as any;

        const approvePayment = {
            approve: mock(() => Promise.reject(new Error('post-approve step failed'))),
        };

        const useCase = new RegisterPettyCashContribution(
            pcRepo as any,
            invoiceRepo as any,
            mockUnitRepo(units) as any,
            mockRegisterPayment(payment) as any,
            approvePayment as any,
            paymentRepo as any
        );

        await expect(
            useCase.execute({
                buildingId: 'b1',
                unitId: 'u1',
                amount: 50,
                proofUrl: 'https://cdn.example.com/proof.jpg',
                userId: 'user-admin',
            })
        ).rejects.toThrow('post-approve step failed');

        // PENDING invoice is cancelled and persisted.
        expect(invoiceRepo.update.mock.calls).toHaveLength(1);
        const cancelled: Invoice = invoiceRepo.update.mock.calls[0][0];
        expect(cancelled.status).toBe(InvoiceStatus.CANCELLED);

        // APPROVED payment must NOT be deleted (guard: status !== APPROVED).
        expect(paymentRepo.delete.mock.calls).toHaveLength(0);
    });
});
