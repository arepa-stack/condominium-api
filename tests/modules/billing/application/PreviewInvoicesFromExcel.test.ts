import { describe, expect, it } from 'bun:test';
import { PreviewInvoicesFromExcel } from '@/modules/billing/application/use-cases/PreviewInvoicesFromExcel';
import { IInvoiceFileParser, RawInvoiceData } from '@/modules/billing/domain/services/IExcelInvoiceParser';
import { Unit } from '@/modules/buildings/domain/entities/Unit';

function row(unitName: string): RawInvoiceData {
    return { unitName, amount: 10, period: '2026-09', issueDate: new Date('2026-10-05'), receiptNumber: `R-${unitName}` };
}

function preview(unitNamesInDb: string[], fileUnitNames: string[]) {
    const units = unitNamesInDb.map((name, i) => new Unit({ id: `u${i}`, building_id: 'b1', name }));
    const unitRepository = { findByBuildingId: async () => units } as any;
    const parser: IInvoiceFileParser = {
        parse: async () => ({ invoices: fileUnitNames.map(row), summary: { totalAmount: 0, invoiceCount: 0 } }),
    };
    return new PreviewInvoicesFromExcel(unitRepository, parser).execute(Buffer.from(''), 'b1');
}

describe('PreviewInvoicesFromExcel unit matching', () => {
    it('matches unit names exactly, ignoring case (existing behavior)', async () => {
        const result = await preview(['0-2', 'Torre A'], ['0-2', 'torre a']);

        expect(result.invoices.map(i => [i.unitName, i.unitId, i.status])).toEqual([
            ['0-2', 'u0', 'EXISTS'],
            ['torre a', 'u1', 'EXISTS'],
        ]);
        expect(result.unitsToCreate).toEqual([]);
    });

    it('matches a unit written in another format and uses the name stored in the building', async () => {
        const result = await preview(['0-2', 'P-H'], ['02', 'PH']);

        expect(result.invoices.map(i => [i.unitName, i.unitId, i.status])).toEqual([
            ['0-2', 'u0', 'EXISTS'],
            ['P-H', 'u1', 'EXISTS'],
        ]);
        expect(result.unitsToCreate).toEqual([]);
    });

    it('does not guess when several units match once separators are ignored', async () => {
        const result = await preview(['0-2', '0 2'], ['02']);

        expect(result.invoices[0]).toMatchObject({ unitName: '02', status: 'TO_BE_CREATED' });
        expect(result.invoices[0].unitId).toBeUndefined();
        expect(result.unitsToCreate).toEqual(['02']);
    });

    it('proposes a new unit when nothing matches', async () => {
        const result = await preview(['0-2'], ['9-9']);

        expect(result.invoices[0]).toMatchObject({ unitName: '9-9', status: 'TO_BE_CREATED' });
        expect(result.unitsToCreate).toEqual(['9-9']);
    });
});
