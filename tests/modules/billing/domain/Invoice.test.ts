import { describe, it, expect } from 'bun:test';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';

const baseProps = {
    id: 'inv-1',
    amount: 100,
    period: '2024-01',
    issue_date: new Date('2024-01-01'),
    status: InvoiceStatus.PENDING,
    type: InvoiceType.EXPENSE,
};

describe('InvoiceTag enum', () => {
    it('should have NORMAL value', () => {
        expect(InvoiceTag.NORMAL as string).toBe('NORMAL');
    });

    it('should have PETTY_CASH value', () => {
        expect(InvoiceTag.PETTY_CASH as string).toBe('PETTY_CASH');
    });
});

describe('Invoice entity — tag and building_id', () => {
    it('should default tag to NORMAL when not provided', () => {
        const invoice = new Invoice({ ...baseProps, unit_id: 'unit-1' });
        expect(invoice.tag).toBe(InvoiceTag.NORMAL);
    });

    it('should accept tag PETTY_CASH', () => {
        const invoice = new Invoice({ ...baseProps, unit_id: 'unit-1', tag: InvoiceTag.PETTY_CASH });
        expect(invoice.tag).toBe(InvoiceTag.PETTY_CASH);
    });

    it('should allow unit_id without building_id', () => {
        expect(() => new Invoice({ ...baseProps, unit_id: 'unit-1' })).not.toThrow();
    });

    it('should allow building_id without unit_id', () => {
        expect(() => new Invoice({ ...baseProps, building_id: 'building-1' })).not.toThrow();
    });

    it('should allow both unit_id and building_id', () => {
        expect(() => new Invoice({ ...baseProps, unit_id: 'unit-1', building_id: 'building-1' })).not.toThrow();
    });

    it('should throw when neither unit_id nor building_id is provided', () => {
        expect(() => new Invoice({ ...baseProps })).toThrow();
    });

    it('should expose building_id getter', () => {
        const invoice = new Invoice({ ...baseProps, building_id: 'building-1' });
        expect(invoice.building_id).toBe('building-1');
    });

    it('should have unit_id as optional (undefined when not set)', () => {
        const invoice = new Invoice({ ...baseProps, building_id: 'building-1' });
        expect(invoice.unit_id).toBeUndefined();
    });
});
