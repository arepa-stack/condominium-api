import { IInvoiceRepository, ICreditLedgerRepository } from '../../domain/repository';
import { InvoiceStatus } from '../../domain/entities/Invoice';

export interface UnitBalanceDetailDTO {
    invoiceId: string;
    amount: number;
    paid: number;
    remaining: number;
    period: string;
    status: string;
}

export interface UnitBalanceDTO {
    unit: string;
    totalDebt: number;
    pendingInvoices: number;
    creditBalance: number;
    /**
     * Real debt after applying the credit balance, clamped to zero.
     *
     * A negative "net debt" is not a debt — it is a surplus, and the
     * surplus is already exposed via `creditBalance`. We intentionally
     * clamp here so the frontend never has to interpret a negative
     * "debt" value. The UI can still display the creditBalance
     * indicator independently when it is > 0.
     */
    netBalance: number;
    details: UnitBalanceDetailDTO[];
}

export class GetUnitBalance {
    constructor(
        private invoiceRepository: IInvoiceRepository,
        private creditLedgerRepo: ICreditLedgerRepository
    ) { }

    async execute(unitId: string): Promise<UnitBalanceDTO> {
        // Scope is intentional: only unit-level invoices. Building-level
        // PETTY_CASH invoices represent the raw expense (e.g. "arreglo
        // de ascensor $1000") and are not a resident-facing liability —
        // the resident's share comes in as a per-unit assessment with a
        // unit_id, which is what this query returns.
        const [invoices, creditBalance] = await Promise.all([
            this.invoiceRepository.findAll({ unit_id: unitId }),
            this.creditLedgerRepo.getBalanceForUnit(unitId)
        ]);

        const openInvoices = invoices.filter(inv =>
            inv.status === InvoiceStatus.PENDING ||
            inv.status === InvoiceStatus.PARTIAL
        );

        let totalDebt = 0;
        const details: UnitBalanceDetailDTO[] = [];

        for (const invoice of openInvoices) {
            // remainingBalance is clamped at 0 by the domain, and PARTIAL
            // invoices are guaranteed to have 0 < paid < amount, so no
            // defensive `remaining > 0` filter is needed here.
            const remaining = invoice.remainingBalance;
            totalDebt += remaining;
            details.push({
                invoiceId: invoice.id,
                amount: invoice.amount,
                paid: invoice.paid_amount,
                remaining,
                period: invoice.period,
                status: invoice.status
            });
        }

        return {
            unit: unitId,
            totalDebt,
            pendingInvoices: details.length,
            creditBalance,
            netBalance: Math.max(0, totalDebt - creditBalance),
            details
        };
    }
}
