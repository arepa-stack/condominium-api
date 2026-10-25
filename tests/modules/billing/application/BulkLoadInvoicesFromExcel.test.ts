import { describe, expect, it, mock } from 'bun:test';
import { BulkLoadInvoicesFromExcel, ConfirmedInvoice } from '@/modules/billing/application/use-cases/BulkLoadInvoicesFromExcel';
import { Invoice } from '@/modules/billing/domain/entities/Invoice';
import { Unit } from '@/modules/buildings/domain/entities/Unit';

function setup(options: { rejectConcept?: boolean } = {}) {
    const created: Invoice[] = [];
    const invoiceRepository = {
        findAll: mock(async () => []),
        createBatch: mock(async (invoices: Invoice[]) => { created.push(...invoices); }),
    };
    const unitRepository = {
        findByBuildingId: mock(async () => [new Unit({ id: 'unit-02', building_id: 'b1', name: '02' })]),
        createBatch: mock(async () => {}),
    };
    const conceptGuard = {
        assertBillable: mock(async () => {
            if (options.rejectConcept) throw new Error('Charge concept not found in this building');
            return { id: 'c-1' };
        }),
    };
    const useCase = new BulkLoadInvoicesFromExcel(invoiceRepository as any, unitRepository as any, conceptGuard as any);
    return { useCase, created, unitRepository, conceptGuard };
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

    it('assigns the chosen charge concept to every imported invoice', async () => {
        const { useCase, created, conceptGuard } = setup();

        await useCase.execute({ buildingId: 'b1', conceptId: 'c-1', invoices: [row, { ...row, receiptNumber: '0926043002' }] });

        expect(conceptGuard.assertBillable).toHaveBeenCalledWith('c-1', 'b1');
        expect(created.map(i => i.concept_id)).toEqual(['c-1', 'c-1']);
    });

    it('creates no units and no invoices when the concept is rejected', async () => {
        const { useCase, created, unitRepository } = setup({ rejectConcept: true });

        await expect(useCase.execute({ buildingId: 'b1', conceptId: 'c-9', invoices: [{ ...row, unitName: '99', status: 'TO_BE_CREATED' }] }))
            .rejects.toThrow('Charge concept not found in this building');
        expect(unitRepository.createBatch).not.toHaveBeenCalled();
        expect(created).toHaveLength(0);
    });

    it('leaves the concept empty when none is chosen', async () => {
        const { useCase, created, conceptGuard } = setup();

        await useCase.execute({ buildingId: 'b1', invoices: [row] });

        expect(conceptGuard.assertBillable).not.toHaveBeenCalled();
        expect(created[0].concept_id).toBeNull();
    });
});
