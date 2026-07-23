/**
 * TDD tests for SetTargetFund use case (Slice B — B4).
 *
 * RED phase: tests written BEFORE the use case exists.
 *
 * Scenarios:
 *   - Cold start: building with no fund row → fund created, target set.
 *   - Zero is valid (resets to "overage-only" mode).
 *   - Negative value rejected (VALIDATION_ERROR 400).
 *   - Value persisted with correct fundId.
 */

import { describe, it, expect, mock } from 'bun:test';
import { SetTargetFund } from '@/modules/petty-cash/application/use-cases/SetTargetFund';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';

function makePettyCashRepo(options: { fund?: PettyCashFund } = {}) {
    const fund = options.fund ?? new PettyCashFund('f1', 'b1', new Date(), 0);
    return {
        findFundByBuildingId: mock(() => Promise.resolve(options.fund ?? null)),
        findOrCreateFund: mock(() => Promise.resolve(fund)),
        getBalance: mock(() => Promise.resolve(0)),
        getBalanceByCurrency: mock(() => Promise.resolve([])),
        addEntry: mock((e: any) => Promise.resolve(e)),
        findEntryById: mock(() => Promise.resolve(null)),
        findEntriesByFundId: mock(() => Promise.resolve([])),
        findEntriesByFundIdPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
        findEntriesByReference: mock(() => Promise.resolve([])),
        findReversedOriginalIds: mock(() => Promise.resolve(new Set<string>())),
        createAssessment: mock((a: any) => Promise.resolve(a)),
        findAssessmentsByFundId: mock(() => Promise.resolve([])),
        findAssessmentsByPeriod: mock(() => Promise.resolve([])),
        updateFundTargetFund: mock(() => Promise.resolve()),
        findAssessmentById: mock(() => Promise.resolve(null)),
    };
}

describe('SetTargetFund', () => {
    it('creates a fund (cold start) and sets target_fund', async () => {
        const repo = makePettyCashRepo(); // no existing fund
        const useCase = new SetTargetFund(repo as any);

        const result = await useCase.execute({ buildingId: 'b1', targetFund: 100 });

        // findOrCreateFund must be called (cold-start safe)
        expect(repo.findOrCreateFund).toHaveBeenCalledWith('b1');
        // updateFundTargetFund called with fund id and target value
        expect(repo.updateFundTargetFund).toHaveBeenCalledWith('f1', 100);
        expect(result.building_id).toBe('b1');
        expect(result.target_fund).toBe(100);
    });

    it('updates an existing fund target', async () => {
        const existingFund = new PettyCashFund('fund-existing', 'b1', new Date(), 50);
        const repo = makePettyCashRepo({ fund: existingFund });
        const useCase = new SetTargetFund(repo as any);

        const result = await useCase.execute({ buildingId: 'b1', targetFund: 200 });

        expect(repo.updateFundTargetFund).toHaveBeenCalledWith('fund-existing', 200);
        expect(result.building_id).toBe('b1');
        expect(result.target_fund).toBe(200);
    });

    it('accepts zero as a valid target (resets to overage-only mode)', async () => {
        const repo = makePettyCashRepo();
        const useCase = new SetTargetFund(repo as any);

        const result = await useCase.execute({ buildingId: 'b1', targetFund: 0 });

        expect(repo.updateFundTargetFund).toHaveBeenCalledWith('f1', 0);
        expect(result.target_fund).toBe(0);
    });

    it('rejects negative target_fund with VALIDATION_ERROR', async () => {
        const repo = makePettyCashRepo();
        const useCase = new SetTargetFund(repo as any);

        await expect(
            useCase.execute({ buildingId: 'b1', targetFund: -10 })
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

        expect(repo.updateFundTargetFund).not.toHaveBeenCalled();
    });

    it('rejects NaN target_fund with VALIDATION_ERROR', async () => {
        const repo = makePettyCashRepo();
        const useCase = new SetTargetFund(repo as any);

        await expect(
            useCase.execute({ buildingId: 'b1', targetFund: NaN })
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});
