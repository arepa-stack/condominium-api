import { IChargeConceptRepository, IConceptDecisionLookup } from '../../domain/repository';
import { ChargeConcept, ChargeConceptUpdate } from '../../domain/entities/ChargeConcept';
import { NotFoundError } from '@/core/errors';
import { assertDecisionInBuilding } from './CreateChargeConcept';

export class UpdateChargeConcept {
    constructor(
        private conceptRepo: IChargeConceptRepository,
        private decisions: IConceptDecisionLookup
    ) { }

    async execute(buildingId: string, conceptId: string, changes: ChargeConceptUpdate): Promise<ChargeConcept> {
        const concept = await this.conceptRepo.findById(conceptId);
        // A concept of another building is reported as missing, not forbidden.
        if (!concept || concept.building_id !== buildingId) {
            throw new NotFoundError('Charge concept not found');
        }
        await assertDecisionInBuilding(this.decisions, changes.decision_id, buildingId);

        concept.update(changes);
        return await this.conceptRepo.update(concept);
    }
}
