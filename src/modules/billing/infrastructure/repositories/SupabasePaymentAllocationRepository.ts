import { IPaymentAllocationRepository, PaymentAllocationResult } from '../../domain/repository';
import { PaymentAllocation } from '../../domain/entities/PaymentAllocation';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import { PaginationFilters, toRange } from '@/core/domain/pagination';

export class SupabasePaymentAllocationRepository implements IPaymentAllocationRepository {
    private toDomain(data: unknown): PaymentAllocation {
        const d = data as any; // Cast internally for brevity when mapping raw DB
        return new PaymentAllocation({
            id: d.id,
            payment_id: d.payment_id,
            invoice_id: d.invoice_id,
            amount: d.amount,
            created_at: new Date(d.created_at)
        });
    }

    async create(allocation: PaymentAllocation): Promise<PaymentAllocation> {
        const { data, error } = await supabase
            .from('payment_allocations')
            .insert({
                id: allocation.id,
                payment_id: allocation.payment_id,
                invoice_id: allocation.invoice_id,
                amount: allocation.amount,
                created_at: allocation.created_at
            })
            .select()
            .single();

        if (error) {
            throw new DomainError('Error creating allocation: ' + error.message, 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async delete(allocationId: string): Promise<void> {
        const { error } = await supabase
            .from('payment_allocations')
            .delete()
            .eq('id', allocationId);

        if (error) {
            throw new DomainError('Error deleting allocation: ' + error.message, 'DB_ERROR', 500);
        }
    }

    async findByPaymentId(paymentId: string): Promise<PaymentAllocation[]> {
        const { data, error } = await supabase
            .from('payment_allocations')
            .select('*')
            .eq('payment_id', paymentId);

        if (error) throw new DomainError('Error fetching allocations', 'DB_ERROR', 500);
        return data.map(this.toDomain);
    }

    async findByInvoiceId(invoiceId: string): Promise<PaymentAllocation[]> {
        const { data, error } = await supabase
            .from('payment_allocations')
            .select('*')
            .eq('invoice_id', invoiceId);

        if (error) throw new DomainError('Error fetching allocations', 'DB_ERROR', 500);
        return data.map(this.toDomain);
    }

    async findByInvoiceIds(invoiceIds: string[]): Promise<PaymentAllocation[]> {
        if (invoiceIds.length === 0) return [];

        const { data, error } = await supabase
            .from('payment_allocations')
            .select('*')
            .in('invoice_id', invoiceIds);

        if (error) throw new DomainError('Error fetching allocations', 'DB_ERROR', 500);
        return (data || []).map(this.toDomain);
    }

    async findPaymentsByInvoiceId(invoiceId: string): Promise<PaymentAllocationResult[]> {
        const { data, error } = await supabase
            .from('payment_allocations')
            .select('*, payments(*)')
            .eq('invoice_id', invoiceId);

        if (error) throw new DomainError('Error fetching payments for invoice', 'DB_ERROR', 500);

        // Map to return the payment object mixed with allocation info?
        // User asked for "related payment object". 
        // We can return the Payment object enriched with "allocated_amount_explicitly_for_this_invoice"?

        return (data || []).map((allocation: any) => {
            return {
                ...allocation.payments,
                allocated_amount: allocation.amount, // The part of this payment that went to this invoice
                allocation_id: allocation.id,
                allocated_at: allocation.created_at
            };
        });
    }

    async findInvoicesByPaymentId(paymentId: string): Promise<any[]> {
        const { data, error } = await supabase
            .from('payment_allocations')
            .select('*, invoices(*)')
            .eq('payment_id', paymentId);

        if (error) throw new DomainError('Error fetching invoices for payment', 'DB_ERROR', 500);

        return (data || []).map((allocation: any) => {
            return {
                ...allocation.invoices,
                allocated_amount: allocation.amount, // The part of this payment that went to this invoice
                allocation_id: allocation.id,
                allocated_at: allocation.created_at
            };
        });
    }

    async findPaymentsByInvoiceIdPaginated(
        invoiceId: string,
        pagination: PaginationFilters
    ): Promise<{ items: PaymentAllocationResult[]; total: number }> {
        const { from, to } = toRange(pagination);
        const { data, count, error } = await supabase
            .from('payment_allocations')
            .select('*, payments(*)', { count: 'exact' })
            .eq('invoice_id', invoiceId)
            .range(from, to);

        if (error) throw new DomainError('Error fetching payments for invoice', 'DB_ERROR', 500);

        const items = (data || []).map((allocation: any) => ({
            ...allocation.payments,
            allocated_amount: allocation.amount,
            allocation_id: allocation.id,
            allocated_at: allocation.created_at,
        }));

        return { items, total: count || 0 };
    }

    async findInvoicesByPaymentIdPaginated(
        paymentId: string,
        pagination: PaginationFilters
    ): Promise<{ items: any[]; total: number }> {
        const { from, to } = toRange(pagination);
        const { data, count, error } = await supabase
            .from('payment_allocations')
            .select('*, invoices(*)', { count: 'exact' })
            .eq('payment_id', paymentId)
            .range(from, to);

        if (error) throw new DomainError('Error fetching invoices for payment', 'DB_ERROR', 500);

        const items = (data || []).map((allocation: any) => ({
            ...allocation.invoices,
            allocated_amount: allocation.amount,
            allocation_id: allocation.id,
            allocated_at: allocation.created_at,
        }));

        return { items, total: count || 0 };
    }
}
