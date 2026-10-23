/**
 * RecordInvoicePayment: an admin/board registers a full or partial payment on an
 * EXISTING invoice. The payment goes through RegisterPayment + ApprovePayment, so
 * the invoice balance, the payment row and its allocation stay consistent, and no
 * new invoice is ever created.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { RecordInvoicePayment } from '@/modules/payments/application/use-cases/RecordInvoicePayment';
import { RegisterPayment } from '@/modules/payments/application/use-cases/RegisterPayment';
import { ApprovePayment } from '@/modules/payments/application/use-cases/ApprovePayment';
import { ProcessInvoiceOverpayment } from '@/modules/billing/application/use-cases/ProcessInvoiceOverpayment';
import { MockPaymentRepository } from '../mocks';
import { MockUserRepository } from '../../users/mocks';
import { User } from '@/modules/users/domain/entities/User';
import { BuildingRole } from '@/modules/users/domain/entities/BuildingRole';
import { Unit } from '@/modules/buildings/domain/entities/Unit';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { PaymentAllocation } from '@/modules/billing/domain/entities/PaymentAllocation';
import { CreditLedgerEntry } from '@/modules/billing/domain/entities/CreditLedgerEntry';
import { PaymentMethod, PaymentStatus, UserStatus } from '@/core/domain/enums';

function makeInvoice(overrides: Partial<{ id: string; amount: number; paid_amount: number; status: InvoiceStatus }> = {}) {
    return new Invoice({
        id: overrides.id ?? 'inv-1',
        unit_id: 'unit-34',
        amount: overrides.amount ?? 114.18,
        paid_amount: overrides.paid_amount ?? 0,
        period: '2026-10',
        issue_date: new Date('2026-10-13'),
        status: overrides.status ?? InvoiceStatus.PENDING,
        type: InvoiceType.DEBT,
        description: 'Cuota Especial: Reparaciones Mayores y Pintura',
    });
}

function setup(options: { invoice?: Invoice; failAllocation?: boolean } = {}) {
    const invoices = new Map<string, Invoice>();
    const invoice = options.invoice ?? makeInvoice();
    invoices.set(invoice.id, invoice);
    let invoicesCreated = 0;

    const invoiceRepo: any = {
        findById: async (id: string) => invoices.get(id) ?? null,
        update: async (inv: Invoice) => { invoices.set(inv.id, inv); return inv; },
        create: async (inv: Invoice) => { invoicesCreated++; invoices.set(inv.id, inv); return inv; },
        findAll: async () => [...invoices.values()],
    };

    const allocations: PaymentAllocation[] = [];
    const allocationRepo: any = {
        create: async (a: PaymentAllocation) => {
            if (options.failAllocation) throw new Error('allocation insert failed');
            allocations.push(a);
            return a;
        },
        findByPaymentId: async (paymentId: string) => allocations.filter(a => a.payment_id === paymentId),
    };

    const credits: CreditLedgerEntry[] = [];
    const creditLedgerRepo: any = {
        addCredit: async (e: CreditLedgerEntry) => { credits.push(e); return e; },
        findByReferenceId: async () => [],
        getBalanceForUnit: async () => 0,
        getEntriesForUnit: async () => [],
    };
    const pettyCashRepo: any = { findEntriesByReference: async () => [], addEntry: async (e: unknown) => e };

    const units: any = {
        findById: async (id: string) => id === 'unit-34' ? new Unit({ id: 'unit-34', building_id: 'b-granada', name: '3-4' }) : null,
    };

    const paymentRepo = new MockPaymentRepository();
    const userRepo = new MockUserRepository();

    const admin = new User({ id: 'admin-1', email: 'a@x.test', name: 'Admin', app_role: 'admin' as const, status: UserStatus.ACTIVE });
    const board = new User({ id: 'board-1', email: 'b@x.test', name: 'Board', app_role: 'user' as const, status: UserStatus.ACTIVE });
    board.setBuildingRoles([new BuildingRole({ building_id: 'b-granada', role: 'board' })]);
    const otherBoard = new User({ id: 'board-2', email: 'c@x.test', name: 'Other', app_role: 'user' as const, status: UserStatus.ACTIVE });
    otherBoard.setBuildingRoles([new BuildingRole({ building_id: 'b-other', role: 'board' })]);
    userRepo.users.push(admin, board, otherBoard);

    const registerPayment = new RegisterPayment(paymentRepo, allocationRepo);
    const approvePayment = new ApprovePayment(
        paymentRepo, userRepo, allocationRepo,
        new ProcessInvoiceOverpayment(invoiceRepo, creditLedgerRepo),
        invoiceRepo, pettyCashRepo
    );
    const useCase = new RecordInvoicePayment(invoiceRepo, units, userRepo, paymentRepo, registerPayment, approvePayment);

    return {
        useCase, paymentRepo, allocations, credits,
        invoice: () => invoices.get(invoice.id)!,
        invoicesCreated: () => invoicesCreated,
    };
}

const base = {
    invoiceId: 'inv-1',
    actorId: 'admin-1',
    method: PaymentMethod.CASH,
    paymentDate: new Date('2026-10-20'),
};

describe('RecordInvoicePayment', () => {
    let ctx: ReturnType<typeof setup>;
    beforeEach(() => { ctx = setup(); });

    it('applies a partial payment to the existing invoice instead of creating a new one', async () => {
        const result = await ctx.useCase.execute({ ...base, amount: 50 });

        expect(ctx.invoicesCreated()).toBe(0);
        expect(ctx.invoice().paid_amount).toBe(50);
        expect(ctx.invoice().status).toBe(InvoiceStatus.PARTIAL);

        const payments = await ctx.paymentRepo.findAll();
        expect(payments).toHaveLength(1);
        expect(payments[0].status).toBe(PaymentStatus.APPROVED);
        expect(payments[0].amount).toBe(50);
        expect(payments[0].unit_id).toBe('unit-34');
        expect(payments[0].building_id).toBe('b-granada');
        expect(ctx.allocations).toEqual([expect.objectContaining({ payment_id: payments[0].id, invoice_id: 'inv-1', amount: 50 })]);
        expect(result.invoice.paid_amount).toBe(50);
        expect(result.payment.status).toBe(PaymentStatus.APPROVED);
    });

    it('marks the invoice PAID when the payment covers the remaining balance', async () => {
        ctx = setup({ invoice: makeInvoice({ paid_amount: 50, status: InvoiceStatus.PARTIAL }) });

        await ctx.useCase.execute({ ...base, amount: 64.18 });

        expect(ctx.invoice().paid_amount).toBeCloseTo(114.18, 2);
        expect(ctx.invoice().status).toBe(InvoiceStatus.PAID);
        expect(ctx.credits).toHaveLength(0);
    });

    it('credits the USD amount entered and keeps the Bs amount and rate as provenance', async () => {
        await ctx.useCase.execute({
            ...base,
            amount: 50,
            method: PaymentMethod.PAGO_MOVIL,
            amountVes: 49448.6,
            exchangeRate: 988.972,
            rateSource: 'euro_oficial',
        });

        const [payment] = await ctx.paymentRepo.findAll();
        expect(payment.amount).toBe(50);
        expect(payment.original_currency).toBe('VES');
        expect(payment.original_amount).toBe(49448.6);
        expect(payment.exchange_rate).toBe(988.972);
        expect(payment.rate_source).toBe('euro_oficial');
        expect(payment.rate_date).toBe('2026-10-20');
    });

    it('does not require reference or bank for a payment recorded by the administration', async () => {
        await ctx.useCase.execute({ ...base, amount: 50, method: PaymentMethod.TRANSFER });

        expect(ctx.invoice().paid_amount).toBe(50);
    });

    it('rounds the amount to cents', async () => {
        await ctx.useCase.execute({ ...base, amount: 35.674 });

        expect(ctx.invoice().paid_amount).toBe(35.67);
        const [payment] = await ctx.paymentRepo.findAll();
        expect(payment.amount).toBe(35.67);
    });

    it('rejects a payment larger than the remaining balance and writes nothing', async () => {
        ctx = setup({ invoice: makeInvoice({ paid_amount: 50, status: InvoiceStatus.PARTIAL }) });

        await expect(ctx.useCase.execute({ ...base, amount: 100 }))
            .rejects.toThrow('El pago ($100.00) supera el saldo pendiente de la factura ($64.18)');
        expect(await ctx.paymentRepo.findAll()).toHaveLength(0);
        expect(ctx.invoice().paid_amount).toBe(50);
    });

    it('rejects a non-positive amount', async () => {
        await expect(ctx.useCase.execute({ ...base, amount: 0 })).rejects.toThrow('El monto del pago debe ser mayor a cero');
    });

    it('rejects payments on PAID or CANCELLED invoices', async () => {
        ctx = setup({ invoice: makeInvoice({ paid_amount: 114.18, status: InvoiceStatus.PAID }) });
        await expect(ctx.useCase.execute({ ...base, amount: 1 })).rejects.toThrow('La factura ya está pagada');

        ctx = setup({ invoice: makeInvoice({ status: InvoiceStatus.CANCELLED }) });
        await expect(ctx.useCase.execute({ ...base, amount: 1 })).rejects.toThrow('La factura está anulada');
        expect(await ctx.paymentRepo.findAll()).toHaveLength(0);
    });

    it('rejects an unknown invoice', async () => {
        await expect(ctx.useCase.execute({ ...base, invoiceId: 'nope', amount: 1 })).rejects.toThrow('Invoice not found');
    });

    it('lets a board member of the invoice building record it', async () => {
        await ctx.useCase.execute({ ...base, actorId: 'board-1', amount: 50 });

        expect(ctx.invoice().paid_amount).toBe(50);
    });

    it('forbids a board member of another building and writes nothing', async () => {
        await expect(ctx.useCase.execute({ ...base, actorId: 'board-2', amount: 50 }))
            .rejects.toThrow('You can only record payments for invoices of your building');
        expect(await ctx.paymentRepo.findAll()).toHaveLength(0);
    });

    it('deletes the pending payment and surfaces the error when a later step fails', async () => {
        ctx = setup({ failAllocation: true });

        await expect(ctx.useCase.execute({ ...base, amount: 50 })).rejects.toThrow('allocation insert failed');
        expect(await ctx.paymentRepo.findAll()).toHaveLength(0);
        expect(ctx.invoice().paid_amount).toBe(0);
    });
});
