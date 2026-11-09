import { DomainError } from '@/core/errors';
import { ChargeDistribution } from '@/modules/billing/domain/entities/ChargeConcept';
import { distributeCharge, DistributableUnit } from '@/modules/billing/domain/services/ChargeDistribution';

export type ExpenseCurrency = 'USD' | 'VES';

export interface ReceiptExpense {
    code: string;
    description: string;
    amount: number;
    currency: ExpenseCurrency;
}

export interface ReceiptLine {
    /** Null only on reserve lines of receipts generated before the reserve had a code. */
    code: string | null;
    description: string;
    amount_bs: number;
    /** Share of the receipt total, 2 decimals ("% GASTO"). */
    percent: number;
}

export interface ReceiptUnit {
    unit_id: string;
    unit_name: string;
    aliquot: number;
    control_number: string;
    total_bs: number;
    total_usd: number;
}

export interface CalculatedReceipt {
    lines: ReceiptLine[];
    units: ReceiptUnit[];
    total_bs: number;
    total_usd: number;
}

export interface CalculateReceiptInput {
    period: string;
    expenses: ReceiptExpense[];
    /** Bs per USD. */
    rate: number;
    reservePercent: number;
    reserveLabel: string;
    reserveCode: string;
    units: DistributableUnit[];
}

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (cents: number) => cents / 100;

/**
 * Builds the receipt of a period: expenses grouped by code and converted to Bs
 * with one rate, plus the reserve fund line, then each unit's share by aliquot.
 * Each line is split on its own (as the notice prints a "CUOTA" per line), so a
 * unit's total is the sum of its line shares.
 */
export function calculateReceipt(input: CalculateReceiptInput): CalculatedReceipt {
    if (input.expenses.length === 0) {
        throw new DomainError('The period has no expenses', 'VALIDATION_ERROR', 400);
    }
    if (!(input.rate > 0)) {
        throw new DomainError('Exchange rate must be greater than 0', 'VALIDATION_ERROR', 400);
    }
    if (input.reservePercent < 0 || input.reservePercent > 100) {
        throw new DomainError('Reserve percent must be between 0 and 100', 'VALIDATION_ERROR', 400);
    }

    const byCode = new Map<string, { description: string; cents: number }>();
    for (const expense of input.expenses) {
        const bs = expense.currency === 'USD' ? expense.amount * input.rate : expense.amount;
        const group = byCode.get(expense.code) ?? { description: expense.description, cents: 0 };
        group.cents += toCents(bs);
        byCode.set(expense.code, group);
    }

    const rawLines = [...byCode.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
        .map(([code, g]) => ({ code: code as string | null, description: g.description, cents: g.cents }));

    const subtotal = rawLines.reduce((sum, l) => sum + l.cents, 0);
    const reserveCents = Math.round((subtotal * input.reservePercent) / 100);
    if (reserveCents > 0) rawLines.push({ code: input.reserveCode, description: input.reserveLabel, cents: reserveCents });

    const totalCents = subtotal + reserveCents;
    const lines: ReceiptLine[] = rawLines.map(l => ({
        code: l.code,
        description: l.description,
        amount_bs: fromCents(l.cents),
        percent: Math.round((l.cents / totalCents) * 10000) / 100,
    }));

    const unitCents = new Map(input.units.map(u => [u.id, 0]));
    for (const line of lines) {
        for (const share of distributeCharge(ChargeDistribution.ALIQUOT, line.amount_bs, input.units)) {
            unitCents.set(share.unit_id, unitCents.get(share.unit_id)! + toCents(share.amount));
        }
    }

    const periodDigits = input.period.replace('-', '');
    const units: ReceiptUnit[] = [...input.units]
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
        .map((u, i) => {
            const cents = unitCents.get(u.id)!;
            return {
                unit_id: u.id,
                unit_name: u.name,
                aliquot: Number(u.aliquot),
                control_number: `${periodDigits}${String(i + 1).padStart(3, '0')}`,
                total_bs: fromCents(cents),
                total_usd: fromCents(Math.round(cents / input.rate)),
            };
        });

    return {
        lines,
        units,
        total_bs: fromCents(totalCents),
        total_usd: fromCents(Math.round(totalCents / input.rate)),
    };
}

/** A unit's "CUOTA" for one line, rounded the same way `calculateReceipt` splits it. */
export function lineShare(amountBs: number, aliquot: number): number {
    return fromCents(Math.round((toCents(amountBs) * aliquot) / 100));
}
