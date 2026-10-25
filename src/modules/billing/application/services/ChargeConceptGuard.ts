import { IChargeConceptRepository } from '../../domain/repository';
import { ChargeConcept } from '../../domain/entities/ChargeConcept';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { DomainError, NotFoundError } from '@/core/errors';

/** Checks that a charge concept can be used to bill invoices of a building. */
export class ChargeConceptGuard {
    constructor(
        private conceptRepo: Pick<IChargeConceptRepository, 'findById'>,
        private unitRepo: Pick<IUnitRepository, 'findById'>
    ) { }

    async assertBillable(conceptId: string, buildingId: string): Promise<ChargeConcept> {
        const concept = await this.conceptRepo.findById(conceptId);
        // A concept of another building is reported as missing, not forbidden.
        if (!concept || concept.building_id !== buildingId) {
            throw new DomainError('Charge concept not found in this building', 'VALIDATION_ERROR', 400);
        }
        if (!concept.isActive) {
            throw new DomainError(`Charge concept "${concept.name}" is closed`, 'VALIDATION_ERROR', 400);
        }
        return concept;
    }

    async assertBillableForUnit(conceptId: string, unitId: string): Promise<ChargeConcept> {
        const unit = await this.unitRepo.findById(unitId);
        if (!unit) {
            throw new NotFoundError('Unit not found');
        }
        return this.assertBillable(conceptId, unit.building_id);
    }
}
