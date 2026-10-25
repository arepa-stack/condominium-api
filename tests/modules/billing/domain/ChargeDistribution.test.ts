import { describe, expect, it } from 'bun:test';
import { distributeCharge } from '@/modules/billing/domain/services/ChargeDistribution';
import { ChargeDistribution } from '@/modules/billing/domain/entities/ChargeConcept';

const sumCents = (shares: { amount: number }[]) => shares.reduce((s, x) => s + Math.round(x.amount * 100), 0);

// Aliquots of the 28 units in the Sep 2026 notices (they add up to 100%).
const granadaAliquots = [
    3.683168, 3.960396, 3.247525, 3.247525, 3.247525, 3.683168, 3.683168, 3.247525, 3.247525, 3.683168,
    3.683168, 3.247525, 3.247525, 3.683168, 3.683168, 3.247525, 3.247525, 3.683168, 3.683168, 3.247525,
    3.247525, 3.683168, 3.683168, 3.247525, 3.247525, 3.683168, 3.683168, 5.940595,
];

describe('distributeCharge', () => {
    it('ALIQUOT: splits the goal by aliquot, rounding each unit to the cent', () => {
        const units = [
            { id: 'u1', name: '0-1', aliquot: 3.683168 },
            { id: 'u2', name: '2-1', aliquot: 3.247525 },
            { id: 'u3', name: '1-1', aliquot: 93.069307 },
        ];

        const shares = distributeCharge(ChargeDistribution.ALIQUOT, 3100, units);

        expect(shares.find(s => s.unit_id === 'u1')!.amount).toBe(114.18);
        expect(shares.find(s => s.unit_id === 'u2')!.amount).toBe(100.67);
        expect(sumCents(shares)).toBe(310000);
    });

    it('ALIQUOT: same aliquot, same amount; matches what was billed for the 3,100 special fee', () => {
        const units = granadaAliquots.map((aliquot, i) => ({ id: `u${i}`, name: `${i}`, aliquot }));

        const shares = distributeCharge(ChargeDistribution.ALIQUOT, 3100, units);

        expect(new Set(shares.map(s => s.amount))).toEqual(new Set([114.18, 122.77, 100.67, 184.16]));
        // Per-unit rounding leaves the total 2 cents below the goal, as on the notices.
        expect(sumCents(shares)).toBe(309998);
    });

    it('ALIQUOT: rejects units without aliquot, naming them', () => {
        const units = [
            { id: 'u1', name: '1-1', aliquot: 50 },
            { id: 'u2', name: '1-2', aliquot: null },
            { id: 'u3', name: '1-3', aliquot: null },
        ];
        expect(() => distributeCharge(ChargeDistribution.ALIQUOT, 100, units)).toThrow('Units without aliquot: 1-2, 1-3');
    });

    it('ALIQUOT: rejects aliquots that do not add up to 100%', () => {
        const units = [
            { id: 'u1', name: '1-1', aliquot: 40 },
            { id: 'u2', name: '1-2', aliquot: 40 },
        ];
        expect(() => distributeCharge(ChargeDistribution.ALIQUOT, 100, units)).toThrow('Unit aliquots add up to 80%, expected 100%');
    });

    it('ALIQUOT: leaves out units whose aliquot is zero', () => {
        const units = [
            { id: 'u1', name: '1-1', aliquot: 100 },
            { id: 'u2', name: 'PB', aliquot: 0 },
        ];
        expect(distributeCharge(ChargeDistribution.ALIQUOT, 50, units)).toEqual([{ unit_id: 'u1', amount: 50 }]);
    });

    it('EQUAL: splits in equal parts and gives the leftover cents to the first units by name', () => {
        const units = [
            { id: 'u3', name: '10', aliquot: null },
            { id: 'u1', name: '2', aliquot: null },
            { id: 'u2', name: '3', aliquot: null },
        ];

        const shares = distributeCharge(ChargeDistribution.EQUAL, 100, units);

        expect(shares).toEqual([
            { unit_id: 'u1', amount: 33.34 },
            { unit_id: 'u2', amount: 33.33 },
            { unit_id: 'u3', amount: 33.33 },
        ]);
    });

    it('EQUAL: rejects an amount smaller than one cent per unit', () => {
        const units = [{ id: 'u1', name: '1', aliquot: null }, { id: 'u2', name: '2', aliquot: null }];
        expect(() => distributeCharge(ChargeDistribution.EQUAL, 0.01, units)).toThrow('too small');
    });

    it('FIXED: charges the same amount to every unit', () => {
        const units = [{ id: 'u1', name: '1', aliquot: null }, { id: 'u2', name: '2', aliquot: 5 }];
        expect(distributeCharge(ChargeDistribution.FIXED, 10, units)).toEqual([
            { unit_id: 'u1', amount: 10 },
            { unit_id: 'u2', amount: 10 },
        ]);
    });

    it('rejects a building without units and a non-positive amount', () => {
        expect(() => distributeCharge(ChargeDistribution.FIXED, 10, [])).toThrow('The building has no units');
        expect(() => distributeCharge(ChargeDistribution.FIXED, 0, [{ id: 'u1', name: '1', aliquot: null }])).toThrow('Amount must be greater than 0');
    });
});
