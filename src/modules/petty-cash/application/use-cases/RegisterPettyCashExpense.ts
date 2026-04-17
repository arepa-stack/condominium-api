import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashEntry } from '../../domain/entities/PettyCashEntry';
import {
    PettyCashEntryType,
    PettyCashEntryReferenceType,
    PettyCashCategory,
} from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

export interface RegisterExpenseDTO {
    buildingId: string;
    amount: number;                     // positive — the actual spend
    description: string;
    category: PettyCashCategory;
    userId: string;
    evidenceUrl?: string;
}

/**
 * Record an EXPENSE entry in the petty-cash ledger. Single INSERT.
 *
 * Balance MAY go negative: if the board spends more than the current
 * balance the fund is overdrawn by (amount - balance). That overdraft
 * is reflected naturally in the view (`petty_cash_balance.balance`
 * becomes negative) and is what the next assessment collects from the
 * units. No building-level PAID fantasma invoices are generated
 * anymore — the expense lives only in the ledger.
 */
export class RegisterPettyCashExpense {
    constructor(private pettyCashRepo: PettyCashRepository) { }

    async execute(dto: RegisterExpenseDTO): Promise<PettyCashEntry> {
        if (!(dto.amount > 0)) {
            throw new DomainError(
                'Expense amount must be greater than zero',
                'VALIDATION_ERROR',
                400
            );
        }

        const fund = await this.pettyCashRepo.findOrCreateFund(dto.buildingId);

        const entry = new PettyCashEntry({
            fund_id: fund.id,
            type: PettyCashEntryType.EXPENSE,
            amount: -dto.amount,            // NEGATIVE — sign encodes direction
            category: dto.category,
            description: dto.description,
            evidence_url: dto.evidenceUrl ?? null,
            reference_type: PettyCashEntryReferenceType.MANUAL,
            created_by: dto.userId,
        });

        return await this.pettyCashRepo.addEntry(entry);
    }
}
