import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { InvoiceTag } from '@/core/domain/enums';
import { InvoiceStatus } from '@/modules/billing/domain/entities/Invoice';

export interface AssessmentPreview {
    building_id: string;
    current_balance: number;            // live ledger balance (may be negative)
    total_overage: number;              // max(0, -current_balance)
    already_assessed: number;           // sum of active unit-level PETTY_CASH invoice amounts
    pending_to_assess: number;          // max(0, overage - already_assessed)
    units: { id: string; name: string; amount: number }[];
}

// Integer-cents arithmetic to dodge IEEE-754 drift. The repo returns
// floats from DECIMAL columns; everything interior is cents.
const toCents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

/**
 * Preview how much to prorate across units for a given building.
 *
 * Phase 2 semantics:
 *   current_balance   = petty_cash_balance view (SUM of signed entries)
 *   total_overage     = max(0, -current_balance)  — negative balance is
 *                       the live overdraft
 *   already_assessed  = Σ amounts of ACTIVE unit-level PETTY_CASH
 *                       invoices (PENDING + PARTIAL + PAID — NOT
 *                       CANCELLED). Fixes the pre-existing bug where
 *                       CANCELLED invoices still counted.
 *   pending_to_assess = max(0, overage - already_assessed)
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
        const overageCents = Math.max(0, -balanceCents);

        // Unit-level PETTY_CASH invoices — what's already been assigned.
        // We count PENDING + PARTIAL + PAID. CANCELLED is excluded
        // intentionally (a cancelled quota isn't part of what's owed).
        const allInvoices = await this.invoiceRepo.findAll({
            building_id: buildingId,
            tag: InvoiceTag.PETTY_CASH,
        });

        let alreadyAssessedCents = 0;
        for (const inv of allInvoices) {
            if (!inv.unit_id) continue;
            if (inv.status === InvoiceStatus.CANCELLED) continue;
            alreadyAssessedCents += toCents(inv.amount);
        }

        let pendingCents = Math.max(0, overageCents - alreadyAssessedCents);

        // Clamp sub-cent dust from legacy float-stored invoices.
        if (pendingCents < 1) {
            pendingCents = 0;
        }

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
            already_assessed: fromCents(alreadyAssessedCents),
            pending_to_assess: fromCents(pendingCents),
            units: units.map((u, i) => ({
                id: u.id,
                name: u.name,
                amount: fromCents(unitCents[i]),
            })),
        };
    }
}
