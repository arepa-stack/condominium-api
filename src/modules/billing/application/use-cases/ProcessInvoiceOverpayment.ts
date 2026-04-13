import { OverpaymentService } from '../../domain/services/OverpaymentService';
import { IInvoiceRepository, ICreditLedgerRepository } from '../../domain/repository';
import { CreditLedgerEntry, CreditLedgerReferenceType } from '../../domain/entities/CreditLedgerEntry';
import { InvoiceStatus } from '../../domain/entities/Invoice';
import { DomainError, NotFoundError } from '@/core/errors';

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

    /**
     * Pre-flight validation. Throws if the invoice cannot accept a payment
     * at the moment of the call. Intended to run BEFORE ApprovePayment
     * persists the payment as APPROVED, so a bad allocation bails out
     * without leaving behind a zombie state (payment APPROVED + invoice
     * untouched + idempotency guard hiding recoveries).
     *
     * The pre-check exists as a defensive fix until ApprovePayment is
     * wrapped in a real transaction (see REVIEW_BACKLOG.md item about
     * transaction boundaries).
     */
    async assertInvoiceCanAcceptPayment(invoiceId: string): Promise<void> {
        const invoice = await this.invoiceRepo.findById(invoiceId);
        if (!invoice) {
            throw new NotFoundError(`Invoice ${invoiceId} not found`);
        }
        if (invoice.status === InvoiceStatus.CANCELLED) {
            throw new DomainError(
                `Cannot accept payment on cancelled invoice ${invoiceId}. ` +
                `Reject the payment or re-allocate it to an active invoice first.`,
                'INVALID_INVOICE_STATE',
                409
            );
        }
    }

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
            console.log(
                `[ProcessInvoiceOverpayment] Overpayment detected: invoice=${invoice.id} ` +
                `unit_id=${invoice.unit_id ?? 'NULL'} applied=${appliedToInvoice} credit=${generatedCredit}`
            );

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
                console.log(
                    `[ProcessInvoiceOverpayment] Skipping addCredit — existing entry found for payment=${dto.paymentId} invoice=${invoice.id}`
                );
            } else {
                const creditEntry = new CreditLedgerEntry({
                    id: crypto.randomUUID(),
                    unit_id: invoice.unit_id,
                    amount: generatedCredit,
                    reason: `Excedente de pago en factura ${invoice.id}`,
                    reference_type: CreditLedgerReferenceType.PAYMENT,
                    reference_id: dto.paymentId
                });
                console.log(
                    `[ProcessInvoiceOverpayment] Persisting credit entry: id=${creditEntry.id} unit=${creditEntry.unit_id} amount=${creditEntry.amount}`
                );
                await this.creditLedgerRepo.addCredit(creditEntry);
                console.log(
                    `[ProcessInvoiceOverpayment] Credit entry persisted successfully`
                );
            }
        } else {
            console.log(
                `[ProcessInvoiceOverpayment] No overpayment: invoice=${invoice.id} applied=${appliedToInvoice} credit=0`
            );
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

    /**
     * Persists the unallocated portion of a payment as a direct credit on
     * the unit. Called by ApprovePayment after the allocation loop has
     * processed each invoice, when `payment.amount > sum(allocations)`.
     *
     * Semantically this is distinct from invoice-level overpayment:
     * - Invoice overpayment = allocation.amount > invoice.remaining, split
     *   by the domain via OverpaymentService.
     * - Unallocated surplus = the resident paid more than they chose to
     *   assign to specific invoices. The excess is their credit balance.
     *
     * Both land in `unit_credit_ledger` with reference_type=PAYMENT and
     * reference_id=payment.id, but the `reason` string marks which is
     * which so ReversePayment and audit queries can distinguish.
     */
    async processUnallocatedSurplus(paymentId: string, unitId: string, amount: number): Promise<void> {
        if (amount <= 0) return;

        if (await this.hasExistingSurplusForPayment(paymentId)) {
            console.log(
                `[ProcessInvoiceOverpayment] Skipping unallocated surplus — existing entry for payment=${paymentId}`
            );
            return;
        }

        const creditEntry = new CreditLedgerEntry({
            id: crypto.randomUUID(),
            unit_id: unitId,
            amount,
            reason: `Excedente no asignado del pago ${paymentId}`,
            reference_type: CreditLedgerReferenceType.PAYMENT,
            reference_id: paymentId
        });

        console.log(
            `[ProcessInvoiceOverpayment] Persisting unallocated surplus: id=${creditEntry.id} unit=${unitId} amount=${amount}`
        );
        await this.creditLedgerRepo.addCredit(creditEntry);
        console.log(
            `[ProcessInvoiceOverpayment] Unallocated surplus persisted successfully`
        );
    }

    private async hasExistingSurplusForPayment(paymentId: string): Promise<boolean> {
        const existing = await this.creditLedgerRepo.findByReferenceId(paymentId);
        return existing.some(e =>
            e.reference_type === CreditLedgerReferenceType.PAYMENT &&
            e.reason.startsWith('Excedente no asignado')
        );
    }
}
