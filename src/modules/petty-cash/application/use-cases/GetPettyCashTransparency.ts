import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { Invoice, InvoiceStatus } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

// CANCELLED is intentionally excluded from the transparency view — a
// cancelled quota is not part of the fund being collected.
export type TransparencyUnitStatus =
    | InvoiceStatus.PENDING
    | InvoiceStatus.PARTIAL
    | InvoiceStatus.PAID;

export interface TransparencyUnitDTO {
    unit_id: string;
    unit_name: string;
    expected_amount: number;   // cuota asignada
    covered_amount: number;    // min(paid, expected_amount)
    status: TransparencyUnitStatus;
}

export interface PettyCashTransparencyDTO {
    building_id: string;
    period: string;
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

    async execute(buildingId: string, period: string): Promise<PettyCashTransparencyDTO> {
        if (!period?.trim()) {
            throw new DomainError(
                'period is required — transparency must scope to a specific period',
                'VALIDATION_ERROR',
                400
            );
        }

        const [buildingUnits, invoices] = await Promise.all([
            this.unitRepo.findByBuildingId(buildingId),
            this.invoiceRepo.findAll({
                building_id: buildingId,
                tag: InvoiceTag.PETTY_CASH,
                period
            })
        ]);

        // Aggregate active invoices by unit_id. A single unit may have
        // multiple PETTY_CASH invoices in the same period when the
        // overage grows in stages (see GenerateAssessments) — each
        // invoice represents an incremental assessment tranche.
        // CANCELLED invoices are excluded — a cancelled quota is not
        // part of the collection target.
        const byUnit = new Map<string, Invoice[]>();
        for (const inv of invoices) {
            if (inv.status === InvoiceStatus.CANCELLED) continue;
            if (!inv.unit_id) continue;
            const bucket = byUnit.get(inv.unit_id);
            if (bucket) bucket.push(inv);
            else byUnit.set(inv.unit_id, [inv]);
        }

        const unitsTransparency: TransparencyUnitDTO[] = [];
        let totalToCollect = 0;
        let totalCollected = 0;

        for (const unit of buildingUnits) {
            const unitInvoices = byUnit.get(unit.id);

            if (unitInvoices && unitInvoices.length > 0) {
                let expectedAmount = 0;
                let coveredAmount = 0;
                for (const inv of unitInvoices) {
                    expectedAmount += inv.amount;
                    // RN1 & RN5: cap contribution per-invoice. Overpayments
                    // flow to the credit ledger, not into the collection %.
                    coveredAmount += Math.min(inv.paid_amount, inv.amount);
                }

                totalToCollect += expectedAmount;
                totalCollected += coveredAmount;

                // Derive combined status: PAID only if every tranche is
                // fully covered; PENDING only if nothing has been paid;
                // PARTIAL otherwise.
                let status: TransparencyUnitStatus;
                if (coveredAmount >= expectedAmount) {
                    status = InvoiceStatus.PAID;
                } else if (coveredAmount <= 0) {
                    status = InvoiceStatus.PENDING;
                } else {
                    status = InvoiceStatus.PARTIAL;
                }

                unitsTransparency.push({
                    unit_id: unit.id,
                    unit_name: unit.name,
                    expected_amount: expectedAmount,
                    covered_amount: coveredAmount,
                    status
                });
            } else {
                unitsTransparency.push({
                    unit_id: unit.id,
                    unit_name: unit.name,
                    expected_amount: 0,
                    covered_amount: 0,
                    status: InvoiceStatus.PENDING
                });
            }
        }

        const collectionPercentage = totalToCollect > 0
            ? Math.round((totalCollected / totalToCollect) * 10000) / 100
            : 0;

        return {
            building_id: buildingId,
            period,
            total_to_collect: totalToCollect,
            total_collected: totalCollected,
            collection_percentage: collectionPercentage,
            units: unitsTransparency
        };
    }
}
