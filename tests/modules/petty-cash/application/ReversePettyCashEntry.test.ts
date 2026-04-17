import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ReversePettyCashEntry } from '@/modules/petty-cash/application/use-cases/ReversePettyCashEntry';
import { PettyCashEntry } from '@/modules/petty-cash/domain/entities/PettyCashEntry';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import {
    PettyCashEntryType,
    PettyCashEntryReferenceType,
} from '@/core/domain/enums';

function makeEntry(overrides: Partial<Parameters<typeof PettyCashEntry>[0] & { id: string }> = {}): PettyCashEntry {
    return new PettyCashEntry({
        id: 'entry-1',
        fund_id: 'fund-1',
        type: PettyCashEntryType.INCOME,
        amount: 100,
        description: 'Income entry',
        created_by: 'user-1',
        ...overrides,
    } as any);
}

function makeFund(id = 'fund-1', buildingId = 'building-1'): PettyCashFund {
    return new PettyCashFund(id, buildingId, new Date());
}

function createRepoMock(overrides: any = {}) {
    return {
        findFundByBuildingId: mock(async () => makeFund()),
        findOrCreateFund: mock(async () => makeFund()),
        getBalance: mock(async () => 0),
        addEntry: mock(async (e: PettyCashEntry) => e),
        findEntryById: mock(async () => null),
        findEntriesByFundId: mock(async () => []),
        findEntriesByReference: mock(async () => []),
        createAssessment: mock(async () => ({} as any)),
        findAssessmentsByFundId: mock(async () => []),
        findAssessmentsByPeriod: mock(async () => []),
        ...overrides,
    };
}

describe('ReversePettyCashEntry', () => {
    let repo: ReturnType<typeof createRepoMock>;
    let useCase: ReversePettyCashEntry;

    beforeEach(() => {
        repo = createRepoMock();
        useCase = new ReversePettyCashEntry(repo as any);
    });

    it('creates a counter-asiento for a non-reversal entry', async () => {
        const original = makeEntry({
            id: 'entry-1',
            type: PettyCashEntryType.EXPENSE,
            amount: -50,
            description: 'Repair',
        });
        repo.findEntryById = mock(async () => original);
        repo.findFundByBuildingId = mock(async () => makeFund());

        const result = await useCase.execute({
            entryId: 'entry-1',
            reason: 'typed the wrong amount',
            userId: 'user-admin',
            buildingId: 'building-1',
        });

        expect(result.type).toBe(PettyCashEntryType.REVERSAL);
        expect(result.amount).toBe(50); // negated from -50
        expect(result.reference_type).toBe(PettyCashEntryReferenceType.REVERSAL);
        expect(result.reference_id).toBe('entry-1');
        expect(repo.addEntry).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundError when the entry does not exist', async () => {
        repo.findEntryById = mock(async () => null);

        await expect(useCase.execute({
            entryId: 'missing',
            reason: 'whatever reason here',
            userId: 'u1',
            buildingId: 'b1',
        })).rejects.toThrow(/not found/);
    });

    it('throws when the entry belongs to a different building', async () => {
        const original = makeEntry({ fund_id: 'fund-FOREIGN' });
        repo.findEntryById = mock(async () => original);
        repo.findFundByBuildingId = mock(async () => makeFund('fund-OWN', 'building-OWN'));

        await expect(useCase.execute({
            entryId: 'entry-1',
            reason: 'cross-building attempt',
            userId: 'u1',
            buildingId: 'building-OWN',
        })).rejects.toThrow(/does not belong to this building/);
    });

    it('refuses to reverse a reversal', async () => {
        const alreadyAReversal = makeEntry({
            id: 'entry-1',
            type: PettyCashEntryType.REVERSAL,
            amount: 50,
        });
        repo.findEntryById = mock(async () => alreadyAReversal);
        repo.findFundByBuildingId = mock(async () => makeFund());

        await expect(useCase.execute({
            entryId: 'entry-1',
            reason: 'undo the undo',
            userId: 'u1',
            buildingId: 'building-1',
        })).rejects.toThrow(/Cannot reverse a reversal/);
    });

    it('is idempotent — returns the existing reversal when one exists', async () => {
        const original = makeEntry({ type: PettyCashEntryType.EXPENSE, amount: -75 });
        const existingReversal = new PettyCashEntry({
            id: 'entry-2',
            fund_id: 'fund-1',
            type: PettyCashEntryType.REVERSAL,
            amount: 75,
            description: 'Reversión: previous mistake',
            reference_type: PettyCashEntryReferenceType.REVERSAL,
            reference_id: 'entry-1',
            created_by: 'u1',
        });

        repo.findEntryById = mock(async () => original);
        repo.findFundByBuildingId = mock(async () => makeFund());
        repo.findEntriesByReference = mock(async () => [existingReversal]);

        const result = await useCase.execute({
            entryId: 'entry-1',
            reason: 'retrying the same reversal call',
            userId: 'u1',
            buildingId: 'building-1',
        });

        expect(result.id).toBe('entry-2');
        expect(repo.addEntry).not.toHaveBeenCalled();
    });

    it('requires a reason string of at least 1 char', async () => {
        await expect(useCase.execute({
            entryId: 'entry-1',
            reason: '   ',
            userId: 'u1',
            buildingId: 'b1',
        })).rejects.toThrow(/Reason is required/);
    });
});
