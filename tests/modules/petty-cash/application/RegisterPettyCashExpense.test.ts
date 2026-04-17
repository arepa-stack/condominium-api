import { describe, it, expect, mock, beforeEach } from 'bun:test';
import {
    RegisterPettyCashExpense,
    RegisterExpenseDTO,
} from '@/modules/petty-cash/application/use-cases/RegisterPettyCashExpense';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { PettyCashEntry } from '@/modules/petty-cash/domain/entities/PettyCashEntry';
import { PettyCashCategory, PettyCashEntryType } from '@/core/domain/enums';

// ---------------------------------------------------------------------
// Phase 2 semantics: RegisterPettyCashExpense does a SINGLE INSERT into
// petty_cash_entries with a negative amount. No invoice repo is
// involved. Balance may go negative (handled downstream by the view).
// ---------------------------------------------------------------------

function makeMockPettyCashRepo() {
    const fund = new PettyCashFund('fund-1', 'b1', 0, 'USD', new Date());
    return {
        findFundByBuildingId: mock(async () => fund),
        findOrCreateFund: mock(async () => fund),
        getBalance: mock(async () => 0),
        addEntry: mock(async (e: PettyCashEntry) => e),
        findEntryById: mock(async () => null),
        findEntriesByFundId: mock(async () => []),
        findEntriesByFundIdPaginated: mock(async () => ({ items: [], total: 0 })),
        findEntriesByReference: mock(async () => []),
        createAssessment: mock(async (a: any) => a),
        findAssessmentsByFundId: mock(async () => []),
        findAssessmentsByPeriod: mock(async () => []),
    };
}

describe('RegisterPettyCashExpense (ledger-based)', () => {
    let useCase: RegisterPettyCashExpense;
    let pettyCashRepo: ReturnType<typeof makeMockPettyCashRepo>;

    beforeEach(() => {
        pettyCashRepo = makeMockPettyCashRepo();
        useCase = new RegisterPettyCashExpense(pettyCashRepo as any);
    });

    it('creates one INSERT in petty_cash_entries when expense is within balance', async () => {
        // Balance is irrelevant — the use case does NOT check it. It just
        // appends a negative entry. This asserts the "single INSERT" shape:
        // type=EXPENSE, amount=-X, fund_id populated.
        const dto: RegisterExpenseDTO = {
            buildingId: 'b1',
            amount: 200,
            description: 'Fixed lobby door',
            category: PettyCashCategory.REPAIR,
            userId: 'user-1',
        };

        await useCase.execute(dto);

        expect(pettyCashRepo.findOrCreateFund).toHaveBeenCalledWith('b1');
        expect(pettyCashRepo.addEntry).toHaveBeenCalledTimes(1);

        const entry: PettyCashEntry = pettyCashRepo.addEntry.mock.calls[0][0];
        expect(entry.type).toBe(PettyCashEntryType.EXPENSE);
        expect(entry.amount).toBe(-200);
        expect(entry.fund_id).toBe('fund-1');
        expect(entry.description).toBe('Fixed lobby door');
        expect(entry.category).toBe(PettyCashCategory.REPAIR);
        expect(entry.created_by).toBe('user-1');
    });

    it('allows balance to go negative when expense exceeds balance (no invoice interaction)', async () => {
        // Even if the balance would go negative, the use case still
        // records a single EXPENSE entry with the FULL negative amount.
        // No building-level fantasma invoice gets created — that flow
        // is gone in Phase 2.
        pettyCashRepo.getBalance.mockImplementation(async () => 50);

        const dto: RegisterExpenseDTO = {
            buildingId: 'b1',
            amount: 600,
            description: 'Emergency repair',
            category: PettyCashCategory.EMERGENCY,
            userId: 'user-1',
        };

        await useCase.execute(dto);

        expect(pettyCashRepo.addEntry).toHaveBeenCalledTimes(1);
        const entry: PettyCashEntry = pettyCashRepo.addEntry.mock.calls[0][0];
        expect(entry.amount).toBe(-600);
        expect(entry.type).toBe(PettyCashEntryType.EXPENSE);
    });

    it('throws VALIDATION_ERROR when amount is zero', async () => {
        const dto: RegisterExpenseDTO = {
            buildingId: 'b1',
            amount: 0,
            description: 'Invalid expense',
            category: PettyCashCategory.OTHER,
            userId: 'user-1',
        };

        await expect(useCase.execute(dto)).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
        expect(pettyCashRepo.addEntry).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR when amount is negative', async () => {
        const dto: RegisterExpenseDTO = {
            buildingId: 'b1',
            amount: -10,
            description: 'Invalid',
            category: PettyCashCategory.OTHER,
            userId: 'user-1',
        };

        await expect(useCase.execute(dto)).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
        expect(pettyCashRepo.addEntry).not.toHaveBeenCalled();
    });

    it('creates the fund on first expense via findOrCreateFund', async () => {
        // findOrCreateFund is an atomic upsert — if no fund exists the
        // repo creates one and returns it. This test pins the call site.
        const dto: RegisterExpenseDTO = {
            buildingId: 'b-new',
            amount: 100,
            description: 'Office supplies',
            category: PettyCashCategory.OFFICE,
            userId: 'user-1',
        };

        await useCase.execute(dto);

        expect(pettyCashRepo.findOrCreateFund).toHaveBeenCalledTimes(1);
        expect(pettyCashRepo.findOrCreateFund).toHaveBeenCalledWith('b-new');
        expect(pettyCashRepo.addEntry).toHaveBeenCalledTimes(1);
    });
});
