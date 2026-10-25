import { DomainError } from '@/core/errors';
import { ChargeDistribution } from '../entities/ChargeConcept';

export interface DistributableUnit {
    id: string;
    name: string;
    aliquot: number | null;
}

export interface UnitShare {
    unit_id: string;
    amount: number;
}

// Aliquots are stored with 6 decimals, so their sum can drift slightly from 100.
const ALIQUOT_SUM_TOLERANCE = 0.01;

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (cents: number) => cents / 100;
const byName = (a: DistributableUnit, b: DistributableUnit) =>
    a.name.localeCompare(b.name, 'es', { numeric: true });

/**
 * Splits a charge across units in cents; units whose share is zero are left out.
 *  - ALIQUOT rounds each unit on its own (amount * aliquot / 100), so units with
 *    the same aliquot always pay the same; the total may differ from the amount
 *    by a few cents, as on the administrator's notices.
 *  - EQUAL uses the largest remainder method, so the shares add up exactly.
 */
export function distributeCharge(
    distribution: ChargeDistribution,
    amount: number,
    units: DistributableUnit[]
): UnitShare[] {
    if (!(amount > 0)) {
        throw new DomainError('Amount must be greater than 0', 'VALIDATION_ERROR', 400);
    }
    if (units.length === 0) {
        throw new DomainError('The building has no units', 'VALIDATION_ERROR', 400);
    }

    const sorted = [...units].sort(byName);
    const totalCents = toCents(amount);

    let cents: number[];
    switch (distribution) {
        case ChargeDistribution.FIXED:
            cents = sorted.map(() => totalCents);
            break;
        case ChargeDistribution.EQUAL:
            if (totalCents < sorted.length) {
                throw new DomainError(
                    `Amount (${amount}) is too small to split across ${sorted.length} units`,
                    'VALIDATION_ERROR',
                    400
                );
            }
            cents = largestRemainder(totalCents, sorted.map(() => 1));
            break;
        case ChargeDistribution.ALIQUOT: {
            const missing = sorted.filter(u => u.aliquot === null || u.aliquot === undefined);
            if (missing.length > 0) {
                throw new DomainError(`Units without aliquot: ${missing.map(u => u.name).join(', ')}`, 'VALIDATION_ERROR', 400);
            }
            const weights = sorted.map(u => Number(u.aliquot));
            const sum = weights.reduce((s, w) => s + w, 0);
            if (Math.abs(sum - 100) > ALIQUOT_SUM_TOLERANCE) {
                throw new DomainError(
                    `Unit aliquots add up to ${Number(sum.toFixed(6))}%, expected 100%`,
                    'VALIDATION_ERROR',
                    400
                );
            }
            cents = weights.map(w => Math.round((totalCents * w) / 100));
            break;
        }
        default:
            throw new DomainError(`Invalid distribution: ${distribution}`, 'VALIDATION_ERROR', 400);
    }

    return sorted
        .map((unit, i) => ({ unit_id: unit.id, amount: fromCents(cents[i]) }))
        .filter(share => share.amount > 0);
}

/** Proportional split of `totalCents` by `weights`; leftover cents go to the largest fractions. */
function largestRemainder(totalCents: number, weights: number[]): number[] {
    const weightSum = weights.reduce((s, w) => s + w, 0);
    const exact = weights.map(w => (totalCents * w) / weightSum);
    const floors = exact.map(Math.floor);
    let leftover = totalCents - floors.reduce((s, c) => s + c, 0);

    const order = exact
        .map((value, i) => ({ i, fraction: value - floors[i] }))
        .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
    for (const { i } of order) {
        if (leftover <= 0) break;
        floors[i] += 1;
        leftover -= 1;
    }
    return floors;
}
