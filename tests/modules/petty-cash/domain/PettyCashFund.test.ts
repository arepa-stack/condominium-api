import { describe, it, expect } from 'bun:test';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';

describe('PettyCashFund entity', () => {
    describe('registerExpensePartial', () => {
        it('should deduct full expense when fund covers it — no overage', () => {
            const fund = new PettyCashFund('fund-1', 'building-1', 50, 'USD', new Date());
            const result = fund.registerExpensePartial(30);
            expect(result.deducted).toBe(30);
            expect(result.overage).toBe(0);
            expect(fund.current_balance).toBe(20);
        });

        it('should deduct all available when expense exceeds fund — overage returned', () => {
            const fund = new PettyCashFund('fund-1', 'building-1', 30, 'USD', new Date());
            const result = fund.registerExpensePartial(50);
            expect(result.deducted).toBe(30);
            expect(result.overage).toBe(20);
            expect(fund.current_balance).toBe(0);
        });

        it('should deduct exact amount when fund equals expense', () => {
            const fund = new PettyCashFund('fund-1', 'building-1', 100, 'USD', new Date());
            const result = fund.registerExpensePartial(100);
            expect(result.deducted).toBe(100);
            expect(result.overage).toBe(0);
            expect(fund.current_balance).toBe(0);
        });

        it('should return overage equal to full expense when fund is empty', () => {
            const fund = new PettyCashFund('fund-1', 'building-1', 0, 'USD', new Date());
            const result = fund.registerExpensePartial(75);
            expect(result.deducted).toBe(0);
            expect(result.overage).toBe(75);
            expect(fund.current_balance).toBe(0);
        });
    });

    describe('registerExpense (existing — backward compat)', () => {
        it('should still throw when funds are insufficient', () => {
            const fund = new PettyCashFund('fund-1', 'building-1', 10, 'USD', new Date());
            expect(() => fund.registerExpense(50)).toThrow();
        });

        it('should deduct balance when funds are sufficient', () => {
            const fund = new PettyCashFund('fund-1', 'building-1', 100, 'USD', new Date());
            fund.registerExpense(40);
            expect(fund.current_balance).toBe(60);
        });
    });
});
