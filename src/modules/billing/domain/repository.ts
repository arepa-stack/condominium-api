import { Invoice } from './entities/Invoice';
import { PaymentAllocation } from './entities/PaymentAllocation';
import { CreditLedgerEntry } from './entities/CreditLedgerEntry';
import { InvoiceTag } from '@/core/domain/enums';

export interface AdminInvoiceResult {
    id: string;
    amount: number;
    paid_amount: number;
    status: string;
    period: string;
    year: number;
    month: number;
    issue_date: string;
    receipt_number?: string;
    created_at: string;
    unit: {
        id: string;
        name: string;
    };
    user: {
        id: string;
        name: string;
    } | null;
}

export interface PaymentAllocationResult {
    id: string;
    amount: number;
    status: string;
    payment_date: string;
    method: string;
    reference?: string;
    allocated_amount: number;
    allocation_id: string;
    allocated_at: Date;
    user?: {
        id: string;
        name: string;
    };
}

export interface FindAllInvoicesFilters {
    unit_id?: string;
    building_id?: string;
    user_id?: string;
    status?: string;
    period?: string;
    type?: string;
    tag?: InvoiceTag;
}

export interface IInvoiceRepository {
    create(invoice: Invoice): Promise<Invoice>;
    findById(id: string): Promise<Invoice | null>;
    findAll(filters?: FindAllInvoicesFilters): Promise<Invoice[]>;
    findInvoicesForAdmin(filters?: FindAllInvoicesFilters): Promise<AdminInvoiceResult[]>;
    findByBuildingId(buildingId: string, filters?: FindAllInvoicesFilters): Promise<AdminInvoiceResult[]>;
    update(invoice: Invoice): Promise<Invoice>;
    createBatch(invoices: Invoice[]): Promise<Invoice[]>;
}

export interface ICreditLedgerRepository {
    addCredit(entry: CreditLedgerEntry): Promise<CreditLedgerEntry>;
    deductCredit(entry: CreditLedgerEntry): Promise<CreditLedgerEntry>;
    getBalanceForUnit(unitId: string): Promise<number>;
    getEntriesForUnit(unitId: string): Promise<CreditLedgerEntry[]>;
    findByReferenceId(referenceId: string): Promise<CreditLedgerEntry[]>;
}

export interface IPaymentAllocationRepository {
    create(allocation: PaymentAllocation): Promise<PaymentAllocation>;
    delete(allocationId: string): Promise<void>;
    findByPaymentId(paymentId: string): Promise<PaymentAllocation[]>;
    findByInvoiceId(invoiceId: string): Promise<PaymentAllocation[]>;
    findPaymentsByInvoiceId(invoiceId: string): Promise<PaymentAllocationResult[]>; // Returns Payment details joined
    findInvoicesByPaymentId(paymentId: string): Promise<any[]>; // Returns Invoice details joined
}
