import { describe, expect, it, mock } from 'bun:test';
import { BillConcept } from '@/modules/billing/application/use-cases/BillConcept';
import { ChargeConcept, ChargeConceptKind, ChargeDistribution } from '@/modules/billing/domain/entities/ChargeConcept';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { Unit } from '@/modules/buildings/domain/entities/Unit';

const extraordinary = new ChargeConcept({
    id: 'c-1', building_id: 'b-1', name: 'Reparaciones y Pintura', kind: ChargeConceptKind.EXTRAORDINARY, base_amount: 3100,
});
const condominio = new ChargeConcept({ id: 'c-2', building_id: 'b-1', name: 'Condominio', kind: ChargeConceptKind.ORDINARY, distribution: ChargeDistribution.EQUAL });

const units = [
    new Unit({ id: 'u1', building_id: 'b-1', name: '1-1', aliquot: 60 }),
    new Unit({ id: 'u2', building_id: 'b-1', name: '1-2', aliquot: 40 }),
];

function setup(options: { concept?: ChargeConcept; existing?: Invoice[] } = {}) {
    const created: Invoice[] = [];
    const invoiceRepo: any = {
        findAll: mock(async () => options.existing ?? []),
        createBatch: mock(async (invoices: Invoice[]) => { created.push(...invoices); return invoices; }),
    };
    const unitRepo: any = { findByBuildingId: mock(async () => units) };
    const guard: any = { assertBillable: mock(async () => options.concept ?? extraordinary) };
    return { useCase: new BillConcept(invoiceRepo, unitRepo, guard), invoiceRepo, guard, created };
}

const existingInvoice = (status: InvoiceStatus) => new Invoice({
    id: 'i-old', unit_id: 'u1', amount: 1, period: '2026-10', issue_date: new Date(), status, type: InvoiceType.DEBT, concept_id: 'c-1',
});

describe('BillConcept', () => {
    it('creates one pending invoice per unit for the concept and period, using the concept goal', async () => {
        const { useCase, guard, created } = setup();

        const result = await useCase.execute({ buildingId: 'b-1', conceptId: 'c-1', period: '2026-10' });

        expect(guard.assertBillable).toHaveBeenCalledWith('c-1', 'b-1');
        expect(created.map(i => [i.unit_id, i.amount])).toEqual([['u1', 1860], ['u2', 1240]]);
        expect(created.every(i =>
            i.concept_id === 'c-1' && i.period === '2026-10' && i.status === InvoiceStatus.PENDING && i.description === 'Reparaciones y Pintura 2026-10'
        )).toBe(true);
        expect(result.total).toBe(3100);
        expect(result.invoices).toHaveLength(2);
    });

    it('uses the amount, description and due date sent by the caller', async () => {
        const { useCase, created } = setup({ concept: condominio });

        await useCase.execute({
            buildingId: 'b-1', conceptId: 'c-2', period: '2026-11', amount: 89.12, description: 'Condominio NOV - 2026', dueDate: new Date('2026-11-15'),
        });

        expect(created.map(i => i.amount)).toEqual([44.56, 44.56]);
        expect(created[0].description).toBe('Condominio NOV - 2026');
        expect(created[0].due_date?.toISOString().slice(0, 10)).toBe('2026-11-15');
    });

    it('requires an amount when the concept has no base amount', async () => {
        const { useCase, invoiceRepo } = setup({ concept: condominio });

        await expect(useCase.execute({ buildingId: 'b-1', conceptId: 'c-2', period: '2026-11' }))
            .rejects.toMatchObject({ status: 400, message: 'Amount is required: the concept has no base amount' });
        expect(invoiceRepo.createBatch).not.toHaveBeenCalled();
    });

    it('rejects a malformed period', async () => {
        const { useCase } = setup();
        await expect(useCase.execute({ buildingId: 'b-1', conceptId: 'c-1', period: '2026-13' }))
            .rejects.toMatchObject({ status: 400, message: 'Period must be YYYY-MM' });
    });

    it('refuses to bill a concept twice for the same period', async () => {
        const { useCase, invoiceRepo } = setup({ existing: [existingInvoice(InvoiceStatus.PENDING)] });

        await expect(useCase.execute({ buildingId: 'b-1', conceptId: 'c-1', period: '2026-10' }))
            .rejects.toMatchObject({ status: 409, message: 'Concept "Reparaciones y Pintura" was already billed for 2026-10 (1 invoices)' });
        expect(invoiceRepo.findAll).toHaveBeenCalledWith({ concept_id: 'c-1', period: '2026-10' });
        expect(invoiceRepo.createBatch).not.toHaveBeenCalled();
    });

    it('ignores cancelled invoices when checking for a previous billing', async () => {
        const { useCase, created } = setup({ existing: [existingInvoice(InvoiceStatus.CANCELLED)] });

        await useCase.execute({ buildingId: 'b-1', conceptId: 'c-1', period: '2026-10' });

        expect(created).toHaveLength(2);
    });

    it('creates nothing when the concept is rejected', async () => {
        const { useCase, guard, invoiceRepo } = setup();
        guard.assertBillable = mock(async () => { throw new Error('Charge concept not found in this building'); });

        await expect(useCase.execute({ buildingId: 'b-1', conceptId: 'c-9', period: '2026-10' })).rejects.toThrow('Charge concept not found in this building');
        expect(invoiceRepo.createBatch).not.toHaveBeenCalled();
    });
});
