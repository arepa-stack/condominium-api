import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashFund } from '../../domain/entities/PettyCashFund';
import { PettyCashTransaction } from '../../domain/entities/PettyCashTransaction';
import { PettyCashTransactionType, PettyCashCategory } from '@/core/domain/enums';

export interface RegisterIncomeDTO {
    buildingId: string;
    amount: number;
    description: string;
    userId: string;
}

export class RegisterPettyCashIncome {
    constructor(private pettyCashRepo: PettyCashRepository) { }

    async execute(dto: RegisterIncomeDTO) {
        console.log('Registering petty cash income:', dto);
        let fund = await this.pettyCashRepo.findFundByBuildingId(dto.buildingId);

        if (!fund) {
            fund = PettyCashFund.create(dto.buildingId);
            // Don't save yet, wait until income is added
        }

        fund.addIncome(dto.amount);
        await this.pettyCashRepo.saveFund(fund); // NOW save with balance

        const transaction = new PettyCashTransaction(
            '',
            fund.id,
            PettyCashTransactionType.INCOME,
            dto.amount,
            dto.description,
            PettyCashCategory.OTHER, // Default for income usually
            dto.userId
        );

        return await this.pettyCashRepo.saveTransaction(transaction);
    }
}
