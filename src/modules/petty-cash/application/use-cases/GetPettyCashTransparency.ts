import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { Invoice, InvoiceStatus } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

export type TransparencyUnitStatus =
    | InvoiceStatus.PENDING
    | InvoiceStatus.PARTIAL
    | InvoiceStatus.PAID;

export interface TransparencyUnitDTO {
    unit_id: string;
    unit_name: string;
    expected_amount: number;
    covered_amount: number;
    status: TransparencyUnitStatus;
}

export interface AssessmentTransparencyDTO {
    id: string;
    description: string;
    category: string | null;
    total_to_collect: number;
    total_collected: number;
    collection_percentage: number;
    units: TransparencyUnitDTO[];
    /**
     * Assessment kind. Present when there is a linked assessment row.
     * Absent for legacy/orphan batches that predate the assessment table.
     */
    kind?: 'GENERAL' | 'EXPRESS' | 'CONTRIBUTION';
    /**
     * For EXPRESS assessments, the petty_cash_entries.id of the
     * expense that triggered this assessment. NULL for GENERAL. Absent for legacy.
     */
    source_entry_id?: string | null;
}

export interface PettyCashTransparencyDTO {
    building_id: string;
    period: string;
    // Per-batch breakdown. Multiple assessments per period are the
    // whole point — ascensor + agua in 2026-04 show up as separate
    // entries each with its own progress bar.
    assessments: AssessmentTransparencyDTO[];
    // Aggregate totals across all batches for the period, so clients
    // can show a single "overall" number without having to re-sum.
    total_to_collect: number;
    total_collected: number;
    collection_percentage: number;
}

/**
 * Per-assessment transparency. Invoices are grouped by assessment_id;
 * each batch reports its own progress. Orphan PETTY_CASH invoices
 * (no assessment_id — legacy data or invoices emitted before Phase 2)
 * are lumped under a synthetic "Sin categorizar" batch for back-compat.
 *
 * Notes:
 *  - CANCELLED invoices are excluded from both expected and covered.
 *  - covered_amount is capped per-invoice at expected_amount —
 *    overpayments flow to the credit ledger, not into the collection %.
 */
export class GetPettyCashTransparency {
    constructor(
        private invoiceRepo: IInvoiceRepository,
        private unitRepo: IUnitRepository,
        private pettyCashRepo: PettyCashRepository
    ) { }

