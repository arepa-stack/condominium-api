import { describe, expect, it, mock } from 'bun:test';
import { GetBillingSummary } from '@/modules/billing/application/use-cases/GetBillingSummary';
import { ChargeConcept, ChargeConceptKind } from '@/modules/billing/domain/entities/ChargeConcept';

describe('GetBillingSummary', () => {
    it('summarizes the concepts and billing rows of the building', async () => {
        const concept = new ChargeConcept({ id: 'c-1', building_id: 'b-1', name: 'Condominio', kind: ChargeConceptKind.ORDINARY });
        const conceptRepo: any = { findByBuildingId: mock(async () => [concept]) };
        const invoiceRepo: any = {
            findBillingRowsByBuilding: mock(async () => [{ concept_id: 'c-1', period: '2026-10', amount: 44.56, paid_amount: 0, status: 'PENDING' }]),
        };

        const summary = await new GetBillingSummary(conceptRepo, invoiceRepo).execute('b-1');

        expect(conceptRepo.findByBuildingId).toHaveBeenCalledWith('b-1');
        expect(invoiceRepo.findBillingRowsByBuilding).toHaveBeenCalledWith('b-1');
        expect(summary.groups).toHaveLength(1);
        expect(summary.groups[0]).toMatchObject({ name: 'Condominio', period: '2026-10', billed: 44.56 });
    });
});
