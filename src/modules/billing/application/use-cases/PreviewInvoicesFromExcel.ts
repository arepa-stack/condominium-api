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

        const findUnit = buildUnitMatcher(existingUnits);
        const unitsToCreate = new Set<string>();

        const invoices: ProposedInvoice[] = rawData.map(item => {
            const unit = findUnit(item.unitName);

            if (!unit) {
                unitsToCreate.add(item.unitName);
                return { ...item, unitId: undefined, status: 'TO_BE_CREATED' as const };
            }

            // A loose match ("02" -> "0-2") takes the stored name so confirm resolves the same unit
            const unitName = unit.name.toLowerCase() === item.unitName.toLowerCase() ? item.unitName : unit.name;
            return { ...item, unitName, unitId: unit.id, status: 'EXISTS' as const };
        });

        return {
            invoices,
            unitsToCreate: Array.from(unitsToCreate)
        };
    }
}

type UnitRef = { id: string; name: string };

// Ignores case, spaces and separators: "02" matches "0-2", "PH" matches "P-H".
function looseKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Exact (case-insensitive) match first, as before. Otherwise a loose match, accepted
 * only when exactly one unit of the building has that loose key.
 */
function buildUnitMatcher(units: UnitRef[]): (name: string) => UnitRef | undefined {
    const exact = new Map(units.map(unit => [unit.name.toLowerCase(), unit]));
    const loose = new Map<string, UnitRef[]>();
    for (const unit of units) {
        const key = looseKey(unit.name);
        loose.set(key, [...(loose.get(key) ?? []), unit]);
    }

    return (name: string) => {
        const exactMatch = exact.get(name.toLowerCase());
        if (exactMatch) return exactMatch;
        const candidates = loose.get(looseKey(name)) ?? [];
        return candidates.length === 1 ? candidates[0] : undefined;
    };
}
