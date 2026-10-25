import { IInvoiceRepository } from '../../domain/repository';
import { Invoice, InvoiceStatus, InvoiceType } from '../../domain/entities/Invoice';
import { distributeCharge } from '../../domain/services/ChargeDistribution';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { DomainError } from '@/core/errors';
import type { ChargeConceptGuard } from '../services/ChargeConceptGuard';

export interface BillConceptDTO {
    buildingId: string;
    conceptId: string;
    period: string;
    /** Total to split (ALIQUOT/EQUAL) or per-unit amount (FIXED). Defaults to the concept base amount. */
    amount?: number;
    description?: string;
    dueDate?: Date;
}

export interface BillConceptResult {
    invoices: Invoice[];
    total: number;
}

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Generates the invoices of a charge concept for every unit of the building. */
export class BillConcept {
    constructor(
        private invoiceRepo: Pick<IInvoiceRepository, 'findAll' | 'createBatch'>,
        private unitRepo: Pick<IUnitRepository, 'findByBuildingId'>,
        private conceptGuard: Pick<ChargeConceptGuard, 'assertBillable'>
    ) { }

    async execute(dto: BillConceptDTO): Promise<BillConceptResult> {
        if (!PERIOD_PATTERN.test(dto.period)) {
            throw new DomainError('Period must be YYYY-MM', 'VALIDATION_ERROR', 400);
        }

        const concept = await this.conceptGuard.assertBillable(dto.conceptId, dto.buildingId);

        const amount = dto.amount ?? concept.base_amount;
        if (amount === null || amount === undefined) {
            throw new DomainError('Amount is required: the concept has no base amount', 'VALIDATION_ERROR', 400);
        }

        const previous = (await this.invoiceRepo.findAll({ concept_id: concept.id, period: dto.period }))
            .filter(inv => inv.status !== InvoiceStatus.CANCELLED);
        if (previous.length > 0) {
            throw new DomainError(
                `Concept "${concept.name}" was already billed for ${dto.period} (${previous.length} invoices)`,
                'CONFLICT',
                409
            );
        }

        const units = await this.unitRepo.findByBuildingId(dto.buildingId);
        const shares = distributeCharge(concept.distribution, amount, units);

        const issueDate = new Date();
        const invoices = shares.map(share => new Invoice({
            id: crypto.randomUUID(),
            unit_id: share.unit_id,
            amount: share.amount,
            paid_amount: 0,
            period: dto.period,
            issue_date: issueDate,
            due_date: dto.dueDate,
            status: InvoiceStatus.PENDING,
            type: InvoiceType.DEBT,
            description: dto.description?.trim() || `${concept.name} ${dto.period}`,
            concept_id: concept.id,
        }));

        const created = await this.invoiceRepo.createBatch(invoices);
        const totalCents = created.reduce((sum, inv) => sum + Math.round(inv.amount * 100), 0);
        return { invoices: created, total: totalCents / 100 };
    }
}
