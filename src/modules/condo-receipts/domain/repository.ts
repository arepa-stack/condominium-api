import type { ExpenseCurrency, ReceiptLine, ReceiptUnit } from './ReceiptCalculator';

export interface ExpenseCode {
    id: string;
    building_id: string;
    code: string;
    description: string;
}

export interface MonthlyExpense {
    id: string;
    building_id: string;
    period: string;
    code_id: string;
    code: string;
    code_description: string;
    detail: string | null;
    amount: number;
    currency: ExpenseCurrency;
    expense_date: string;
    invoice_path: string | null;
    created_at: string;
}

export interface NewMonthlyExpense {
    building_id: string;
    period: string;
    code_id: string;
    detail: string | null;
    amount: number;
    currency: ExpenseCurrency;
    expense_date: string;
    invoice_path: string | null;
    created_by: string;
}

export interface CondoReceipt {
    id: string;
    building_id: string;
    period: string;
    concept_id: string;
    reserve_percent: number;
    exchange_rate: number;
    rate_source: string;
    rate_date: string;
    total_bs: number;
    total_usd: number;
    lines: ReceiptLine[];
    units: ReceiptUnit[];
    created_at: string;
}

export type NewCondoReceipt = Omit<CondoReceipt, 'id' | 'created_at'> & { created_by: string };

export interface ExpenseInvoiceFile {
    name: string;
    bytes: Uint8Array;
    mime: string;
}

/** What the printed notice shows about the unit beyond the receipt snapshot. */
export interface UnitStatement {
    owners: string[];
    /** Unpaid USD of the unit's non-cancelled invoices (includes this period). */
    debt_usd: number;
    pending_invoices: number;
    last_payments: { payment_date: string; amount: number; original_currency: string; original_amount: number | null }[];
}

export interface ICondoReceiptRepository {
    listCodes(buildingId: string): Promise<ExpenseCode[]>;
    findCode(id: string): Promise<ExpenseCode | null>;
    createCode(code: Omit<ExpenseCode, 'id'>): Promise<ExpenseCode>;
    createCodes(codes: Omit<ExpenseCode, 'id'>[]): Promise<ExpenseCode[]>;

    listExpenses(buildingId: string, period: string): Promise<MonthlyExpense[]>;
    findExpense(id: string): Promise<MonthlyExpense | null>;
    createExpense(expense: NewMonthlyExpense): Promise<MonthlyExpense>;
    deleteExpense(id: string): Promise<void>;

    findReceipt(buildingId: string, period: string): Promise<CondoReceipt | null>;
    listReceipts(buildingId: string): Promise<Omit<CondoReceipt, 'lines' | 'units'>[]>;
    createReceipt(receipt: NewCondoReceipt): Promise<CondoReceipt>;
    deleteReceipt(id: string): Promise<void>;

    getUnitStatement(unitId: string): Promise<UnitStatement>;
}

export interface IExpenseInvoiceStorage {
    upload(buildingId: string, period: string, file: ExpenseInvoiceFile): Promise<string>;
    remove(path: string): Promise<void>;
    signedUrls(paths: string[]): Promise<Record<string, string>>;
}
