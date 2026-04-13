import { describe, expect, it } from 'bun:test';
import { OverpaymentService } from './OverpaymentService';

describe('OverpaymentService', () => {
    const service = new OverpaymentService();

    describe('money split', () => {
        it('exact payment applies to invoice with no credit', () => {
            const result = service.calculate(100, 0, 100);
            expect(result.appliedToInvoice).toBe(100);
            expect(result.generatedCredit).toBe(0);
        });

        it('partial payment applies full amount to invoice', () => {
            const result = service.calculate(100, 0, 60);
            expect(result.appliedToInvoice).toBe(60);
            expect(result.generatedCredit).toBe(0);
        });

        it('overpayment splits between invoice and credit', () => {
            const result = service.calculate(100, 0, 150);
            expect(result.appliedToInvoice).toBe(100);
            expect(result.generatedCredit).toBe(50);
        });

        it('overpayment on an already partially paid invoice', () => {
            const result = service.calculate(100, 40, 80);
            // Remaining was 60. Paid 80. → 60 to invoice, 20 to credit.
            expect(result.appliedToInvoice).toBe(60);
            expect(result.generatedCredit).toBe(20);
        });

        it('payment against a fully paid invoice becomes pure credit', () => {
            const result = service.calculate(100, 100, 30);
            expect(result.appliedToInvoice).toBe(0);
            expect(result.generatedCredit).toBe(30);
        });
    });

    describe('input validation', () => {
        it('rejects zero payment amount', () => {
            expect(() => service.calculate(100, 0, 0)).toThrow(/paymentAmount/);
        });

        it('rejects negative payment amount', () => {
            expect(() => service.calculate(100, 0, -50)).toThrow(/paymentAmount/);
        });

        it('rejects negative invoice amount', () => {
            expect(() => service.calculate(-100, 0, 50)).toThrow(/invoiceAmount/);
        });

        it('rejects negative invoice paid_amount', () => {
            expect(() => service.calculate(100, -10, 50)).toThrow(/invoicePaidAmount/);
        });
    });
});
