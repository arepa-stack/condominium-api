import { describe, expect, it, mock } from 'bun:test';
import { ProcessInvoiceOverpayment } from './ProcessInvoiceOverpayment';
import { Invoice, InvoiceStatus, InvoiceType } from '../../domain/entities/Invoice';
import { CreditLedgerEntry, CreditLedgerReferenceType } from '../../domain/entities/CreditLedgerEntry';
import { InvoiceTag } from '@/core/domain/enums';

describe('ProcessInvoiceOverpayment', () => {
    const mockInvoiceRepo = {
        findById: mock(async (id: string) => {
            if (id === 'inv-123') return new Invoice({
                id: 'inv-123',
                unit_id: 'unit-1',
                amount: 100,
                paid_amount: 0,
                period: '2024-01',
                issue_date: new Date(),
                status: InvoiceStatus.PENDING,
                type: InvoiceType.DEBT
            });
            return null;
        }),
        update: mock(async () => { })
    };

    const mockCreditRepo = {
        addCredit: mock(async () => ({}) as any),
        getBalanceForUnit: mock(async () => 50),
        findByReferenceId: mock(async () => [] as CreditLedgerEntry[])
    };

    const useCase = new ProcessInvoiceOverpayment(mockInvoiceRepo as any, mockCreditRepo as any);

    it('should generate credit when payment exceeds invoice amount (CA8)', async () => {
        const result = await useCase.execute({
            invoiceId: 'inv-123',
            paymentId: 'pay-456',
            paymentAmount: 120
        });

        expect(result.appliedToInvoice).toBe(100);
        expect(result.generatedUnitCredit).toBe(20);

        // Verify credit ledger was called
        expect(mockCreditRepo.addCredit).toHaveBeenCalled();
        const callArgs = mockCreditRepo.addCredit.mock.calls[0][0] as CreditLedgerEntry;
        expect(callArgs.amount).toBe(20);
        expect(callArgs.unit_id).toBe('unit-1');
        expect(callArgs.reference_id).toBe('pay-456');
    });

    it('should not generate credit when payment equals invoice amount', async () => {
        mockCreditRepo.addCredit.mockClear();
        const result = await useCase.execute({
            invoiceId: 'inv-123',
            paymentId: 'pay-456',
            paymentAmount: 100
        });

        expect(result.appliedToInvoice).toBe(100);
        expect(result.generatedUnitCredit).toBe(0);
        expect(mockCreditRepo.addCredit).not.toHaveBeenCalled();
    });
});

describe('ProcessInvoiceOverpayment — idempotency', () => {
    const makeInvoiceRepo = () => ({
        findById: mock(async () => new Invoice({
            id: 'inv-123', unit_id: 'unit-1', amount: 100, paid_amount: 0,
            period: '2024-01', issue_date: new Date(),
            status: InvoiceStatus.PENDING, type: InvoiceType.DEBT
        })),
        update: mock(async () => { })
    });

    it('skips credit creation on retry when the same (payment, invoice) already has a credit entry', async () => {
        const existingEntry = new CreditLedgerEntry({
            id: 'existing',
            unit_id: 'unit-1',
            amount: 20,
            reason: 'Excedente de pago en factura inv-123',
            reference_type: CreditLedgerReferenceType.PAYMENT,
            reference_id: 'pay-456'
        });

        const creditRepo = {
            addCredit: mock(async () => ({}) as any),
            getBalanceForUnit: mock(async () => 20),
            findByReferenceId: mock(async () => [existingEntry])
        };

        const useCase = new ProcessInvoiceOverpayment(makeInvoiceRepo() as any, creditRepo as any);

        const result = await useCase.execute({
            invoiceId: 'inv-123',
            paymentId: 'pay-456',
            paymentAmount: 120
        });

        // The split result still reports the would-be overpayment — it's a
        // pure calculation. The persistence side is what stays idempotent.
        expect(result.generatedUnitCredit).toBe(20);
        expect(creditRepo.addCredit).not.toHaveBeenCalled();
    });

    it('still creates credit for a different invoice on the same payment', async () => {
        // Payment pay-456 already has a credit for invoice inv-A; a second
        // allocation against inv-B should produce its own credit entry.
        const entryForInvA = new CreditLedgerEntry({
            id: 'existing',
            unit_id: 'unit-1',
            amount: 20,
            reason: 'Excedente de pago en factura inv-A',
            reference_type: CreditLedgerReferenceType.PAYMENT,
            reference_id: 'pay-456'
        });

        const invoiceRepo = {
            findById: mock(async () => new Invoice({
                id: 'inv-B', unit_id: 'unit-1', amount: 50, paid_amount: 0,
                period: '2024-02', issue_date: new Date(),
                status: InvoiceStatus.PENDING, type: InvoiceType.DEBT
            })),
            update: mock(async () => { })
        };

        const creditRepo = {
            addCredit: mock(async () => ({}) as any),
            getBalanceForUnit: mock(async () => 20),
            findByReferenceId: mock(async () => [entryForInvA])
        };

        const useCase = new ProcessInvoiceOverpayment(invoiceRepo as any, creditRepo as any);

        await useCase.execute({
            invoiceId: 'inv-B',
            paymentId: 'pay-456',
            paymentAmount: 80
        });

        expect(creditRepo.addCredit).toHaveBeenCalledTimes(1);
    });
});

describe('ProcessInvoiceOverpayment — building-level invoice', () => {
    it('warns and drops overpayment when invoice has no unit_id', async () => {
        const invoiceRepo = {
            findById: mock(async () => new Invoice({
                id: 'inv-building',
                building_id: 'b1',
                amount: 100,
                paid_amount: 0,
                period: '2024-01',
                issue_date: new Date(),
                status: InvoiceStatus.PENDING,
                type: InvoiceType.EXPENSE,
                tag: InvoiceTag.PETTY_CASH
            })),
            update: mock(async () => { })
        };

        const creditRepo = {
            addCredit: mock(async () => ({}) as any),
            getBalanceForUnit: mock(async () => 0),
            findByReferenceId: mock(async () => [])
        };

        const warnSpy = mock(() => { });
        const originalWarn = console.warn;
        console.warn = warnSpy;

        try {
            const useCase = new ProcessInvoiceOverpayment(invoiceRepo as any, creditRepo as any);
            const result = await useCase.execute({
                invoiceId: 'inv-building',
                paymentId: 'pay-999',
                paymentAmount: 150
            });

            expect(result.generatedUnitCredit).toBe(50);
            expect(creditRepo.addCredit).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalled();
        } finally {
            console.warn = originalWarn;
        }
    });
});
