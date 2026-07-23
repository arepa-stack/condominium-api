/**
 * Tests for PettyCashFund.target_fund field.
 */

import { describe, it, expect } from 'bun:test';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';

describe('PettyCashFund — target_fund', () => {
    it('defaults target_fund to 0 when not provided', () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        expect(fund.target_fund).toBe(0);
    });

    it('stores target_fund when provided', () => {
        const fund = new PettyCashFund('f1', 'b1', new Date(), 150);
        expect(fund.target_fund).toBe(150);
    });

    it('includes target_fund in toJSON()', () => {
        const fund = new PettyCashFund('f1', 'b1', new Date(), 200);
        const json = fund.toJSON();
        expect(json.target_fund).toBe(200);
    });

    it('toJSON includes target_fund = 0 by default', () => {
        const fund = new PettyCashFund('f1', 'b1', new Date());
        const json = fund.toJSON();
        expect(json.target_fund).toBe(0);
    });
});
