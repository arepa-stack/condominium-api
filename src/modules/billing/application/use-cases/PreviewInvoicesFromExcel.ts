import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { IInvoiceFileParser, RawInvoiceData } from '../../domain/services/IExcelInvoiceParser';

export interface ProposedInvoice extends RawInvoiceData {
    unitId?: string;
    status: 'EXISTS' | 'TO_BE_CREATED';
}

export interface PreviewInvoicesResponse {
    invoices: ProposedInvoice[];
    unitsToCreate: string[];
}

export class PreviewInvoicesFromExcel {
    constructor(
        private unitRepository: IUnitRepository,
        private parser: IInvoiceFileParser
    ) { }

    async execute(buffer: Buffer, buildingId: string): Promise<PreviewInvoicesResponse> {
        const { invoices: rawData } = await this.parser.parse(buffer);
        const existingUnits = await this.unitRepository.findByBuildingId(buildingId);

        const unitsMap = new Map(existingUnits.map(unit => [unit.name.toLowerCase(), unit.id]));
        const unitsToCreate = new Set<string>();

        const invoices: ProposedInvoice[] = rawData.map(item => {
            const unitId = unitsMap.get(item.unitName.toLowerCase());
            const status = unitId ? 'EXISTS' : 'TO_BE_CREATED';

            if (status === 'TO_BE_CREATED') {
                unitsToCreate.add(item.unitName);
            }

            return {
                ...item,
                unitId: unitId || undefined,
                status
            };
        });

        return {
            invoices,
            unitsToCreate: Array.from(unitsToCreate)
        };
    }
}
