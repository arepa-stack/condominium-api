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

        it('PAID -> PENDING via subtractPayment + updateStatus (full reversal)', () => {
            const inv = makeInvoice({ status: InvoiceStatus.PAID, paid_amount: 100 });
            inv.subtractPayment(100);
            expect(() => inv.updateStatus()).not.toThrow();
            expect(inv.status).toBe(InvoiceStatus.PENDING);
            expect(inv.paid_amount).toBe(0);
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

describe('Invoice.addPayment', () => {
    it('increments paid_amount', () => {
        const inv = makeInvoice({ status: InvoiceStatus.PENDING, paid_amount: 0 });
        inv.addPayment(40);
        expect(inv.paid_amount).toBe(40);
    });

    it('accumulates across multiple calls', () => {
        const inv = makeInvoice({ status: InvoiceStatus.PENDING, paid_amount: 0 });
        inv.addPayment(30);
        inv.addPayment(25);
        expect(inv.paid_amount).toBe(55);
    });

    it('allows reaching exactly the invoice amount', () => {
        const inv = makeInvoice({ status: InvoiceStatus.PENDING, paid_amount: 0 });
        inv.addPayment(100);
        expect(inv.paid_amount).toBe(100);
    });

    it('throws when the result would exceed invoice amount', () => {
        const inv = makeInvoice({ status: InvoiceStatus.PENDING, paid_amount: 0 });
        expect(() => inv.addPayment(150)).toThrow(/exceed invoice amount/);
    });

    it('throws when the result would exceed after accumulation', () => {
        const inv = makeInvoice({ status: InvoiceStatus.PARTIAL, paid_amount: 80 });
        expect(() => inv.addPayment(30)).toThrow(/exceed invoice amount/);
    });

    it('rejects zero', () => {
        const inv = makeInvoice({ paid_amount: 0 });
        expect(() => inv.addPayment(0)).toThrow(/must be positive/);
    });

    it('rejects negative amounts', () => {
        const inv = makeInvoice({ paid_amount: 0 });
        expect(() => inv.addPayment(-10)).toThrow(/must be positive/);
    });
});

describe('Invoice.subtractPayment', () => {
    it('decrements paid_amount', () => {
        const inv = makeInvoice({ status: InvoiceStatus.PAID, paid_amount: 100 });
        inv.subtractPayment(40);
        expect(inv.paid_amount).toBe(60);
    });

    it('can drain paid_amount back to zero', () => {
        const inv = makeInvoice({ status: InvoiceStatus.PAID, paid_amount: 100 });
        inv.subtractPayment(100);
        expect(inv.paid_amount).toBe(0);
    });

    it('clamps to zero instead of going negative when subtracting more than paid', () => {
        // Defensive: if the caller passes a bad amount we clamp rather than
        // produce an impossible negative paid_amount. The caller still has the
        // opportunity to detect the anomaly through other means.
        const inv = makeInvoice({ status: InvoiceStatus.PARTIAL, paid_amount: 30 });
        inv.subtractPayment(50);
        expect(inv.paid_amount).toBe(0);
    });

    it('rejects zero', () => {
        const inv = makeInvoice({ paid_amount: 100 });
        expect(() => inv.subtractPayment(0)).toThrow(/must be positive/);
    });

    it('rejects negative amounts', () => {
        const inv = makeInvoice({ paid_amount: 100 });
        expect(() => inv.subtractPayment(-10)).toThrow(/must be positive/);
    });
});
