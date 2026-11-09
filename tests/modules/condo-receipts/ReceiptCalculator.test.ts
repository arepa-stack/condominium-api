import { describe, expect, it } from 'bun:test';
import { calculateReceipt, lineShare } from '@/modules/condo-receipts/domain/ReceiptCalculator';

const units = [
    { id: 'u2', name: '2', aliquot: 60 },
    { id: 'u1', name: '1', aliquot: 40 },
];

const base = { period: '2026-10', rate: 100, reserveLabel: 'FONDO DE RESERVA', units };

describe('calculateReceipt', () => {
    it('groups by code, converts USD to Bs and adds the reserve line', () => {
        const r = calculateReceipt({
            ...base,
            reservePercent: 10,
            expenses: [
                { code: '300047', description: 'LIMPIEZA', amount: 500, currency: 'VES' },
                { code: '200001', description: 'AGUA', amount: 10, currency: 'USD' },
                { code: '300047', description: 'LIMPIEZA', amount: 500, currency: 'VES' },
            ],
        });

        expect(r.lines).toEqual([
            { code: '200001', description: 'AGUA', amount_bs: 1000, percent: 45.45 },
            { code: '300047', description: 'LIMPIEZA', amount_bs: 1000, percent: 45.45 },
            { code: null, description: 'FONDO DE RESERVA', amount_bs: 200, percent: 9.09 },
        ]);
        expect(r.total_bs).toBe(2200);
        expect(r.total_usd).toBe(22);
        expect(r.units.map(u => [u.unit_name, u.total_bs, u.total_usd, u.control_number])).toEqual([
            ['1', 880, 8.8, '202610001'],
            ['2', 1320, 13.2, '202610002'],
        ]);
    });

    it("unit totals are the sum of its per-line shares", () => {
        const r = calculateReceipt({
            ...base,
            reservePercent: 0,
            units: [{ id: 'a', name: 'A', aliquot: 33.333333 }, { id: 'b', name: 'B', aliquot: 66.666667 }],
            expenses: [
                { code: '1', description: 'X', amount: 10.01, currency: 'VES' },
                { code: '2', description: 'Y', amount: 10.01, currency: 'VES' },
            ],
        });
        const a = r.units.find(u => u.unit_id === 'a')!;
        expect(a.total_bs).toBe(lineShare(10.01, 33.333333) * 2);
    });

    it('rejects a period without expenses and bad aliquots', () => {
        expect(() => calculateReceipt({ ...base, reservePercent: 0, expenses: [] })).toThrow();
        expect(() => calculateReceipt({
            ...base,
            reservePercent: 0,
            units: [{ id: 'a', name: 'A', aliquot: 50 }],
            expenses: [{ code: '1', description: 'X', amount: 1, currency: 'VES' }],
        })).toThrow();
    });
});
