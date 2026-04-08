import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashFund } from '../../domain/entities/PettyCashFund';
import { PettyCashTransaction } from '../../domain/entities/PettyCashTransaction';
import { IInvoiceRepository } from '../../../billing/domain/repository';
import { Invoice, InvoiceStatus, InvoiceType } from '../../../billing/domain/entities/Invoice';
import { PettyCashTransactionType, PettyCashCategory, InvoiceTag } from '../../../../core/domain/enums';

export interface RegisterExpenseDTO {
    buildingId: string;
    amount: number;
    description: string;
    category: PettyCashCategory;
    userId: string;
    evidenceUrl?: string;
}

export class RegisterPettyCashExpense {
    constructor(
        private pettyCashRepo: PettyCashRepository,
        private invoiceRepo: IInvoiceRepository
    ) { }

    async execute(dto: RegisterExpenseDTO) {
        let fund = await this.pettyCashRepo.findFundByBuildingId(dto.buildingId);

        if (!fund) {
            fund = PettyCashFund.create(dto.buildingId);
        }

        const { deducted, overage } = fund.registerExpensePartial(dto.amount);
        await this.pettyCashRepo.saveFund(fund);

        const period = new Date().toISOString().substring(0, 7); // YYYY-MM
        const description = `[${dto.category}] ${dto.description}`;

        // Create invoice for the amount actually deducted from fund (skip if zero)
        if (deducted > 0) {
            const deductedInvoice = new Invoice({
                id: crypto.randomUUID(),
                building_id: dto.buildingId,
                amount: deducted,
                period,
                issue_date: new Date(),
                status: InvoiceStatus.PAID,
                type: InvoiceType.EXPENSE,
                tag: InvoiceTag.PETTY_CASH,
                description,
                receipt_number: undefined
            });
            await this.invoiceRepo.create(deductedInvoice);
        }

        // Create invoice for the overage (amount beyond fund balance)
        if (overage > 0) {
            const overageInvoice = new Invoice({
                id: crypto.randomUUID(),
                building_id: dto.buildingId,
                amount: overage,
                period,
                issue_date: new Date(),
                status: InvoiceStatus.PAID,
                type: InvoiceType.EXPENSE,
                tag: InvoiceTag.PETTY_CASH,
                description,
                receipt_number: undefined
            });
            await this.invoiceRepo.create(overageInvoice);
        }

        const transaction = new PettyCashTransaction(
            '',
            fund.id,
            PettyCashTransactionType.EXPENSE,
            dto.amount,
            dto.description,
            dto.category,
            dto.userId,
            dto.evidenceUrl
        );

        return await this.pettyCashRepo.saveTransaction(transaction);
    }
}
