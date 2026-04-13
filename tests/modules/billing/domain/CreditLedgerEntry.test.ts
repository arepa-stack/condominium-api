import { describe, it, expect } from 'bun:test';
import { CreditLedgerEntry, CreditLedgerReferenceType } from '@/modules/billing/domain/entities/CreditLedgerEntry';

const baseProps = {
    id: 'entry-1',
    unit_id: 'unit-1',
    reason: 'Overpayment credit',
    reference_type: CreditLedgerReferenceType.PAYMENT,
    reference_id: 'payment-1',
    created_at: new Date('2024-01-01'),
};

describe('CreditLedgerEntry entity', () => {
    describe('validation', () => {
        it('should throw when amount is 0', () => {
            expect(() => new CreditLedgerEntry({ ...baseProps, amount: 0 })).toThrow();
        });

        it('should allow positive amount (credit)', () => {
            expect(() => new CreditLedgerEntry({ ...baseProps, amount: 100 })).not.toThrow();
        });

        it('should allow negative amount (deduction)', () => {
            expect(() => new CreditLedgerEntry({ ...baseProps, amount: -50 })).not.toThrow();
        });

        it('should throw when unit_id is empty', () => {
            expect(() => new CreditLedgerEntry({ ...baseProps, amount: 100, unit_id: '' })).toThrow(/unit_id/);
        });

        it('should throw when reason is empty', () => {
            expect(() => new CreditLedgerEntry({ ...baseProps, amount: 100, reason: '  ' })).toThrow(/reason/);
        });

        it('should throw when reference_id is empty', () => {
            expect(() => new CreditLedgerEntry({ ...baseProps, amount: 100, reference_id: '' })).toThrow(/reference_id/);
        });

        it('should throw when reference_type is not a known enum value', () => {
            expect(() => new CreditLedgerEntry({
                ...baseProps,
                amount: 100,
                reference_type: 'REVERSAL' as unknown as CreditLedgerReferenceType
            })).toThrow(/reference_type/);
        });
    });

    it('should expose all fields', () => {
        const entry = new CreditLedgerEntry({ ...baseProps, amount: 200 });
        expect(entry.id).toBe('entry-1');
        expect(entry.unit_id).toBe('unit-1');
        expect(entry.amount).toBe(200);
        expect(entry.reason).toBe('Overpayment credit');
        expect(entry.reference_type).toBe(CreditLedgerReferenceType.PAYMENT);
        expect(entry.reference_id).toBe('payment-1');
        expect(entry.created_at).toBeInstanceOf(Date);
    });

    it('should set created_at to now when not provided', () => {
        const entry = new CreditLedgerEntry({ ...baseProps, amount: 100, created_at: undefined });
        expect(entry.created_at).toBeInstanceOf(Date);
    });

    describe('reversalOf factory', () => {
        it('negates the amount of the original entry', () => {
            const original = new CreditLedgerEntry({ ...baseProps, amount: 20 });
            const reversal = CreditLedgerEntry.reversalOf(original, 'test reversal');
            expect(reversal.amount).toBe(-20);
        });

        it('produces a REVERSAL reference_type', () => {
            const original = new CreditLedgerEntry({ ...baseProps, amount: 20 });
            const reversal = CreditLedgerEntry.reversalOf(original, 'test reversal');
            expect(reversal.reference_type).toBe(CreditLedgerReferenceType.REVERSAL);
        });

        it('preserves unit_id and reference_id to link audit trail', () => {
            const original = new CreditLedgerEntry({ ...baseProps, amount: 20 });
            const reversal = CreditLedgerEntry.reversalOf(original, 'test reversal');
            expect(reversal.unit_id).toBe(original.unit_id);
            expect(reversal.reference_id).toBe(original.reference_id);
        });

        it('double-reversal reconstructs the original amount sign', () => {
            const original = new CreditLedgerEntry({ ...baseProps, amount: 20 });
            const reversal = CreditLedgerEntry.reversalOf(original, 'first');
            const undo = CreditLedgerEntry.reversalOf(reversal, 'second');
            expect(undo.amount).toBe(20);
        });
    });
});
