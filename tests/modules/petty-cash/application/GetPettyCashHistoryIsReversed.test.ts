/**
 * TDD tests for is_reversed flag in GetPettyCashHistory (Slice A task A3).
 *
 * is_reversed: true when the entry's id appears in the set of reference_id
 * values from REVERSAL entries in the same fund. This allows the admin frontend
 * to visually mark reversed entries without doing client-side set math.
 */

import { describe, it, expect, mock } from 'bun:test';
import { GetPettyCashHistory } from '@/modules/petty-cash/application/use-cases/GetPettyCashHistory';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { PettyCashEntry } from '@/modules/petty-cash/domain/entities/PettyCashEntry';
import { PettyCashEntryType, PettyCashEntryReferenceType } from '@/core/domain/enums';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFund(id = 'fund-1', buildingId = 'building-1') {
    return new PettyCashFund(id, buildingId, new Date());
}

function makeEntry(opts: {
    id: string;
    type?: PettyCashEntryType;
    amount?: number;
    referenceType?: PettyCashEntryReferenceType | null;
    referenceId?: string | null;
}): PettyCashEntry {
    const type = opts.type ?? PettyCashEntryType.EXPENSE;
    const amount =
        opts.amount ??
        (type === PettyCashEntryType.EXPENSE ? -50 : 50);

    return new PettyCashEntry({
        id: opts.id,
        fund_id: 'fund-1',
        type,
        amount,
        description: 'test entry',
        reference_type: opts.referenceType ?? null,
        reference_id: opts.referenceId ?? null,
        created_by: 'user-1',
    });
}

function makeRepo(options: {
    fund?: PettyCashFund | null;
    entries?: PettyCashEntry[];
    reversedIds?: Set<string>;
}) {
    // Explicit null check — do not use ?? so we can pass null intentionally.
    const fund = options.fund !== undefined ? options.fund : makeFund();
    const entries = options.entries ?? [];
    const reversedIds = options.reversedIds ?? new Set<string>();

    return {
        findFundByBuildingId: mock(async () => fund),
        findOrCreateFund: mock(async () => fund ?? makeFund()),
        getBalance: mock(async () => 0),
        addEntry: mock(async (e: any) => e),
        findEntryById: mock(async () => null),
        findEntriesByFundId: mock(async () => entries),
        findEntriesByFundIdPaginated: mock(async () => ({ items: entries, total: entries.length })),
        findEntriesByReference: mock(async () => []),
        createAssessment: mock(async (a: any) => a),
        findAssessmentsByFundId: mock(async () => []),
        findAssessmentsByPeriod: mock(async () => []),
        findReversedOriginalIds: mock(async (_fundId: string) => reversedIds),
    };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GetPettyCashHistory — is_reversed flag', () => {
    it('entry in reversedIds set → is_reversed: true', async () => {
        const expenseEntry = makeEntry({ id: 'entry-original', type: PettyCashEntryType.EXPENSE });

        // The repo says entry-original was reversed
        const repo = makeRepo({
            entries: [expenseEntry],
            reversedIds: new Set(['entry-original']),
        });

        const useCase = new GetPettyCashHistory(repo as any);
        const result = await useCase.execute('building-1', { page: 1, limit: 10 });

        expect(result.data).toHaveLength(1);
        expect((result.data[0] as any).is_reversed).toBe(true);
    });

    it('entry NOT in reversedIds set → is_reversed: false', async () => {
        const expenseEntry = makeEntry({ id: 'entry-live', type: PettyCashEntryType.EXPENSE });

        const repo = makeRepo({
            entries: [expenseEntry],
            reversedIds: new Set<string>(), // empty set
        });

        const useCase = new GetPettyCashHistory(repo as any);
        const result = await useCase.execute('building-1', { page: 1, limit: 10 });

        expect((result.data[0] as any).is_reversed).toBe(false);
    });

    it('repo is called with the correct fundId', async () => {
        const fund = makeFund('fund-abc', 'building-xyz');
        const repo = makeRepo({ fund });

        const useCase = new GetPettyCashHistory(repo as any);
        await useCase.execute('building-xyz', { page: 1, limit: 10 });

        expect(repo.findReversedOriginalIds).toHaveBeenCalledTimes(1);
        const calledWith = (repo.findReversedOriginalIds as any).mock.calls[0][0];
        expect(calledWith).toBe('fund-abc');
    });

    it('mixed entries: reversal entry itself is NOT marked reversed; its target is', async () => {
        const originalEntry = makeEntry({
            id: 'entry-original',
            type: PettyCashEntryType.EXPENSE,
        });
        const reversalEntry = makeEntry({
            id: 'entry-reversal',
            type: PettyCashEntryType.REVERSAL,
            amount: 50,
            referenceType: PettyCashEntryReferenceType.REVERSAL,
            referenceId: 'entry-original',
        });

        const repo = makeRepo({
            entries: [originalEntry, reversalEntry],
            // only the original is in the "reversed" set
            reversedIds: new Set(['entry-original']),
        });

        const useCase = new GetPettyCashHistory(repo as any);
        const result = await useCase.execute('building-1', { page: 1, limit: 10 });

        const dataMap = new Map(result.data.map((e: any) => [e.id, e]));
        expect((dataMap.get('entry-original') as any).is_reversed).toBe(true);
        expect((dataMap.get('entry-reversal') as any).is_reversed).toBe(false);
    });

    it('no fund → empty result without calling findReversedOriginalIds', async () => {
        const repo = makeRepo({ fund: null });

        const useCase = new GetPettyCashHistory(repo as any);
        const result = await useCase.execute('building-missing', { page: 1, limit: 10 });

        expect(result.data).toEqual([]);
        expect(repo.findReversedOriginalIds).not.toHaveBeenCalled();
    });
});
