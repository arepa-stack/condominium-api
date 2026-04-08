import { describe, it, expect } from 'bun:test';
import { CreditLedgerEntry } from '@/modules/billing/domain/entities/CreditLedgerEntry';

const baseProps = {
    id: 'entry-1',
    unit_id: 'unit-1',
    reason: 'Overpayment credit',
    reference_type: 'payment',
    reference_id: 'payment-1',
    created_at: new Date('2024-01-01'),
};

describe('CreditLedgerEntry entity', () => {
    it('should throw when amount is 0', () => {
        expect(() => new CreditLedgerEntry({ ...baseProps, amount: 0 })).toThrow();
    });

    it('should allow positive amount (credit)', () => {
        expect(() => new CreditLedgerEntry({ ...baseProps, amount: 100 })).not.toThrow();
    });

    it('should allow negative amount (deduction)', () => {
        expect(() => new CreditLedgerEntry({ ...baseProps, amount: -50 })).not.toThrow();
    });

    it('should expose all fields', () => {
        const entry = new CreditLedgerEntry({ ...baseProps, amount: 200 });
        expect(entry.id).toBe('entry-1');
        expect(entry.unit_id).toBe('unit-1');
        expect(entry.amount).toBe(200);
        expect(entry.reason).toBe('Overpayment credit');
        expect(entry.reference_type).toBe('payment');
        expect(entry.reference_id).toBe('payment-1');
        expect(entry.created_at).toBeInstanceOf(Date);
    });

    it('should set created_at to now when not provided', () => {
        const entry = new CreditLedgerEntry({ ...baseProps, amount: 100, created_at: undefined });
        expect(entry.created_at).toBeInstanceOf(Date);
    });
});
