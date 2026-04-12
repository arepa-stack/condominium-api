import { InvoiceStatus } from '../entities/Invoice';

export interface OverpaymentResult {
    appliedToInvoice: number;
    generatedCredit: number;
    invoiceStatus: InvoiceStatus;
}

export class OverpaymentService {
    calculate(invoiceAmount: number, invoicePaidAmount: number, paymentAmount: number): OverpaymentResult {
        const remaining = Math.max(0, invoiceAmount - invoicePaidAmount);
        const appliedToInvoice = Math.min(paymentAmount, remaining);
        const generatedCredit = Math.max(0, paymentAmount - remaining);

        let invoiceStatus: InvoiceStatus;
        const totalPaid = invoicePaidAmount + appliedToInvoice;
        if (totalPaid >= invoiceAmount) {
            invoiceStatus = InvoiceStatus.PAID;
        } else if (totalPaid > 0) {
            invoiceStatus = InvoiceStatus.PARTIAL;
        } else {
            invoiceStatus = InvoiceStatus.PENDING;
        }

        return { appliedToInvoice, generatedCredit, invoiceStatus };
    }
}
