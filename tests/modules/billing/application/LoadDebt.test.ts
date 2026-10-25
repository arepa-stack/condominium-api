import { describe, expect, it, mock } from 'bun:test';
import { LoadDebt } from '@/modules/billing/application/use-cases/LoadDebt';
import { Invoice, InvoiceStatus } from '@/modules/billing/domain/entities/Invoice';
import { PaymentMethod } from '@/core/domain/enums';

function setup(options: { failPayment?: boolean; rejectConcept?: boolean } = {}) {
    const stored = new Map<string, Invoice>();
    const paidAtCreation: number[] = [];
    const invoiceRepository: any = {
        create: mock(async (inv: Invoice) => { paidAtCreation.push(inv.paid_amount); stored.set(inv.id, inv); return inv; }),
        update: mock(async (inv: Invoice) => { stored.set(inv.id, inv); return inv; }),
        findById: mock(async (id: string) => stored.get(id) ?? null),
    };
    const recordInvoicePayment: any = {
        execute: mock(async (dto: { invoiceId: string; amount: number }) => {
            if (options.failPayment) throw new Error('payment failed');
            const invoice = stored.get(dto.invoiceId)!;
            invoice.addPayment(dto.amount);
            invoice.updateStatus();
            return { invoice, payment: { id: 'pay-1' } };
        }),
    };
    const conceptGuard: any = {
        assertBillableForUnit: mock(async () => {
            if (options.rejectConcept) throw new Error('Charge concept not found in this building');
            return { id: 'c-1' };
        }),
    };
    const useCase = new LoadDebt(invoiceRepository, recordInvoicePayment, conceptGuard);
    return { useCase, invoiceRepository, recordInvoicePayment, stored, paidAtCreation, conceptGuard };
}

const debt = { unitId: 'unit-34', amount: 114.18, period: '2026-10', description: 'Cuota Especial', actorId: 'admin-1' };

describe('LoadDebt', () => {
    it('creates a pending invoice without recording a payment when nothing was paid', async () => {
        const { useCase, recordInvoicePayment } = setup();

        const invoice = await useCase.execute(debt);

        expect(invoice.status).toBe(InvoiceStatus.PENDING);
        expect(invoice.paid_amount).toBe(0);
        expect(recordInvoicePayment.execute).not.toHaveBeenCalled();
    });

    it('records a partial payment on the new invoice through RecordInvoicePayment', async () => {
        const { useCase, recordInvoicePayment, paidAtCreation } = setup();
        const paymentDate = new Date('2026-10-20');

        const invoice = await useCase.execute({
            ...debt,
            paidAmount: 50,
            paymentMethod: PaymentMethod.PAGO_MOVIL,
            paymentDate,
            receiptNumber: 'REC-1',
            amountVes: 49448.6,
            exchangeRate: 988.972,
            rateSource: 'euro_oficial',
        });

        // The invoice is stored unpaid; the payment path is what moves its balance.
        expect(paidAtCreation).toEqual([0]);
        expect(recordInvoicePayment.execute).toHaveBeenCalledWith({
            invoiceId: invoice.id,
            actorId: 'admin-1',
            amount: 50,
            method: PaymentMethod.PAGO_MOVIL,
            paymentDate,
            reference: 'REC-1',
            amountVes: 49448.6,
            exchangeRate: 988.972,
            rateSource: 'euro_oficial',
        });
        expect(invoice.paid_amount).toBe(50);
        expect(invoice.status).toBe(InvoiceStatus.PARTIAL);
    });

    it('records the full amount when the invoice is created as PAID', async () => {
        const { useCase, recordInvoicePayment } = setup();

        const invoice = await useCase.execute({ ...debt, status: InvoiceStatus.PAID });

        expect(recordInvoicePayment.execute.mock.calls[0][0]).toMatchObject({ amount: 114.18, method: PaymentMethod.CASH });
        expect(invoice.status).toBe(InvoiceStatus.PAID);
    });

    it('cancels the new invoice and surfaces the error when the payment cannot be recorded', async () => {
        const { useCase, stored } = setup({ failPayment: true });

        await expect(useCase.execute({ ...debt, paidAmount: 50 })).rejects.toThrow('payment failed');

        const [invoice] = [...stored.values()];
        expect(invoice.status).toBe(InvoiceStatus.CANCELLED);
    });

    it('keeps the invoice when the payment reached it before failing', async () => {
        const { useCase, stored, recordInvoicePayment } = setup();
        recordInvoicePayment.execute = mock(async (dto: { invoiceId: string; amount: number }) => {
            const invoice = stored.get(dto.invoiceId)!;
            invoice.addPayment(dto.amount);
            invoice.updateStatus();
            throw new Error('reconciliation required');
        });

        await expect(useCase.execute({ ...debt, paidAmount: 50 })).rejects.toThrow('reconciliation required');

        const [invoice] = [...stored.values()];
        expect(invoice.status).toBe(InvoiceStatus.PARTIAL);
    });

    it('rejects a paid amount above the invoice amount', async () => {
        const { useCase, invoiceRepository } = setup();

        await expect(useCase.execute({ ...debt, paidAmount: 200 })).rejects.toThrow('Paid amount cannot exceed the invoice amount');
        expect(invoiceRepository.create).not.toHaveBeenCalled();
    });

    it('stores the charge concept after checking it belongs to the unit building', async () => {
        const { useCase, conceptGuard } = setup();

        const invoice = await useCase.execute({ ...debt, conceptId: 'c-1' });

        expect(conceptGuard.assertBillableForUnit).toHaveBeenCalledWith('c-1', 'unit-34');
        expect(invoice.concept_id).toBe('c-1');
    });

    it('does not create the invoice when the concept is rejected', async () => {
        const { useCase, invoiceRepository } = setup({ rejectConcept: true });

        await expect(useCase.execute({ ...debt, conceptId: 'c-9' })).rejects.toThrow('Charge concept not found in this building');
        expect(invoiceRepository.create).not.toHaveBeenCalled();
    });

    it('keeps working without a concept', async () => {
        const { useCase, conceptGuard } = setup();

        const invoice = await useCase.execute(debt);

        expect(conceptGuard.assertBillableForUnit).not.toHaveBeenCalled();
        expect(invoice.concept_id).toBeNull();
    });
});
