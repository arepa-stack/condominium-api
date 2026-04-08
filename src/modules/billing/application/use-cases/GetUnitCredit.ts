import { ICreditLedgerRepository } from '../../domain/repository';
import { CreditLedgerEntry } from '../../domain/entities/CreditLedgerEntry';

export interface GetUnitCreditResult {
    balance: number;
    history: CreditLedgerEntry[];
}

export class GetUnitCredit {
    constructor(private creditLedgerRepo: ICreditLedgerRepository) { }

    async execute(unitId: string): Promise<GetUnitCreditResult> {
        const [balance, history] = await Promise.all([
            this.creditLedgerRepo.getBalanceForUnit(unitId),
            this.creditLedgerRepo.getEntriesForUnit(unitId)
        ]);

        return { balance, history };
    }
}
