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

export class PreviewAssessments {
    constructor(
        private invoiceRepo: IInvoiceRepository,
        private unitRepo: IUnitRepository,
        private pettyCashRepo: PettyCashRepository
    ) {}

    async execute(buildingId: string): Promise<AssessmentPreview> {
        // 1. Get fund and all transactions to calculate real overage
        const fund = await this.pettyCashRepo.findFundByBuildingId(buildingId);

        let totalExpenses = 0;
        let totalIncome = 0;
        const fundBalance = fund?.current_balance ?? 0;

        if (fund) {
            const transactions = await this.pettyCashRepo.findTransactionsByFundId(fund.id, {});
            totalExpenses = transactions
                .filter(t => t.type === PettyCashTransactionType.EXPENSE)
                .reduce((sum, t) => sum + t.amount, 0);
            totalIncome = transactions
                .filter(t => t.type === PettyCashTransactionType.INCOME)
                .reduce((sum, t) => sum + t.amount, 0);
        }

        // Overage = total spent beyond what was funded
        // If expenses > income, the difference is the overage
        // fund_balance is always >= 0, so: overage = expenses - income - fund_balance
        const totalOverage = Math.max(0, totalExpenses - totalIncome - fundBalance);

        // 2. Get unit-level PETTY_CASH invoices (previously assessed to units)
        const allInvoices = await this.invoiceRepo.findAll({
            building_id: buildingId,
            tag: InvoiceTag.PETTY_CASH
        });

        const alreadyAssessed = allInvoices
            .filter(inv => inv.unit_id)
            .reduce((sum, inv) => sum + inv.amount, 0);

        // 3. Calculate pending
        const pendingToAssess = Math.max(0, totalOverage - alreadyAssessed);

        // 4. Get units in building
        const units = await this.unitRepo.findByBuildingId(buildingId);

        // 5. Split equally across units
        const perUnit = units.length > 0 ? Math.round((pendingToAssess / units.length) * 100) / 100 : 0;

        return {
            building_id: buildingId,
            total_expenses: totalExpenses,
            total_income: totalIncome,
            fund_balance: fundBalance,
            total_overage: totalOverage,
            already_assessed: alreadyAssessed,
            pending_to_assess: pendingToAssess,
            units: units.map(u => ({
                id: u.id,
                name: u.name,
                amount: perUnit
            }))
        };
    }
}
