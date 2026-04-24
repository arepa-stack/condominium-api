import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GetPettyCashHistory } from '@/modules/petty-cash/application/use-cases/GetPettyCashHistory';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';

function makeRepo(options: { fund?: PettyCashFund | null } = {}) {
    const fund = options.fund ?? new PettyCashFund('fund-1', 'building-1', new Date());
    return {
        findFundByBuildingId: mock(async () => fund),
        findOrCreateFund: mock(async () => fund),
        getBalance: mock(async () => 0),
        addEntry: mock(async (e: any) => e),
        findEntryById: mock(async () => null),
        findEntriesByFundId: mock(async () => []),
        findEntriesByFundIdPaginated: mock(async () => ({ items: [], total: 0 })),
        findEntriesByReference: mock(async () => []),
        createAssessment: mock(async (a: any) => a),
        findAssessmentsByFundId: mock(async () => []),
        findAssessmentsByPeriod: mock(async () => []),
    };
}

describe('GetPettyCashHistory', () => {
    it('forwards page + limit to the paginated repo call and returns a PaginatedResult', async () => {
        const repo = makeRepo();
        const useCase = new GetPettyCashHistory(repo as any);

        const result = await useCase.execute('building-1', { page: 2, limit: 5 });

        expect(repo.findEntriesByFundIdPaginated).toHaveBeenCalled();
        const call = (repo.findEntriesByFundIdPaginated as any).mock.calls[0];
        expect(call[0]).toBe('fund-1');
        expect(call[2]).toMatchObject({ page: 2, limit: 5, isAll: false });

        expect(result.data).toBeArray();
        expect(result.metadata).toMatchObject({
            total: expect.any(Number),
            page: expect.any(Number),
            limit: expect.any(Number),
            total_pages: expect.any(Number),
            has_next_page: expect.any(Boolean),
            has_prev_page: expect.any(Boolean),
        });
    });

    it('returns an empty paginated result when no fund exists for the building', async () => {
        const repo = makeRepo({ fund: null });
        const useCase = new GetPettyCashHistory(repo as any);

        const result = await useCase.execute('building-with-no-fund', { page: 1, limit: 10 });
        expect(result.data).toEqual([]);
        expect(result.metadata.total).toBe(0);
    });

    it('honors limit="all" and marks isAll on the pagination passed to the repo', async () => {
        const repo = makeRepo();
        const useCase = new GetPettyCashHistory(repo as any);
        await useCase.execute('building-1', { limit: 'all' });
        const call = (repo.findEntriesByFundIdPaginated as any).mock.calls[0];
        expect(call[2].isAll).toBe(true);
    });
});
