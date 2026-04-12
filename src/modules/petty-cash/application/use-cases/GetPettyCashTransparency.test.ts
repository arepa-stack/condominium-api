import { describe, expect, it, mock } from 'bun:test';
import { GetPettyCashTransparency } from './GetPettyCashTransparency';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';

describe('GetPettyCashTransparency', () => {
    const mockUnits = [
        { id: 'u1', name: 'Apto 1' },
        { id: 'u2', name: 'Apto 2' }
    ];

    const mockInvoices = [
        new Invoice({
            id: 'i1', unit_id: 'u1', building_id: 'b1', amount: 80, paid_amount: 100, // Overpaid
            period: '2024-01', issue_date: new Date(), status: InvoiceStatus.PAID, type: InvoiceType.DEBT, tag: InvoiceTag.PETTY_CASH
        }),
        new Invoice({
            id: 'i2', unit_id: 'u2', building_id: 'b1', amount: 80, paid_amount: 30, // Partial
            period: '2024-01', issue_date: new Date(), status: InvoiceStatus.PARTIAL, type: InvoiceType.DEBT, tag: InvoiceTag.PETTY_CASH
        })
    ];

    const mockInvoiceRepo = {
        findAll: mock(async () => mockInvoices),
    };

    const mockUnitRepo = {
        findByBuildingId: mock(async () => mockUnits as any),
    };

    const useCase = new GetPettyCashTransparency(mockInvoiceRepo as any, mockUnitRepo as any);

    it('should calculate transparency with quota capping (RN1, RN5, CA9)', async () => {
        const result = await useCase.execute('b1');

        expect(result.total_to_collect).toBe(160); // 80 + 80
        
        // Apto 1: paid 100, but capped at 80
        // Apto 2: paid 30
        // Total should be 80 + 30 = 110
        expect(result.total_collected).toBe(110);
        expect(result.collection_percentage).toBe(68.75); // (110/160)*100

        const apto1 = result.units.find(u => u.unit_id === 'u1');
        expect(apto1?.covered_amount).toBe(80);
        expect(apto1?.expected_amount).toBe(80);

        const apto2 = result.units.find(u => u.unit_id === 'u2');
        expect(apto2?.covered_amount).toBe(30);
        expect(apto2?.expected_amount).toBe(80);
    });
});
