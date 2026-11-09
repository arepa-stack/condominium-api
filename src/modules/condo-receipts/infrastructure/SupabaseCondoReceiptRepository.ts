import { DomainError } from '@/core/errors';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import type {
    CondoReceipt,
    ExpenseCode,
    ExpenseInvoiceFile,
    ICondoReceiptRepository,
    IExpenseInvoiceStorage,
    MonthlyExpense,
    NewCondoReceipt,
    NewMonthlyExpense,
    UnitStatement,
} from '../domain/repository';

const dbError = (what: string, error: { message: string }) =>
    new DomainError(`Error ${what}: ${error.message}`, 'DB_ERROR', 500);

const EXPENSE_SELECT = '*, expense_codes(code, description)';
const RECEIPT_SUMMARY = 'id, building_id, period, concept_id, reserve_percent, exchange_rate, rate_source, rate_date, total_bs, total_usd, created_at';

function toExpense(row: any): MonthlyExpense {
    return {
        id: row.id,
        building_id: row.building_id,
        period: row.period,
        code_id: row.code_id,
        code: row.expense_codes?.code ?? '',
        code_description: row.expense_codes?.description ?? '',
        detail: row.detail,
        amount: Number(row.amount),
        currency: row.currency,
        expense_date: row.expense_date,
        invoice_path: row.invoice_path,
        created_at: row.created_at,
    };
}

function toReceipt(row: any): CondoReceipt {
    return {
        ...row,
        reserve_percent: Number(row.reserve_percent),
        exchange_rate: Number(row.exchange_rate),
        total_bs: Number(row.total_bs),
        total_usd: Number(row.total_usd),
    };
}

export class SupabaseCondoReceiptRepository implements ICondoReceiptRepository {
    async listCodes(buildingId: string): Promise<ExpenseCode[]> {
        const { data, error } = await supabase
            .from('expense_codes')
            .select('id, building_id, code, description')
            .eq('building_id', buildingId)
            .order('code');
        if (error) throw dbError('fetching expense codes', error);
        return data;
    }

    async findCode(id: string): Promise<ExpenseCode | null> {
        const { data, error } = await supabase
            .from('expense_codes')
            .select('id, building_id, code, description')
            .eq('id', id)
            .maybeSingle();
        if (error) throw dbError('fetching expense code', error);
        return data;
    }

    async createCode(code: Omit<ExpenseCode, 'id'>): Promise<ExpenseCode> {
        const { data, error } = await supabase
            .from('expense_codes')
            .insert(code)
            .select('id, building_id, code, description')
            .single();
        if (error?.code === '23505') {
            throw new DomainError(`Expense code ${code.code} already exists`, 'CONFLICT', 409);
        }
        if (error) throw dbError('creating expense code', error);
        return data;
    }

    async listExpenses(buildingId: string, period: string): Promise<MonthlyExpense[]> {
        const { data, error } = await supabase
            .from('monthly_expenses')
            .select(EXPENSE_SELECT)
            .eq('building_id', buildingId)
            .eq('period', period)
            .order('expense_date')
            .order('created_at');
        if (error) throw dbError('fetching expenses', error);
        return data.map(toExpense);
    }

    async findExpense(id: string): Promise<MonthlyExpense | null> {
        const { data, error } = await supabase.from('monthly_expenses').select(EXPENSE_SELECT).eq('id', id).maybeSingle();
        if (error) throw dbError('fetching expense', error);
        return data ? toExpense(data) : null;
    }

    async createExpense(expense: NewMonthlyExpense): Promise<MonthlyExpense> {
        const { data, error } = await supabase.from('monthly_expenses').insert(expense).select(EXPENSE_SELECT).single();
        if (error) throw dbError('creating expense', error);
        return toExpense(data);
    }

    async deleteExpense(id: string): Promise<void> {
        const { error } = await supabase.from('monthly_expenses').delete().eq('id', id);
        if (error) throw dbError('deleting expense', error);
    }

    async findReceipt(buildingId: string, period: string): Promise<CondoReceipt | null> {
        const { data, error } = await supabase
            .from('condo_receipts')
            .select('*')
            .eq('building_id', buildingId)
            .eq('period', period)
            .maybeSingle();
        if (error) throw dbError('fetching receipt', error);
        return data ? toReceipt(data) : null;
    }

