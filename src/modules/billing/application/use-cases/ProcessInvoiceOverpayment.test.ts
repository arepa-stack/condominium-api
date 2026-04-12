import { describe, expect, it, mock } from 'bun:test';
import { ProcessInvoiceOverpayment } from './ProcessInvoiceOverpayment';
import { Invoice, InvoiceStatus, InvoiceType } from '../../domain/entities/Invoice';
import { CreditLedgerEntry } from '../../domain/entities/CreditLedgerEntry';

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
        getBalanceForUnit: mock(async () => 50)
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
        expect(result.invoiceStatus).toBe(InvoiceStatus.PAID);
        
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
