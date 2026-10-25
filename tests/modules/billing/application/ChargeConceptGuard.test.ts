import { describe, expect, it, mock } from 'bun:test';
import { ChargeConceptGuard } from '@/modules/billing/application/services/ChargeConceptGuard';
import { ChargeConcept, ChargeConceptKind, ChargeConceptStatus } from '@/modules/billing/domain/entities/ChargeConcept';
import { Unit } from '@/modules/buildings/domain/entities/Unit';

const concept = (status = ChargeConceptStatus.ACTIVE) => new ChargeConcept({
    id: 'c-1', building_id: 'b-1', name: 'Condominio', kind: ChargeConceptKind.ORDINARY, status,
});

function setup(found: ChargeConcept | null = concept()) {
    const conceptRepo: any = { findById: mock(async () => found) };
    const unitRepo: any = {
        findById: mock(async (id: string) => (id === 'u-1' ? new Unit({ id: 'u-1', building_id: 'b-1', name: '1-1' }) : null)),
    };
    return { guard: new ChargeConceptGuard(conceptRepo, unitRepo), conceptRepo };
}

describe('ChargeConceptGuard', () => {
    it('returns an active concept of the building', async () => {
        const { guard } = setup();
        expect((await guard.assertBillable('c-1', 'b-1')).id).toBe('c-1');
    });

    it('rejects a missing concept or one of another building with the same error', async () => {
        await expect(setup(null).guard.assertBillable('c-x', 'b-1'))
            .rejects.toMatchObject({ status: 400, message: 'Charge concept not found in this building' });
        await expect(setup().guard.assertBillable('c-1', 'b-2'))
            .rejects.toMatchObject({ status: 400, message: 'Charge concept not found in this building' });
    });

    it('rejects a closed concept', async () => {
        await expect(setup(concept(ChargeConceptStatus.CLOSED)).guard.assertBillable('c-1', 'b-1'))
            .rejects.toMatchObject({ status: 400, message: 'Charge concept "Condominio" is closed' });
    });

    it('resolves the building from the unit', async () => {
        const { guard } = setup();
        expect((await guard.assertBillableForUnit('c-1', 'u-1')).id).toBe('c-1');
        await expect(guard.assertBillableForUnit('c-1', 'u-x')).rejects.toMatchObject({ status: 404, message: 'Unit not found' });
    });
});
