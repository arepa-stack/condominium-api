import { describe, it, expect } from 'bun:test';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';

describe('PettyCashFund entity', () => {
    it('exposes its id, building_id and updated_at', () => {
        const now = new Date();
        const fund = new PettyCashFund('fund-1', 'building-1', now);
        expect(fund.id).toBe('fund-1');
        expect(fund.building_id).toBe('building-1');
        expect(fund.updated_at).toBe(now);
    });

    it('serialises to JSON with metadata only — balance and currency are gone', () => {
        const fund = new PettyCashFund('fund-1', 'building-1', new Date('2026-04-18'));
        const json = fund.toJSON();
        expect(json).toEqual({
            id: 'fund-1',
            building_id: 'building-1',
            updated_at: new Date('2026-04-18'),
            // target_fund defaults to 0.
            target_fund: 0,
        });
        // Phase 3 dropped these fields from the persistence layer and
        // the entity. Balance lives in petty_cash_balance (view);
        // currency was never consumed and is removed.
        expect('current_balance' in json).toBe(false);
        expect('currency' in json).toBe(false);
    });
});
