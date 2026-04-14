import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';
import { DomainError } from '@/core/errors';
import { PreviewAssessments } from './PreviewAssessments';

export interface GenerateAssessmentsResult {
    building_id: string;
    total_assessed: number;
    invoices_created: number;
    invoices: { unit_id: string; unit_name: string; amount: number; invoice_id: string }[];
}

export class GenerateAssessments {
    private previewUseCase: PreviewAssessments;

    constructor(
        private invoiceRepo: IInvoiceRepository,
        private unitRepo: IUnitRepository,
        private pettyCashRepo: PettyCashRepository
    ) {
        this.previewUseCase = new PreviewAssessments(invoiceRepo, unitRepo, pettyCashRepo);
    }

    async execute(buildingId: string): Promise<GenerateAssessmentsResult> {
        const preview = await this.previewUseCase.execute(buildingId);

        if (preview.pending_to_assess <= 0) {
            throw new DomainError(
                'No pending overage to assess. Fund balance is sufficient or overage has already been assessed.',
                'NO_PENDING_OVERAGE',
                400
            );
        }

        if (preview.units.length === 0) {
            throw new DomainError(
                'No units found in this building.',
                'NO_UNITS',
                400
            );
        }

        // Need at least 1 cent per unit, otherwise the distribution is
        // meaningless: we'd either emit zero-amount invoices or
        // concentrate the residue on a single unit.
        const pendingCents = Math.round(preview.pending_to_assess * 100);
        if (pendingCents < preview.units.length) {
            throw new DomainError(
                `Pending amount (${preview.pending_to_assess}) is too small to distribute across ${preview.units.length} units. Needs at least 1 cent per unit.`,
                'AMOUNT_TOO_SMALL_TO_DISTRIBUTE',
                400
            );
        }

        const period = new Date().toISOString().substring(0, 7);
        const invoicedUnits: { unit: typeof preview.units[number]; invoice: Invoice }[] = [];

        for (const unit of preview.units) {
            if (unit.amount <= 0) continue;

            const invoice = new Invoice({
                id: crypto.randomUUID(),
                unit_id: unit.id,
                building_id: buildingId,
                amount: unit.amount,
                period,
                issue_date: new Date(),
                status: InvoiceStatus.PENDING,
                type: InvoiceType.EXPENSE,
                tag: InvoiceTag.PETTY_CASH,
                description: `Cuota reposición caja chica - ${period}`
            });

            invoicedUnits.push({ unit, invoice });
        }

        const created = await this.invoiceRepo.createBatch(
            invoicedUnits.map(x => x.invoice)
        );

        return {
            building_id: buildingId,
            total_assessed: preview.pending_to_assess,
            invoices_created: created.length,
            invoices: created.map((inv, i) => ({
                unit_id: invoicedUnits[i].unit.id,
                unit_name: invoicedUnits[i].unit.name,
                amount: inv.amount,
                invoice_id: inv.id
            }))
        };
    }
}
