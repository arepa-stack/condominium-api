import { describe, expect, it } from 'bun:test';
import { OverpaymentService } from './OverpaymentService';
import { InvoiceStatus } from '../entities/Invoice';

describe('OverpaymentService', () => {
    const service = new OverpaymentService();

    it('should handle exact payment correctly', () => {
        const result = service.calculate(100, 0, 100);
        expect(result.appliedToInvoice).toBe(100);
        expect(result.generatedCredit).toBe(0);
        expect(result.invoiceStatus).toBe(InvoiceStatus.PAID);
    });

    it('should handle partial payment correctly', () => {
        const result = service.calculate(100, 0, 60);
        expect(result.appliedToInvoice).toBe(60);
        expect(result.generatedCredit).toBe(0);
        expect(result.invoiceStatus).toBe(InvoiceStatus.PARTIAL);
    });

    it('should handle overpayment correctly', () => {
        const result = service.calculate(100, 0, 150);
        expect(result.appliedToInvoice).toBe(100);
        expect(result.generatedCredit).toBe(50);
        expect(result.invoiceStatus).toBe(InvoiceStatus.PAID);
    });

    it('should handle overpayment on already partial invoice', () => {
        const result = service.calculate(100, 40, 80);
        // Remaining was 60. Paid 80.
        expect(result.appliedToInvoice).toBe(60);
        expect(result.generatedCredit).toBe(20);
        expect(result.invoiceStatus).toBe(InvoiceStatus.PAID);
    });

    it('should handle zero payment gracefully', () => {
        const result = service.calculate(100, 0, 0);
        expect(result.appliedToInvoice).toBe(0);
        expect(result.generatedCredit).toBe(0);
        expect(result.invoiceStatus).toBe(InvoiceStatus.PENDING);
    });
});
