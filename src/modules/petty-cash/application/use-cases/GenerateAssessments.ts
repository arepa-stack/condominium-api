import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { PettyCashAssessment } from '../../domain/entities/PettyCashAssessment';
import { InvoiceTag, PettyCashCategory, PettyCashEntryType } from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

export interface GenerateAssessmentDTO {
    buildingId: string;
    description: string;
    category?: PettyCashCategory;
    amount: number;                           // total to prorate across units
    userId: string;
    unitIds?: string[];
    /** Assessment kind. Defaults to GENERAL. CONTRIBUTION is not allowed here. */
    kind?: 'GENERAL' | 'EXPRESS';
    /**
     * For EXPRESS assessments, the petty_cash_entries.id of the
     * expense entry that originated this assessment. Required when kind=EXPRESS.
     */
    source_entry_id?: string;
    /**
     * Per-unit amount override. When present (EXPRESS only), keys
     * must exactly match unitIds, all values > 0, and the sum in cents must
     * equal toCents(amount). Absent → fair-cent equal split.
     */
    unit_amounts?: Record<string, number>;
}

export interface GenerateAssessmentsResult {
    building_id: string;
    assessment_id: string;
    description: string;
    total_assessed: number;
    invoices_created: number;
    /** Assessment kind persisted. CONTRIBUTION is never returned here. */
    kind: 'GENERAL' | 'EXPRESS';
    /** Source entry id for EXPRESS assessments, null otherwise. */
    source_entry_id: string | null;
    invoices: {
        unit_id: string;
        unit_name: string;
        amount: number;
        invoice_id: string;
    }[];
}

const toCents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

/**
 * Create a named assessment BATCH and one PENDING invoice per unit
 * linking back to the batch.
 *
 * Supports two kinds:
 *   - `kind`: GENERAL (default) or EXPRESS.
 *   - `source_entry_id`: required for EXPRESS, forbidden for GENERAL.
 *   - `unit_amounts`: per-unit override (EXPRESS only). Absent → fair-cent split.
 *
 * EXPRESS validation:
 *   - source_entry_id must resolve to an existing EXPENSE entry belonging
 *     to THIS fund.
 *   - At least one unitId must be selected.
 *
 * GENERAL validation:
 *   - source_entry_id is forbidden.
 *   - unit_amounts is forbidden.
 *
 * unit_amounts validation (when present, EXPRESS only):
 *   - Keys must be the same set as unitIds (no extras, no missing).
 *   - Each value must be > 0.
 *   - toCents(Σ values) === toCents(amount).
 */
export class GenerateAssessments {
    constructor(
        private invoiceRepo: IInvoiceRepository,
        private unitRepo: IUnitRepository,
        private pettyCashRepo: PettyCashRepository
    ) {}

