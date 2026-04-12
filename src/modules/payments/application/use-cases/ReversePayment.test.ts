import { describe, expect, it, mock } from 'bun:test';
import { ReversePayment } from './ReversePayment';
import { Payment } from '../../domain/entities/Payment';
import { PaymentStatus, PaymentMethod } from '@/core/domain/enums';
import { CreditLedgerEntry, CreditLedgerReferenceType } from '@/modules/billing/domain/entities/CreditLedgerEntry';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';

describe('ReversePayment', () => {
    const mockPaymentRepo = {
        findById: mock(async (id: string) => {
            return new Payment({
                id: 'pay-1',
                amount: 100,
                status: PaymentStatus.APPROVED,
                method: PaymentMethod.CASH,
                payment_date: new Date(),
                unit_id: 'u1',
                building_id: 'b1'
            });
        }),
        update: mock(async () => { })
    };

    const mockInvoiceRepo = {
        findById: mock(async (id: string) => {
            return new Invoice({
                id: id, unit_id: 'u1', amount: 100, paid_amount: 100,
                period: '2024-01', issue_date: new Date(), status: InvoiceStatus.PAID, type: InvoiceType.DEBT
            });
        }),
        update: mock(async () => { })
    };

    const mockAllocationRepo = {
        findByPaymentId: mock(async () => [{ invoice_id: 'i1', amount: 100 } as any])
    };

    const mockCreditEntry = new CreditLedgerEntry({
        id: 'c1', unit_id: 'u1', amount: 20, reason: 'Test', reference_type: CreditLedgerReferenceType.PAYMENT, reference_id: 'pay-1'
    });

    const mockCreditLedgerRepo = {
        findByReferenceId: mock(async () => [mockCreditEntry]),
        deductCredit: mock(async () => ({}) as any)
    };

    const useCase = new ReversePayment(
        mockPaymentRepo as any,
        mockInvoiceRepo as any,
        mockAllocationRepo as any,
        mockCreditLedgerRepo as any
    );

    it('should reverse payment and create debit entry (CA12)', async () => {
        await useCase.execute({
            paymentId: 'pay-1',
            requesterId: 'admin-1',
            reason: 'Error en registro'
        });

        // 1. Payment marked as REJECTED (with REVERSED note)
        expect(mockPaymentRepo.update).toHaveBeenCalled();
        const updatedPayment = mockPaymentRepo.update.mock.calls[0][0] as Payment;
        expect(updatedPayment.status).toBe(PaymentStatus.REJECTED);
        expect(updatedPayment.notes).toContain('REVERSED');

        // 2. Debit entry created
        expect(mockCreditLedgerRepo.deductCredit).toHaveBeenCalled();
        const debitEntry = mockCreditLedgerRepo.deductCredit.mock.calls[0][0] as CreditLedgerEntry;
        expect(debitEntry.amount).toBe(-20);
        expect(debitEntry.isDebit).toBe(true);

        // 3. Invoice updated
        expect(mockInvoiceRepo.update).toHaveBeenCalled();
    });
});

describe('ReversePayment — CANCELLED invoice handling', () => {
    // Regression guard: after introducing the Invoice transition guard
    // (commit aabf4dd), calling updateStatus() on a CANCELLED invoice
    // throws INVALID_STATE_TRANSITION. ReversePayment must skip cancelled
    // invoices in its allocation loop so a reversal that touches one
    // doesn't explode mid-flight.

    const makePaymentRepo = () => ({
        findById: mock(async () => new Payment({
            id: 'pay-2',
            amount: 100,
            status: PaymentStatus.APPROVED,
            method: PaymentMethod.CASH,
            payment_date: new Date(),
            unit_id: 'u1',
            building_id: 'b1'
        })),
        update: mock(async () => { })
    });

    const makeCancelledInvoiceRepo = () => ({
        findById: mock(async (id: string) => new Invoice({
            id,
            unit_id: 'u1',
            amount: 100,
            paid_amount: 100,
            period: '2024-01',
            issue_date: new Date(),
            status: InvoiceStatus.CANCELLED,
            type: InvoiceType.DEBT
        })),
        update: mock(async () => { })
    });

    const allocationRepo = {
        findByPaymentId: mock(async () => [{ invoice_id: 'i-cancelled', amount: 100 } as any])
    };

    const creditLedgerRepo = {
        findByReferenceId: mock(async () => []),
        deductCredit: mock(async () => ({}) as any)
    };

    it('skips cancelled invoices without throwing INVALID_STATE_TRANSITION', async () => {
        const paymentRepo = makePaymentRepo();
        const invoiceRepo = makeCancelledInvoiceRepo();

        const useCase = new ReversePayment(
            paymentRepo as any,
            invoiceRepo as any,
            allocationRepo as any,
            creditLedgerRepo as any
        );

        await expect(useCase.execute({
            paymentId: 'pay-2',
            requesterId: 'admin-1',
            reason: 'Test cancelled invoice path'
        })).resolves.toBeUndefined();

        // Cancelled invoice should NOT be updated — skipped entirely.
        expect(invoiceRepo.update).not.toHaveBeenCalled();
        // Payment itself still reaches REJECTED state.
        expect(paymentRepo.update).toHaveBeenCalled();
    });
});
