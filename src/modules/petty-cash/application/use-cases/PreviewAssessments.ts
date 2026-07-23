import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { InvoiceTag } from '@/core/domain/enums';
import { computeCoverage } from './computeCoverage';

export interface AssessmentPreview {
    building_id: string;
    current_balance: number;            // live ledger balance (may be negative)
    total_overage: number;              // max(0, -current_balance)
    /**
     * Outstanding receivables: Σ max(0, amount - paid_amount) over active unit-level
     * PETTY_CASH invoices. Name kept for backward compatibility with the route schema.
     * Previously held "full invoice amounts"; now holds the true uncollected remainder.
     */
    already_assessed: number;
    pending_to_assess: number;          // amount still needed beyond outstanding receivables
    /**
     * Target replenishment fund amount.
     * Defaults to 0 when the building has no configured target (plain cover-the-overdraft mode).
     */
    target_fund: number;
    units: { id: string; name: string; amount: number }[];
}

// Integer-cents arithmetic to dodge IEEE-754 drift. The repo returns
// floats from DECIMAL columns; everything interior is cents.
const toCents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

/**
 * Preview how much to prorate across units for a given building.
 *
 * Phase 3 semantics (outstanding-receivables fix):
 *   current_balance   = petty_cash_balance view (SUM of signed entries)
 *   total_overage     = max(0, -current_balance) — the live overdraft
 *   already_assessed  = Σ max(0, amount - paid_amount) for ACTIVE unit-level
 *                       PETTY_CASH invoices (PENDING + PARTIAL + PAID — NOT
 *                       CANCELLED). This is the outstanding receivable, not
 *                       the full invoice amount. PAID invoices contribute 0
 *                       because their collected portion already lifted the
 *                       ledger balance via COLLECTION entries.
 *   pending_to_assess = max(0, target_fund - (balance + already_assessed))
 *                       With target_fund=0: max(0, -(balance + receivables))
 *   target_fund       = amount the board wants to maintain; 0 means cover-the-overdraft only.
 *
 * The per-unit amount is a fair-to-the-cent split; first `remainder`
 * units get one extra cent so the sum of unit amounts equals
 * pending_to_assess exactly.
 */
export class PreviewAssessments {
    constructor(
        private invoiceRepo: IInvoiceRepository,
        private unitRepo: IUnitRepository,
        private pettyCashRepo: PettyCashRepository
    ) {}

    async execute(buildingId: string): Promise<AssessmentPreview> {
        const fund = await this.pettyCashRepo.findFundByBuildingId(buildingId);
        const balance = fund
            ? await this.pettyCashRepo.getBalance(fund.id)
            : 0;

        const balanceCents = toCents(balance);

        // Use the real target_fund from the fund entity.
        // If no fund exists, fall back to 0 (cover-the-overdraft mode).
        const targetFundCents = toCents(fund?.target_fund ?? 0);

        // Unit-level PETTY_CASH invoices — what's already been assigned.
        // findAll returns paid_amount via Invoice.paid_amount getter.
        const allInvoices = await this.invoiceRepo.findAll({
            building_id: buildingId,
            tag: InvoiceTag.PETTY_CASH,
        });

        const { outstandingReceivablesCents, pendingCents: rawPendingCents } = computeCoverage({
            balanceCents,
            targetFundCents,
            invoices: allInvoices,
        });

        // Clamp sub-cent dust from legacy float-stored invoices.
        const pendingCents = rawPendingCents < 1 ? 0 : rawPendingCents;

        const overageCents = Math.max(0, -balanceCents);

        const units = await this.unitRepo.findByBuildingId(buildingId);

        const unitCents: number[] = new Array(units.length).fill(0);
        if (units.length > 0 && pendingCents > 0) {
            const base = Math.floor(pendingCents / units.length);
            const remainder = pendingCents - base * units.length;
            for (let i = 0; i < units.length; i++) {
                unitCents[i] = base + (i < remainder ? 1 : 0);
            }
        }

        return {
            building_id: buildingId,
            current_balance: balance,
            total_overage: fromCents(overageCents),
            already_assessed: fromCents(outstandingReceivablesCents),
            pending_to_assess: fromCents(pendingCents),
            // target_fund from fund entity; 0 when no fund is configured.
            target_fund: fromCents(targetFundCents),
            units: units.map((u, i) => ({
                id: u.id,
                name: u.name,
                amount: fromCents(unitCents[i]),
            })),
        };
    }
}
