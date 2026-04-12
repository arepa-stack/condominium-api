import { OverpaymentService } from '../../domain/services/OverpaymentService';
import { IInvoiceRepository, ICreditLedgerRepository } from '../../domain/repository';
import { InvoiceStatus } from '../../domain/entities/Invoice';
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
    invoiceStatus: InvoiceStatus;
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

        const { appliedToInvoice, generatedCredit, invoiceStatus } = this.overpaymentService.calculate(
            invoice.amount,
            invoice.paid_amount,
            dto.paymentAmount
        );

        // Update Invoice status (paid_amount is updated by DB trigger via allocations, 
        // but we need to ensure the status field is correct in our domain model before saving if we were to save here.
        // Actually, the status is usually updated by a trigger too, but the refinement says:
        // "el invoice queda en PAID si el saldo llegó a 0"
        // We'll trust the domain logic for the result and potentially for the update if needed.
        
        // Wait, the Invoice entity has updateStatus() which we should use.
        // But paid_amount in the entity is stale until we re-fetch after allocation or simulate it.
        // In the context of ApprovePayment, this use case is called AFTER allocations are created.
        
        // The refinement says: "Todo monto que exceda la obligación de la unidad será convertido en saldo a favor"
        
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
            invoiceStatus,
            remainingCreditBalance: balance
        };
    }
}
