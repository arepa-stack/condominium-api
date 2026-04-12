import { OverpaymentService } from '../../domain/services/OverpaymentService';
import { IInvoiceRepository, ICreditLedgerRepository } from '../../domain/repository';
import { CreditLedgerEntry, CreditLedgerReferenceType } from '../../domain/entities/CreditLedgerEntry';
import { NotFoundError } from '@/core/errors';

export interface ProcessOverpaymentDTO {
    invoiceId: string;
    paymentId: string;
    paymentAmount: number;
}

export interface ProcessOverpaymentResult {
    appliedToInvoice: number;
    generatedUnitCredit: number;
    remainingCreditBalance: number;
}

export class ProcessInvoiceOverpayment {
    constructor(
        private invoiceRepo: IInvoiceRepository,
        private creditLedgerRepo: ICreditLedgerRepository,
        private overpaymentService: OverpaymentService = new OverpaymentService()
    ) { }

    async execute(dto: ProcessOverpaymentDTO): Promise<ProcessOverpaymentResult> {
        const invoice = await this.invoiceRepo.findById(dto.invoiceId);
        if (!invoice) {
            throw new NotFoundError(`Invoice ${dto.invoiceId} not found`);
        }

        // paid_amount here is the PRE-application state — the domain owns
        // recalculation now that the DB triggers have been dropped. The
        // caller (ApprovePayment loop) invokes this use case once per
        // allocation, and each invocation reads the latest persisted state.
        const { appliedToInvoice, generatedCredit } = this.overpaymentService.calculate(
            invoice.amount,
            invoice.paid_amount,
            dto.paymentAmount
        );

        if (appliedToInvoice > 0) {
            invoice.addPayment(appliedToInvoice);
            invoice.updateStatus();
            await this.invoiceRepo.update(invoice);
        }

        if (generatedCredit > 0) {
            if (!invoice.unit_id) {
                // TODO(spec): building-level PETTY_CASH overpayment policy is
                // undefined. The excess is currently dropped. Surface it so
                // silent data loss is at least observable in logs.
                console.warn(
                    `[ProcessInvoiceOverpayment] Dropping ${generatedCredit} excess on building-level invoice ${invoice.id} (payment ${dto.paymentId}) — no unit to credit.`
                );
            } else if (await this.hasExistingCreditForInvoice(dto.paymentId, invoice.id)) {
                // Idempotency: the caller (ApprovePayment) may retry. Best-effort
                // check — races are possible between parallel runs. The real fix
                // is either (a) adding invoice_id to unit_credit_ledger with a
                // UNIQUE(reference_id, invoice_id) constraint, or (b) making
                // ApprovePayment short-circuit when the payment is already
                // APPROVED (done in cd6daed). This guard prevents the remaining
                // race case where two parallel retries beat the short-circuit.
            } else {
                const creditEntry = new CreditLedgerEntry({
                    id: crypto.randomUUID(),
                    unit_id: invoice.unit_id,
                    amount: generatedCredit,
                    reason: `Excedente de pago en factura ${invoice.id}`,
                    reference_type: CreditLedgerReferenceType.PAYMENT,
                    reference_id: dto.paymentId
                });
                await this.creditLedgerRepo.addCredit(creditEntry);
            }
        }

        const balance = invoice.unit_id ? await this.creditLedgerRepo.getBalanceForUnit(invoice.unit_id) : 0;

        return {
            appliedToInvoice,
            generatedUnitCredit: generatedCredit,
            remainingCreditBalance: balance
        };
    }

    private async hasExistingCreditForInvoice(paymentId: string, invoiceId: string): Promise<boolean> {
        const existing = await this.creditLedgerRepo.findByReferenceId(paymentId);
        return existing.some(e =>
            e.reference_type === CreditLedgerReferenceType.PAYMENT &&
            e.reason.includes(invoiceId)
        );
    }
}
