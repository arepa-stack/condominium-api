import { Invoice } from '@/modules/billing/domain/entities/Invoice';
import { InvoiceStatus } from '@/modules/billing/domain/entities/Invoice';

/**
 * Integer-cents arithmetic helpers to avoid IEEE-754 drift.
 */
const toCents = (n: number): number => Math.round(n * 100);

export interface ComputeCoverageInput {
    /** Ledger balance in integer cents. Negative = overdraft. */
    balanceCents: number;
    /**
     * Target replenishment fund in integer cents.
     * When 0 (Slice A default), this operates in "overage mode":
     *   pending = max(0, -balance - outstanding_receivables)
     * Slice B adds the DB column and passes the real target.
     */
    targetFundCents: number;
    /**
     * All PETTY_CASH unit-level invoices for the building (any status).
     * computeCoverage will filter CANCELLED and invoices without unit_id,
     * then sum the outstanding remainder (amount - paid_amount) for the rest.
     */
    invoices: Invoice[];
}

export interface ComputeCoverageResult {
    /** Σ max(0, amount - paid_amount) for active unit-level PETTY_CASH invoices. */
    outstandingReceivablesCents: number;
    /**
     * Amount still needed to bring the fund to target (or eliminate the overdraft
     * when targetFundCents = 0), net of outstanding receivables.
     *
     * Formula:
     *   pending = max(0, targetFundCents - (balanceCents + outstandingReceivablesCents))
     */
    pendingCents: number;
}

/**
 * Pure function: computes how much still needs to be assessed to reach the
 * target fund balance, accounting for the outstanding portions of existing
 * PETTY_CASH unit invoices.
 *
 * This function is side-effect free and stable. Slice B reuses it from
 * RegisterPettyCashExpense without modification.
 *
 * Coverage equation:
 *   outstanding_receivables = Σ max(0, amount - paid_amount)
 *       over inv where tag=PETTY_CASH, unit_id != null, status != CANCELLED
 *
 *   pending = max(0, target_fund - (balance + outstanding_receivables))
 *
 * When targetFundCents = 0 and balanceCents < 0:
 *   pending = max(0, 0 - (balance + receivables))
 *           = max(0, -(balance + receivables))
 * which correctly surfaces the net overdraft not yet covered by outstanding invoices.
 */
export function computeCoverage(input: ComputeCoverageInput): ComputeCoverageResult {
    const { balanceCents, targetFundCents, invoices } = input;

    let outstandingReceivablesCents = 0;
    for (const inv of invoices) {
        // Skip invoices without a unit (building-level entries not relevant here)
        if (!inv.unit_id) continue;
        // CANCELLED invoices are fully excluded — their remainder returns to pool
        if (inv.status === InvoiceStatus.CANCELLED) continue;

        const remainingCents = Math.max(0, toCents(inv.amount) - toCents(inv.paid_amount));
        outstandingReceivablesCents += remainingCents;
    }

    const coveredCents = balanceCents + outstandingReceivablesCents;
    const rawPendingCents = targetFundCents - coveredCents;
    const pendingCents = Math.max(0, rawPendingCents);

    return { outstandingReceivablesCents, pendingCents };
}
