import { DomainError } from '@/core/errors';

export interface OverpaymentSplit {
    appliedToInvoice: number;
    generatedCredit: number;
}

/**
 * Pure domain service that splits a payment amount against an invoice's
 * outstanding balance. It only computes money — it does NOT decide invoice
 * status. That decision lives in Invoice.updateStatus() as the single source
 * of truth.
 */
export class OverpaymentService {
    calculate(invoiceAmount: number, invoicePaidAmount: number, paymentAmount: number): OverpaymentSplit {
        if (invoiceAmount < 0) {
            throw new DomainError('invoiceAmount cannot be negative', 'VALIDATION_ERROR', 400);
        }
        if (invoicePaidAmount < 0) {
            throw new DomainError('invoicePaidAmount cannot be negative', 'VALIDATION_ERROR', 400);
        }
        if (paymentAmount <= 0) {
            throw new DomainError('paymentAmount must be strictly positive', 'VALIDATION_ERROR', 400);
        }

        const remaining = Math.max(0, invoiceAmount - invoicePaidAmount);
        const appliedToInvoice = Math.min(paymentAmount, remaining);
        const generatedCredit = Math.max(0, paymentAmount - remaining);

        return { appliedToInvoice, generatedCredit };
    }
}
