import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { Unit } from '@/modules/buildings/domain/entities/Unit';
import type { ChargeConceptGuard } from '../services/ChargeConceptGuard';

export interface ConfirmedInvoice {
    unitName: string;
    amount: number;
    period: string;
    issueDate: string; // ISO string from JSON
    receiptNumber: string;
    description?: string;
    status: 'EXISTS' | 'TO_BE_CREATED';
}

export interface BulkLoadInvoicesRequest {
    invoices: ConfirmedInvoice[];
    buildingId: string;
    /** Charge concept assigned to every imported invoice. */
    conceptId?: string;
}

export class BulkLoadInvoicesFromExcel {
    constructor(
        private invoiceRepository: IInvoiceRepository,
        private unitRepository: IUnitRepository,
        private conceptGuard?: Pick<ChargeConceptGuard, 'assertBillable'>
    ) { }

    async execute(request: BulkLoadInvoicesRequest): Promise<void> {
        const { invoices, buildingId, conceptId } = request;

        // Checked before anything is written: a rejected concept leaves no units behind.
        if (conceptId) {
            if (!this.conceptGuard) {
                throw new Error('Cannot check the charge concept of this import');
            }
            await this.conceptGuard.assertBillable(conceptId, buildingId);
        }

        await this.syncUnits(invoices, buildingId);

        const unitsMap = await this.getUnitsNameMap(buildingId);
        const processedReceipts = await this.getExistingReceipts(buildingId);

        const newInvoices = this.createInvoiceEntities(invoices, unitsMap, processedReceipts, conceptId ?? null);

        if (newInvoices.length > 0) {
            await this.invoiceRepository.createBatch(newInvoices);
        }
    }

    private async syncUnits(invoices: ConfirmedInvoice[], buildingId: string): Promise<void> {
        const newUnitNames = this.getUniqueNamesToCreate(invoices);

        if (newUnitNames.length === 0) return;

        const unitsToCreate = newUnitNames.map(name => new Unit({
            id: crypto.randomUUID(),
            building_id: buildingId,
            name
        }));

        await this.unitRepository.createBatch(unitsToCreate);
    }

    private getUniqueNamesToCreate(invoices: ConfirmedInvoice[]): string[] {
        return Array.from(new Set(
            invoices
                .filter(inv => inv.status === 'TO_BE_CREATED')
                .map(inv => inv.unitName)
        ));
    }

    private async getUnitsNameMap(buildingId: string): Promise<Map<string, string>> {
        const units = await this.unitRepository.findByBuildingId(buildingId);
        return new Map(units.map(u => [u.name.toLowerCase(), u.id]));
    }

    private async getExistingReceipts(buildingId: string): Promise<Set<string>> {
        const existingInvoices = await this.invoiceRepository.findAll({ building_id: buildingId });
        return new Set(
            existingInvoices
                .map(inv => inv.receipt_number)
                .filter((receipt): receipt is string => !!receipt)
        );
    }

    private createInvoiceEntities(
        invoices: ConfirmedInvoice[],
        unitsMap: Map<string, string>,
        existingReceipts: Set<string>,
        conceptId: string | null
    ): Invoice[] {
        return invoices
            .filter(item => !existingReceipts.has(item.receiptNumber))
            .map(item => this.mapToInvoiceEntity(item, unitsMap, conceptId));
    }

    private mapToInvoiceEntity(item: ConfirmedInvoice, unitsMap: Map<string, string>, conceptId: string | null): Invoice {
        const unitId = unitsMap.get(item.unitName.toLowerCase());
        if (!unitId) {
            throw new Error(`Unit ${item.unitName} not found after sync`);
        }

        return new Invoice({
            id: crypto.randomUUID(),
            unit_id: unitId,
            amount: item.amount,
            period: item.period,
            issue_date: new Date(item.issueDate),
            status: InvoiceStatus.PENDING,
            type: InvoiceType.DEBT,
            receipt_number: item.receiptNumber,
            description: item.description ?? `Carga inicial - Recibo ${item.receiptNumber}`,
            concept_id: conceptId
        });
    }
}
