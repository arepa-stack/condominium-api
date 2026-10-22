import { describe, expect, it, mock } from 'bun:test';
import { BulkLoadInvoicesFromExcel, ConfirmedInvoice } from '@/modules/billing/application/use-cases/BulkLoadInvoicesFromExcel';
import { Invoice } from '@/modules/billing/domain/entities/Invoice';
import { Unit } from '@/modules/buildings/domain/entities/Unit';

function setup() {
    const created: Invoice[] = [];
    const invoiceRepository = {
        findAll: mock(async () => []),
        createBatch: mock(async (invoices: Invoice[]) => { created.push(...invoices); }),
    };
    const unitRepository = {
        findByBuildingId: mock(async () => [new Unit({ id: 'unit-02', building_id: 'b1', name: '02' })]),
        createBatch: mock(async () => {}),
    };
    const useCase = new BulkLoadInvoicesFromExcel(invoiceRepository as any, unitRepository as any);
    return { useCase, created };
}

const row: ConfirmedInvoice = {
    unitName: '02',
    amount: 44.56,
    period: '2026-09',
    issueDate: '2026-10-05T00:00:00.000Z',
    receiptNumber: '0926043001',
    status: 'EXISTS',
};

describe('BulkLoadInvoicesFromExcel', () => {
    it('uses the description provided by the parsed file', async () => {
        const { useCase, created } = setup();

        await useCase.execute({ buildingId: 'b1', invoices: [{ ...row, description: 'Condominio SEP - 2026 - Aviso 0926043001' }] });

        expect(created).toHaveLength(1);
        expect(created[0].description).toBe('Condominio SEP - 2026 - Aviso 0926043001');
        expect(created[0].amount).toBe(44.56);
        expect(created[0].unit_id).toBe('unit-02');
    });

    it('keeps the "Carga inicial" description when none is provided (Excel rows)', async () => {
        const { useCase, created } = setup();

        await useCase.execute({ buildingId: 'b1', invoices: [row] });

        expect(created[0].description).toBe('Carga inicial - Recibo 0926043001');
    });
});
