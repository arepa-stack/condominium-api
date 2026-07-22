import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { PettyCashAssessment } from '../../domain/entities/PettyCashAssessment';
import { InvoiceTag, PettyCashCategory } from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

export interface GenerateAssessmentDTO {
    buildingId: string;
    description: string;
    category?: PettyCashCategory;
    amount: number;                 // total to prorate across units
    userId: string;
    unitIds?: string[];
}

export interface GenerateAssessmentsResult {
    building_id: string;
    assessment_id: string;
    description: string;
    total_assessed: number;
    invoices_created: number;
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
 * Breaking change vs. Phase 1:
 *   - The admin now provides `description` (e.g. "Ascensor abril") and
 *     optional `category`. These are stored on the batch and copied
 *     into each invoice's description for clarity.
 *   - The admin provides `amount` — the total to prorate. It can be
 *     smaller than `pending_to_assess` (partial assessment) but not
 *     larger (the system never asks units for more than is owed).
 */
export class GenerateAssessments {
    constructor(
        private invoiceRepo: IInvoiceRepository,
        private unitRepo: IUnitRepository,
        private pettyCashRepo: PettyCashRepository
    ) {}

    async execute(dto: GenerateAssessmentDTO): Promise<GenerateAssessmentsResult> {
        const { buildingId, description, category, amount, userId, unitIds } = dto;

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
        if (amountCents < targetUnits.length) {
            throw new DomainError(
                `Amount (${amount}) is too small to distribute across ${targetUnits.length} units. Needs at least 1 cent per unit.`,
                'AMOUNT_TOO_SMALL_TO_DISTRIBUTE',
                400
            );
        }

        // Fair-to-the-cent distribution.
        const base = Math.floor(amountCents / targetUnits.length);
        const remainder = amountCents - base * targetUnits.length;
        const unitCents = targetUnits.map((_, i) => base + (i < remainder ? 1 : 0));

        const period = new Date().toISOString().substring(0, 7);
        const fund = await this.pettyCashRepo.findOrCreateFund(buildingId);

        // 1. Create the batch (atomic row).
        const assessment = await this.pettyCashRepo.createAssessment(
            new PettyCashAssessment({
                fund_id: fund.id,
                period,
                description,
                category: category ?? null,
                total_amount: amount,
                created_by: userId,
            })
        );

        // 2. One invoice per unit, linked to the batch via
        //    assessment_id. Description copies the batch name so it
        //    appears verbatim on each resident's billing.
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
            invoices: created.map((inv, i) => ({
                unit_id: targetUnits[i].id,
                unit_name: targetUnits[i].name,
                amount: inv.amount,
                invoice_id: inv.id,
            })),
        };
    }
}
