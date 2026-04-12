import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { InvoiceTag } from '@/core/domain/enums';

export interface TransparencyUnitDTO {
    unit_id: string;
    unit_name: string;
    expected_amount: number;   // cuota asignada
    covered_amount: number;    // min(paid, expected_amount)
    status: 'PAID' | 'PARTIAL' | 'PENDING';
}

export interface PettyCashTransparencyDTO {
    building_id: string;
    total_to_collect: number;          // suma de cuotas
    total_collected: number;           // suma de covered_amounts
    collection_percentage: number;     // (collected / to_collect) * 100
    units: TransparencyUnitDTO[];
}

export class GetPettyCashTransparency {
    constructor(
        private invoiceRepo: IInvoiceRepository,
        private unitRepo: IUnitRepository
    ) { }

    async execute(buildingId: string): Promise<PettyCashTransparencyDTO> {
        // 1. Get all units to ensure we show all of them even if they don't have invoices yet
        const buildingUnits = await this.unitRepo.findByBuildingId(buildingId);
        
        // 2. Get all petty cash invoices for this building
        const invoices = await this.invoiceRepo.findAll({
            building_id: buildingId,
            tag: InvoiceTag.PETTY_CASH
        });

        const unitsTransparency: TransparencyUnitDTO[] = [];
        let totalToCollect = 0;
        let totalCollected = 0;

        for (const unit of buildingUnits) {
            const unitInvoice = invoices.find(inv => inv.unit_id === unit.id);
            
            if (unitInvoice) {
                const expectedAmount = unitInvoice.amount;
                // RN1 & RN5: contribution capped at quota
                const coveredAmount = Math.min(unitInvoice.paid_amount, expectedAmount);
                
                totalToCollect += expectedAmount;
                totalCollected += coveredAmount;

                unitsTransparency.push({
                    unit_id: unit.id,
                    unit_name: unit.name,
                    expected_amount: expectedAmount,
                    covered_amount: coveredAmount,
                    status: unitInvoice.status as any
                });
            } else {
                // Unit has no assessment yet
                unitsTransparency.push({
                    unit_id: unit.id,
                    unit_name: unit.name,
                    expected_amount: 0,
                    covered_amount: 0,
                    status: 'PENDING'
                });
            }
        }

        const collectionPercentage = totalToCollect > 0 
            ? Math.round((totalCollected / totalToCollect) * 100 * 100) / 100 
            : 0;

        return {
            building_id: buildingId,
            total_to_collect: totalToCollect,
            total_collected: totalCollected,
            collection_percentage: collectionPercentage,
            units: unitsTransparency
        };
    }
}