    async execute(dto: GenerateAssessmentDTO): Promise<GenerateAssessmentsResult> {
        const {
            buildingId,
            description,
            category,
            amount,
            userId,
            unitIds,
            kind = 'GENERAL',
            source_entry_id,
            unit_amounts,
        } = dto;

        if (!description?.trim()) {
            throw new DomainError(
                'Assessment description is required',
                'VALIDATION_ERROR',
                400
            );
        }
        if (!(amount > 0)) {
            throw new DomainError(
                'Assessment amount must be greater than zero',
                'VALIDATION_ERROR',
                400
            );
        }

        // ── Kind-level cross-field validation ────────────────────────────────

        // CONTRIBUTION assessments are created exclusively through the direct
        // contribution endpoint and must never reach this code path.
        if ((kind as string) === 'CONTRIBUTION') {
            throw new DomainError(
                'CONTRIBUTION assessments cannot be created via the assessments endpoint. Use POST /funds/:buildingId/contributions instead.',
                'INVALID_ASSESSMENT_KIND',
                400
            );
        }

        if (kind === 'GENERAL') {
            if (source_entry_id) {
                throw new DomainError(
                    'source_entry_id is not allowed for GENERAL assessments',
                    'INVALID_SOURCE_ENTRY',
                    400
                );
            }
            if (unit_amounts) {
                throw new DomainError(
                    'unit_amounts is only allowed for EXPRESS assessments',
                    'UNIT_AMOUNTS_MISMATCH',
                    400
                );
            }
        }

        if (kind === 'EXPRESS' && !source_entry_id) {
            throw new DomainError(
                'source_entry_id is required for EXPRESS assessments',
                'INVALID_SOURCE_ENTRY',
                400
            );
        }

        if (kind === 'EXPRESS' && !unitIds?.length) {
            throw new DomainError(
                'Express assessments require at least one unit ID (unitIds must be non-empty)',
                'EXPRESS_REQUIRES_UNITS',
                400
            );
        }

        // ── Fund resolution (cold-start safe) ────────────────────────────────
        const fund = await this.pettyCashRepo.findOrCreateFund(buildingId);

        // ── EXPRESS source entry validation ──────────────────────────────────
        let resolvedSourceEntryId: string | null = null;
        if (kind === 'EXPRESS') {
            const sourceEntry = await this.pettyCashRepo.findEntryById(source_entry_id!);
            if (
                !sourceEntry ||
                sourceEntry.type !== PettyCashEntryType.EXPENSE ||
                sourceEntry.fund_id !== fund.id
            ) {
                throw new DomainError(
                    'source_entry_id must reference an existing EXPENSE entry belonging to this fund',
                    'INVALID_SOURCE_ENTRY',
                    400
                );
            }
            resolvedSourceEntryId = source_entry_id!;
        }

        // ── Unit resolution ───────────────────────────────────────────────────
        const units = await this.unitRepo.findByBuildingId(buildingId);
        if (units.length === 0) {
            throw new DomainError(
                'No units found in this building.',
                'NO_UNITS',
                400
            );
        }

        let targetUnits = units;
        if (unitIds !== undefined) {
            if (unitIds.length === 0) {
                throw new DomainError(
                    'Select at least one unit to generate the assessment.',
                    'NO_UNITS_SELECTED',
                    400
                );
            }

            const selectedUnitIds = new Set(unitIds);
            const availableUnitIds = new Set(units.map((unit) => unit.id));
            const selectionHasDuplicates = selectedUnitIds.size !== unitIds.length;
            const selectionHasUnknownUnits = unitIds.some(
                (unitId) => !availableUnitIds.has(unitId)
            );

            if (selectionHasDuplicates || selectionHasUnknownUnits) {
                throw new DomainError(
                    'The unit selection contains duplicate or unknown unit IDs.',
                    'INVALID_UNIT_SELECTION',
                    400
                );
            }

            targetUnits = units.filter((unit) => selectedUnitIds.has(unit.id));
        }

        const amountCents = toCents(amount);

        // ── unit_amounts validation and resolution ────────────────────────────
        let unitCents: number[];

        if (unit_amounts) {
            const targetUnitIds = new Set(targetUnits.map(u => u.id));
            const overrideKeys = Object.keys(unit_amounts);

            // Keys must exactly match target units
            const overrideSet = new Set(overrideKeys);
            const keysMatch =
                overrideSet.size === targetUnitIds.size &&
                overrideKeys.every(k => targetUnitIds.has(k));

            if (!keysMatch) {
                throw new DomainError(
                    'unit_amounts keys must exactly match the selected unit IDs',
                    'UNIT_AMOUNTS_MISMATCH',
                    400
                );
            }

            // All values must be > 0
            const hasInvalidValue = overrideKeys.some(k => !(unit_amounts[k] > 0));
            if (hasInvalidValue) {
                throw new DomainError(
                    'All unit_amounts values must be greater than zero',
                    'UNIT_AMOUNTS_MISMATCH',
                    400
                );
            }

            // Sum in cents must equal amountCents
            const sumCents = overrideKeys.reduce((s, k) => s + toCents(unit_amounts[k]), 0);
            if (sumCents !== amountCents) {
                throw new DomainError(
                    `unit_amounts sum (${fromCents(sumCents)}) must equal amount (${amount})`,
                    'UNIT_AMOUNTS_MISMATCH',
                    400
                );
            }

            // Map to target unit order
            unitCents = targetUnits.map(u => toCents(unit_amounts[u.id]));
        } else {
            // Fair-to-the-cent distribution (existing behaviour).
            if (amountCents < targetUnits.length) {
                throw new DomainError(
                    `Amount (${amount}) is too small to distribute across ${targetUnits.length} units. Needs at least 1 cent per unit.`,
                    'AMOUNT_TOO_SMALL_TO_DISTRIBUTE',
                    400
                );
            }
            const base = Math.floor(amountCents / targetUnits.length);
            const remainder = amountCents - base * targetUnits.length;
            unitCents = targetUnits.map((_, i) => base + (i < remainder ? 1 : 0));
        }

        const period = new Date().toISOString().substring(0, 7);

        // 1. Create the batch (atomic row).
        const assessment = await this.pettyCashRepo.createAssessment(
            new PettyCashAssessment({
                fund_id: fund.id,
                period,
                description,
                category: category ?? null,
                total_amount: amount,
                created_by: userId,
                kind,
                source_entry_id: resolvedSourceEntryId,
            })
        );

        // 2. One invoice per unit, linked to the batch via assessment_id.
        const invoices: Invoice[] = targetUnits.map((unit, i) => new Invoice({
            id: crypto.randomUUID(),
            unit_id: unit.id,
            building_id: buildingId,
            amount: fromCents(unitCents[i]),
            period,
            issue_date: new Date(),
            status: InvoiceStatus.PENDING,
            type: InvoiceType.EXPENSE,
            tag: InvoiceTag.PETTY_CASH,
            description,
            assessment_id: assessment.id,
        }));

        const created = await this.invoiceRepo.createBatch(invoices);

        return {
            building_id: buildingId,
            assessment_id: assessment.id!,
            description: assessment.description,
            total_assessed: amount,
            invoices_created: created.length,
            kind: assessment.kind,
            source_entry_id: assessment.source_entry_id,
            invoices: created.map((inv, i) => ({
                unit_id: targetUnits[i].id,
                unit_name: targetUnits[i].name,
                amount: inv.amount,
                invoice_id: inv.id,
            })),
        };
    }
}