    async listReceipts(buildingId: string) {
        const { data, error } = await supabase
            .from('condo_receipts')
            .select(RECEIPT_SUMMARY)
            .eq('building_id', buildingId)
            .order('period', { ascending: false });
        if (error) throw dbError('fetching receipts', error);
        return data.map(toReceipt);
    }

    async createReceipt(receipt: NewCondoReceipt): Promise<CondoReceipt> {
        const { data, error } = await supabase.from('condo_receipts').insert(receipt).select('*').single();
        if (error?.code === '23505') {
            throw new DomainError(`The receipt for ${receipt.period} was already generated`, 'CONFLICT', 409);
        }
        if (error) throw dbError('creating receipt', error);
        return toReceipt(data);
    }

    async deleteReceipt(id: string): Promise<void> {
        const { error } = await supabase.from('condo_receipts').delete().eq('id', id);
        if (error) throw dbError('deleting receipt', error);
    }

    async getUnitStatement(unitId: string): Promise<UnitStatement> {
        const [owners, invoices, payments] = await Promise.all([
            supabase
                .from('profile_units')
                .select('is_primary, profiles!inner(name, deleted_at)')
                .eq('unit_id', unitId)
                .eq('status', 'active')
                .is('profiles.deleted_at', null),
            supabase
                .from('invoices')
                .select('amount, paid_amount')
                .eq('unit_id', unitId)
                .in('status', ['PENDING', 'PARTIAL']),
            supabase
                .from('payments')
                .select('payment_date, amount, original_currency, original_amount')
                .eq('unit_id', unitId)
                .eq('status', 'APPROVED')
                .order('payment_date', { ascending: false })
                .limit(4),
        ]);
        if (owners.error) throw dbError('fetching unit owners', owners.error);
        if (invoices.error) throw dbError('fetching unit invoices', invoices.error);
        if (payments.error) throw dbError('fetching unit payments', payments.error);

        const debtCents = invoices.data.reduce(
            (sum, inv) => sum + Math.round((Number(inv.amount) - Number(inv.paid_amount ?? 0)) * 100), 0);

        return {
            owners: [...owners.data]
                .sort((a: any, b: any) => Number(b.is_primary) - Number(a.is_primary))
                .map((row: any) => row.profiles.name),
            debt_usd: debtCents / 100,
            pending_invoices: invoices.data.length,
            last_payments: payments.data.map(p => ({
                payment_date: p.payment_date,
                amount: Number(p.amount),
                original_currency: p.original_currency,
                original_amount: p.original_amount === null ? null : Number(p.original_amount),
            })),
        };
    }
}

const BUCKET = 'expense-invoices';
const MAX_BYTES = 10 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
};

export class ExpenseInvoiceStorage implements IExpenseInvoiceStorage {
    async upload(buildingId: string, period: string, file: ExpenseInvoiceFile): Promise<string> {
        const ext = EXTENSIONS[file.mime];
        if (!ext) throw new DomainError(`Mime type ${file.mime} not allowed (PDF, PNG, JPG, WEBP)`, 'INVALID_FILE_TYPE', 400);
        if (file.bytes.length > MAX_BYTES) throw new DomainError('Invoice file exceeds 10 MB limit', 'FILE_TOO_LARGE', 400);

        const path = `${buildingId}/${period}/${crypto.randomUUID()}.${ext}`;
        const { data, error } = await supabase.storage
            .from(BUCKET)
            .upload(path, file.bytes, { contentType: file.mime, upsert: false });
        if (error) throw new DomainError('Error uploading invoice: ' + error.message, 'STORAGE_ERROR', 500);
        return data.path;
    }

    async remove(path: string): Promise<void> {
        const { error } = await supabase.storage.from(BUCKET).remove([path]);
        if (error) throw new DomainError('Error deleting invoice: ' + error.message, 'STORAGE_ERROR', 500);
    }

    async signedUrls(paths: string[], ttlSeconds = 3600): Promise<Record<string, string>> {
        if (paths.length === 0) return {};
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, ttlSeconds);
        if (error) throw new DomainError('Error generating invoice URLs: ' + error.message, 'STORAGE_ERROR', 500);
        return Object.fromEntries(data.filter(d => d.path && d.signedUrl).map(d => [d.path!, d.signedUrl]));
    }
}
