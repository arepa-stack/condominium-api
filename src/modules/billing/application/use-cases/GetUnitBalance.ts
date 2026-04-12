import { IInvoiceRepository, ICreditLedgerRepository } from '../../domain/repository';

export interface UnitBalanceDTO {
    unit: string;
    totalDebt: number;
    pendingInvoices: number;
    creditBalance: number;
    netBalance: number;
    details: {
        invoiceId: string;
        amount: number;
        paid: number;
        remaining: number;
        period: string;
        status: string;
    }[];
}

export class GetUnitBalance {
    constructor(
        private invoiceRepository: IInvoiceRepository,
        private creditLedgerRepo: ICreditLedgerRepository
    ) { }

    async execute(unitId: string): Promise<UnitBalanceDTO> {
        const [invoices, creditBalance] = await Promise.all([
            this.invoiceRepository.findAll({ unit_id: unitId }),
            this.creditLedgerRepo.getBalanceForUnit(unitId)
        ]);

        const pendingInvoices = invoices.filter(inv => inv.status === 'PENDING' || inv.status === 'PARTIAL');

        let totalDebt = 0;
        const details = [];

        for (const invoice of pendingInvoices) {
            const paid = invoice.paid_amount;
            const remaining = invoice.amount - paid;

            if (remaining > 0) {
                totalDebt += remaining;
                details.push({
                    invoiceId: invoice.id,
                    amount: invoice.amount,
                    paid: paid,
                    remaining: remaining,
                    period: invoice.period,
                    status: invoice.status
                });
            }
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
