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
    private overpaymentService: OverpaymentService;

    constructor(
        private invoiceRepo: IInvoiceRepository,
        private creditLedgerRepo: ICreditLedgerRepository
    ) {
        this.overpaymentService = new OverpaymentService();
    }

    async execute(dto: ProcessOverpaymentDTO): Promise<ProcessOverpaymentResult> {
        const invoice = await this.invoiceRepo.findById(dto.invoiceId);
        if (!invoice) {
            throw new NotFoundError(`Invoice ${dto.invoiceId} not found`);
        }

        const { appliedToInvoice, generatedCredit } = this.overpaymentService.calculate(
            invoice.amount,
            invoice.paid_amount,
            dto.paymentAmount
        );

        if (generatedCredit > 0 && invoice.unit_id) {
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

        const balance = invoice.unit_id ? await this.creditLedgerRepo.getBalanceForUnit(invoice.unit_id) : 0;

        return {
            appliedToInvoice,
            generatedUnitCredit: generatedCredit,
            remainingCreditBalance: balance
        };
    }
}
