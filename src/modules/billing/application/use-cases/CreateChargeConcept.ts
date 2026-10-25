import { IChargeConceptRepository, IConceptDecisionLookup } from '../../domain/repository';
import { ChargeConcept, ChargeConceptKind, ChargeDistribution } from '../../domain/entities/ChargeConcept';
import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import { DomainError, NotFoundError } from '@/core/errors';

export interface CreateChargeConceptDTO {
    building_id: string;
    name: string;
    kind: ChargeConceptKind;
    base_amount?: number | null;
    distribution?: ChargeDistribution;
    decision_id?: string | null;
}

export async function assertDecisionInBuilding(
    decisions: IConceptDecisionLookup,
    decisionId: string | null | undefined,
    buildingId: string
): Promise<void> {
    if (!decisionId) return;
    const decision = await decisions.findById(decisionId);
    if (!decision || decision.building_id !== buildingId) {
        throw new DomainError('Decision does not belong to this building', 'VALIDATION_ERROR', 400);
    }
}

export class CreateChargeConcept {
    constructor(
        private conceptRepo: IChargeConceptRepository,
        private buildingRepo: Pick<IBuildingRepository, 'findById'>,
        private decisions: IConceptDecisionLookup
    ) { }

    async execute(data: CreateChargeConceptDTO): Promise<ChargeConcept> {
        const building = await this.buildingRepo.findById(data.building_id);
        if (!building) {
            throw new NotFoundError('Building not found');
        }
        await assertDecisionInBuilding(this.decisions, data.decision_id, data.building_id);

        const concept = new ChargeConcept({
            id: crypto.randomUUID(),
            building_id: data.building_id,
            name: data.name,
            kind: data.kind,
            base_amount: data.base_amount,
            distribution: data.distribution,
            decision_id: data.decision_id,
        });

        return await this.conceptRepo.create(concept);
    }
}
