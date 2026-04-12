import { describe, expect, it } from 'bun:test';
import { Invoice, InvoiceStatus, InvoiceType } from './Invoice';

describe('Invoice Domain Logic', () => {
    it('should transition to PAID when fully paid', () => {
        const inv = new Invoice({
            id: '1', unit_id: 'u1', amount: 100, paid_amount: 100,
            status: InvoiceStatus.PENDING, type: InvoiceType.DEBT, period: '2024-01', issue_date: new Date()
        });
        inv.updateStatus();
        expect(inv.status).toBe(InvoiceStatus.PAID);
    });

    it('should transition to PARTIAL when partially paid', () => {
        const inv = new Invoice({
            id: '1', unit_id: 'u1', amount: 100, paid_amount: 40,
            status: InvoiceStatus.PENDING, type: InvoiceType.DEBT, period: '2024-01', issue_date: new Date()
        });
        inv.updateStatus();
        expect(inv.status).toBe(InvoiceStatus.PARTIAL);
    });

    it('should calculate remainingBalance correctly', () => {
        const inv = new Invoice({
            id: '1', unit_id: 'u1', amount: 100, paid_amount: 40,
            status: InvoiceStatus.PENDING, type: InvoiceType.DEBT, period: '2024-01', issue_date: new Date()
        });
        expect(inv.remainingBalance).toBe(60);
    });
});
