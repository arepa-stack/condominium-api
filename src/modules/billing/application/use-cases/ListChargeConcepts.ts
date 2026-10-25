import { ChargeConceptFilters, IChargeConceptRepository } from '../../domain/repository';
import { ChargeConcept } from '../../domain/entities/ChargeConcept';

export class ListChargeConcepts {
    constructor(private conceptRepo: IChargeConceptRepository) { }

    async execute(buildingId: string, filters: ChargeConceptFilters = {}): Promise<ChargeConcept[]> {
        return await this.conceptRepo.findByBuildingId(buildingId, filters);
    }
}