    async execute(buildingId: string, period: string): Promise<PettyCashTransparencyDTO> {
        if (!period?.trim()) {
            throw new DomainError(
                'period is required — transparency must scope to a specific period',
                'VALIDATION_ERROR',
                400
            );
        }

        const [buildingUnits, invoices, fund] = await Promise.all([
            this.unitRepo.findByBuildingId(buildingId),
            this.invoiceRepo.findAll({
                building_id: buildingId,
                tag: InvoiceTag.PETTY_CASH,
                period,
            }),
            this.pettyCashRepo.findFundByBuildingId(buildingId),
        ]);

        // Load assessment metadata if there is a fund for this building.
        const assessments = fund
            ? await this.pettyCashRepo.findAssessmentsByPeriod(fund.id, period)
            : [];
        const assessmentById = new Map(assessments.map(a => [a.id!, a]));

        // Group active unit-level invoices by assessment_id. Orphan
        // invoices (assessment_id NULL) land in a special 'legacy' key.
        const LEGACY_KEY = '__legacy__';
        const byAssessment = new Map<string, Invoice[]>();
        for (const inv of invoices) {
            if (inv.status === InvoiceStatus.CANCELLED) continue;
            if (!inv.unit_id) continue;

            const key = inv.assessment_id ?? LEGACY_KEY;
            const bucket = byAssessment.get(key);
            if (bucket) bucket.push(inv);
            else byAssessment.set(key, [inv]);
        }

        // Stable synthetic key for the merged CONTRIBUTION bucket.
        const CONTRIBUTION_KEY = 'direct-contributions';

        // All CONTRIBUTION assessment ids for this period. Their invoices
        // will be merged into one synthetic bucket instead of appearing
        // as separate rows — direct contributions are displayed together.
        const contributionAssessmentIds = new Set(
            assessments.filter(a => a.kind === 'CONTRIBUTION').map(a => a.id!)
        );

        const assessmentDTOs: AssessmentTransparencyDTO[] = [];
        let grandTotalExpected = 0;
        let grandTotalCovered = 0;

        // Preserve display order: use the assessments[] order from the
        // repo (newest first), then append legacy at the end.
        // CONTRIBUTION assessments all map to the same synthetic key.
        const seenKeys = new Set<string>();
        const orderedKeys: string[] = [];
        for (const a of assessments) {
            const key = contributionAssessmentIds.has(a.id!) ? CONTRIBUTION_KEY : a.id!;
            if (seenKeys.has(key)) continue;
            if (!byAssessment.has(a.id!) && key !== CONTRIBUTION_KEY) continue;
            // For CONTRIBUTION, check if any contribution assessment has invoices
            if (key === CONTRIBUTION_KEY) {
                const hasInvoices = [...contributionAssessmentIds].some(id => byAssessment.has(id));
                if (!hasInvoices) continue;
            }
            seenKeys.add(key);
            orderedKeys.push(key);
        }
        if (byAssessment.has(LEGACY_KEY)) orderedKeys.push(LEGACY_KEY);

        for (const key of orderedKeys) {
            // Collect all invoices for this key.
            // CONTRIBUTION_KEY aggregates across all contribution assessment ids.
            let bucketInvoices: Invoice[];
            if (key === CONTRIBUTION_KEY) {
                bucketInvoices = [];
                for (const contribId of contributionAssessmentIds) {
                    const invs = byAssessment.get(contribId);
                    if (invs) bucketInvoices.push(...invs);
                }
            } else {
                bucketInvoices = byAssessment.get(key)!;
            }

            const batch = key === LEGACY_KEY || key === CONTRIBUTION_KEY
                ? null
                : assessmentById.get(key);

            const byUnitId = new Map<string, Invoice[]>();
            for (const inv of bucketInvoices) {
                const arr = byUnitId.get(inv.unit_id!) ?? [];
                arr.push(inv);
                byUnitId.set(inv.unit_id!, arr);
            }

            let batchExpected = 0;
            let batchCovered = 0;
            const unitsDTO: TransparencyUnitDTO[] = [];

            for (const unit of buildingUnits) {
                const unitInvoices = byUnitId.get(unit.id);
                if (!unitInvoices || unitInvoices.length === 0) continue;

                let expected = 0;
                let covered = 0;
                for (const inv of unitInvoices) {
                    expected += inv.amount;
                    covered += Math.min(inv.paid_amount, inv.amount);
                }

                let status: TransparencyUnitStatus;
                if (covered >= expected) status = InvoiceStatus.PAID;
                else if (covered <= 0) status = InvoiceStatus.PENDING;
                else status = InvoiceStatus.PARTIAL;

                unitsDTO.push({
                    unit_id: unit.id,
                    unit_name: unit.name,
                    expected_amount: expected,
                    covered_amount: covered,
                    status,
                });

                batchExpected += expected;
                batchCovered += covered;
            }

            const percentage = batchExpected > 0
                ? Math.round((batchCovered / batchExpected) * 10000) / 100
                : 0;

            let batchDTO: AssessmentTransparencyDTO;
            if (key === CONTRIBUTION_KEY) {
                batchDTO = {
                    id: CONTRIBUTION_KEY,
                    description: 'Aportes directos',
                    category: null,
                    total_to_collect: batchExpected,
                    total_collected: batchCovered,
                    collection_percentage: percentage,
                    units: unitsDTO,
                    kind: 'CONTRIBUTION',
                };
            } else {
                batchDTO = {
                    id: batch?.id ?? LEGACY_KEY,
                    description: batch?.description ?? 'Sin categorizar (legacy)',
                    category: batch?.category ?? null,
                    total_to_collect: batchExpected,
                    total_collected: batchCovered,
                    collection_percentage: percentage,
                    units: unitsDTO,
                };
                // Expose kind and source_entry_id only when a real assessment row exists.
                // Legacy/orphan batches have no assessment row → fields are absent.
                if (batch) {
                    batchDTO.kind = batch.kind;
                    batchDTO.source_entry_id = batch.source_entry_id;
                }
            }

            assessmentDTOs.push(batchDTO);

            grandTotalExpected += batchExpected;
            grandTotalCovered += batchCovered;
        }

        const globalPct = grandTotalExpected > 0
            ? Math.round((grandTotalCovered / grandTotalExpected) * 10000) / 100
            : 0;

        return {
            building_id: buildingId,
            period,
            assessments: assessmentDTOs,
            total_to_collect: grandTotalExpected,
            total_collected: grandTotalCovered,
            collection_percentage: globalPct,
        };
    }
}
