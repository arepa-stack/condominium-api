import { describe, expect, it } from 'bun:test';
import { Invoice, InvoiceStatus, InvoiceType } from './Invoice';

const makeInvoice = (overrides: Partial<{
    status: InvoiceStatus;
    amount: number;
    paid_amount: number;
}> = {}) => new Invoice({
    id: '1',
    unit_id: 'u1',
    amount: overrides.amount ?? 100,
    paid_amount: overrides.paid_amount ?? 0,
    status: overrides.status ?? InvoiceStatus.PENDING,
    type: InvoiceType.DEBT,
    period: '2024-01',
    issue_date: new Date()
});

describe('Invoice Domain Logic', () => {
    it('should transition to PAID when fully paid', () => {
        const inv = makeInvoice({ paid_amount: 100 });
        inv.updateStatus();
        expect(inv.status).toBe(InvoiceStatus.PAID);
    });

    it('should transition to PARTIAL when partially paid', () => {
        const inv = makeInvoice({ paid_amount: 40 });
        inv.updateStatus();
        expect(inv.status).toBe(InvoiceStatus.PARTIAL);
    });

    it('should calculate remainingBalance correctly', () => {
        const inv = makeInvoice({ paid_amount: 40 });
        expect(inv.remainingBalance).toBe(60);
    });
});

describe('Invoice status transition guard', () => {
    describe('valid transitions', () => {
        it('PENDING -> PARTIAL', () => {
            const inv = makeInvoice({ status: InvoiceStatus.PENDING });
            expect(() => inv.markAsPartial()).not.toThrow();
            expect(inv.status).toBe(InvoiceStatus.PARTIAL);
        });

        it('PENDING -> PAID', () => {
            const inv = makeInvoice({ status: InvoiceStatus.PENDING });
            expect(() => inv.markAsPaid()).not.toThrow();
            expect(inv.status).toBe(InvoiceStatus.PAID);
        });

        it('PENDING -> CANCELLED', () => {
            const inv = makeInvoice({ status: InvoiceStatus.PENDING });
            expect(() => inv.cancel()).not.toThrow();
            expect(inv.status).toBe(InvoiceStatus.CANCELLED);
        });

        it('PARTIAL -> PAID', () => {
            const inv = makeInvoice({ status: InvoiceStatus.PARTIAL, paid_amount: 40 });
            expect(() => inv.markAsPaid()).not.toThrow();
            expect(inv.status).toBe(InvoiceStatus.PAID);
        });

        it('PARTIAL -> CANCELLED', () => {
            const inv = makeInvoice({ status: InvoiceStatus.PARTIAL, paid_amount: 40 });
            expect(() => inv.cancel()).not.toThrow();
            expect(inv.status).toBe(InvoiceStatus.CANCELLED);
        });

        it('PAID -> PARTIAL (supports payment reversal)', () => {
            const inv = makeInvoice({ status: InvoiceStatus.PAID, paid_amount: 100 });
            expect(() => inv.markAsPartial()).not.toThrow();
            expect(inv.status).toBe(InvoiceStatus.PARTIAL);
        });

        it('PAID -> PENDING via updateStatus when paid_amount drops to zero (full reversal)', () => {
            const inv = makeInvoice({ status: InvoiceStatus.PAID, paid_amount: 100 });
            (inv as any).props.paid_amount = 0;
            expect(() => inv.updateStatus()).not.toThrow();
            expect(inv.status).toBe(InvoiceStatus.PENDING);
        });

        it('same-status transitions are idempotent no-ops', () => {
            const inv = makeInvoice({ status: InvoiceStatus.PARTIAL, paid_amount: 40 });
            expect(() => inv.markAsPartial()).not.toThrow();
            expect(inv.status).toBe(InvoiceStatus.PARTIAL);
        });
    });

    describe('illegal transitions are rejected', () => {
        it('CANCELLED -> PAID throws', () => {
            const inv = makeInvoice({ status: InvoiceStatus.CANCELLED });
            expect(() => inv.markAsPaid()).toThrow(/CANCELLED -> PAID/);
        });

        it('CANCELLED -> PARTIAL throws', () => {
            const inv = makeInvoice({ status: InvoiceStatus.CANCELLED });
            expect(() => inv.markAsPartial()).toThrow(/CANCELLED -> PARTIAL/);
        });

        it('CANCELLED cannot be revived via updateStatus even with paid_amount >= amount', () => {
            const inv = makeInvoice({ status: InvoiceStatus.CANCELLED, paid_amount: 100 });
            expect(() => inv.updateStatus()).toThrow(/CANCELLED -> PAID/);
            expect(inv.status).toBe(InvoiceStatus.CANCELLED);
        });

        it('PAID -> CANCELLED throws (refunds are a separate flow)', () => {
            const inv = makeInvoice({ status: InvoiceStatus.PAID, paid_amount: 100 });
            expect(() => inv.cancel()).toThrow(/PAID -> CANCELLED/);
        });
    });
});
