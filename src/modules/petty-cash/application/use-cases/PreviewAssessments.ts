import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { InvoiceTag, PettyCashTransactionType } from '@/core/domain/enums';

export interface AssessmentPreview {
    building_id: string;
    total_expenses: number;
    total_income: number;
    fund_balance: number;
    total_overage: number;
    already_assessed: number;
    pending_to_assess: number;
    units: { id: string; name: string; amount: number }[];
}

// Money is handled as integer cents inside this use case to avoid
// IEEE-754 drift. Floats arrive from the repo layer (legacy shape),
// are rounded to cents on the way in, and converted back only in the
// DTO. Never sum floats — always sum cents.
const toCents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

export class PreviewAssessments {
    constructor(
        private invoiceRepo: IInvoiceRepository,
        private unitRepo: IUnitRepository,
        private pettyCashRepo: PettyCashRepository
    ) {}

    async execute(buildingId: string): Promise<AssessmentPreview> {
        const fund = await this.pettyCashRepo.findFundByBuildingId(buildingId);

        let expensesCents = 0;
        let incomeCents = 0;
        const fundBalanceCents = fund ? toCents(fund.current_balance) : 0;

        if (fund) {
            const transactions = await this.pettyCashRepo.findTransactionsByFundId(fund.id, {});
            for (const t of transactions) {
                if (t.type === PettyCashTransactionType.EXPENSE) {
                    expensesCents += toCents(t.amount);
                } else if (t.type === PettyCashTransactionType.INCOME) {
                    incomeCents += toCents(t.amount);
                }
            }
        }

        const overageCents = Math.max(0, expensesCents - incomeCents - fundBalanceCents);

        const allInvoices = await this.invoiceRepo.findAll({
            building_id: buildingId,
            tag: InvoiceTag.PETTY_CASH
        });

        let alreadyAssessedCents = 0;
        for (const inv of allInvoices) {
            if (!inv.unit_id) continue;
            alreadyAssessedCents += toCents(inv.amount);
        }

        let pendingCents = Math.max(0, overageCents - alreadyAssessedCents);

        // Absorb sub-cent residue. Anything under 1 cent is accounting
        // dust from legacy float-stored invoices, not real debt.
        if (pendingCents < 1) {
            pendingCents = 0;
        }

        const units = await this.unitRepo.findByBuildingId(buildingId);

        // Fair distribution: split pendingCents across units at the cent
        // level so the sum of unit amounts equals pendingCents exactly.
        // The first `remainder` units get one extra cent.
        const unitCents: number[] = new Array(units.length).fill(0);
        if (units.length > 0 && pendingCents > 0) {
            const base = Math.floor(pendingCents / units.length);
            const remainder = pendingCents - base * units.length;
            for (let i = 0; i < units.length; i++) {
                unitCents[i] = base + (i < remainder ? 1 : 0);
            }
        }

        return {
            building_id: buildingId,
            total_expenses: fromCents(expensesCents),
            total_income: fromCents(incomeCents),
            fund_balance: fromCents(fundBalanceCents),
            total_overage: fromCents(overageCents),
            already_assessed: fromCents(alreadyAssessedCents),
            pending_to_assess: fromCents(pendingCents),
            units: units.map((u, i) => ({
                id: u.id,
                name: u.name,
                amount: fromCents(unitCents[i])
            }))
        };
    }
}
