import { IChargeConceptRepository, IInvoiceRepository } from '../../domain/repository';
import { BillingSummary, summarizeBilling } from '../../domain/services/BillingSummary';

/** Billed and collected totals of a building grouped by charge concept. */
export class GetBillingSummary {
    constructor(
        private conceptRepo: Pick<IChargeConceptRepository, 'findByBuildingId'>,
        private invoiceRepo: Pick<IInvoiceRepository, 'findBillingRowsByBuilding'>
    ) { }

    async execute(buildingId: string): Promise<BillingSummary> {
        const [concepts, rows] = await Promise.all([
            this.conceptRepo.findByBuildingId(buildingId),
            this.invoiceRepo.findBillingRowsByBuilding(buildingId),
        ]);
        return summarizeBilling(concepts, rows);
    }
}
