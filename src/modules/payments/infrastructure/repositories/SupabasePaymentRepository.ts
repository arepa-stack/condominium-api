import { Payment, PaymentProps } from '../../domain/entities/Payment';
import { IPaymentRepository, FindAllPaymentsFilters } from '../../domain/repository';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import { PaymentStatus, PaymentMethod } from '@/core/domain/enums';
import { PaginationFilters, toRange } from '@/core/domain/pagination';

const SELECT_QUERY = '*, user:profiles!user_id(id, name), processor:profiles!processed_by(id, name)';

export class SupabasePaymentRepository implements IPaymentRepository {
    private toDomain(data: any): Payment {
        const props: PaymentProps = {
            id: data.id,
            user_id: data.user_id,
            building_id: data.building_id,
            amount: parseFloat(data.amount),
            original_currency: data.original_currency ?? 'USD',
            original_amount: data.original_amount != null ? parseFloat(data.original_amount) : null,
            exchange_rate: data.exchange_rate != null ? parseFloat(data.exchange_rate) : null,
            rate_source: data.rate_source ?? null,
            rate_date: data.rate_date ?? null,
            payment_date: new Date(data.payment_date),
            method: data.method as PaymentMethod,
            reference: data.reference,
            bank: data.bank,
            proof_url: data.proof_url,
            status: data.status as PaymentStatus,
            processed_by: data.processed_by,
            processed_at: data.processed_at ? new Date(data.processed_at) : undefined,
            unit_id: data.unit_id,
            notes: data.notes,
            created_at: new Date(data.created_at),
            updated_at: new Date(data.updated_at),
            user: data.user ? {
                id: data.user.id,
                name: data.user.name
            } : undefined,
            processor: data.processor ? {
                id: data.processor.id,
                name: data.processor.name
            } : undefined
        };
        return new Payment(props);
    }

    private toPersistence(payment: Payment): any {
        return {
            id: payment.id,
            user_id: payment.user_id,
            building_id: payment.building_id,
            amount: payment.amount,
            original_currency: payment.original_currency,
            original_amount: payment.original_amount,
            exchange_rate: payment.exchange_rate,
            rate_source: payment.rate_source,
            rate_date: payment.rate_date,
            payment_date: payment.payment_date,
            method: payment.method,
            reference: payment.reference,
            bank: payment.bank,
            proof_url: payment.proof_url,
            status: payment.status,
            processed_by: payment.processed_by,
            processed_at: payment.processed_at,
            unit_id: payment.unit_id,
            notes: payment.notes,
            updated_at: payment.updated_at,
        };
    }

    async create(payment: Payment): Promise<Payment> {
        const persistenceData = {
            ...this.toPersistence(payment),
            created_at: payment.created_at,
        };

        const { data, error } = await supabase
            .from('payments')
            .insert(persistenceData)
            .select(SELECT_QUERY)
            .single();

        if (error) {
            throw new DomainError('Error creating payment: ' + error.message, 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async findById(id: string): Promise<Payment | null> {
        const { data, error } = await supabase
            .from('payments')
            .select(SELECT_QUERY)
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching payment', 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async findByIds(ids: string[]): Promise<Payment[]> {
        if (ids.length === 0) return [];

        const { data, error } = await supabase
            .from('payments')
            .select(SELECT_QUERY)
            .in('id', ids);

        if (error) throw new DomainError('Error fetching payments', 'DB_ERROR', 500);
        return (data || []).map(this.toDomain);
    }

    async findByUserId(userId: string, year?: number): Promise<Payment[]> {
        let query = supabase
            .from('payments')
            .select(SELECT_QUERY)
            .eq('user_id', userId)
            .order('payment_date', { ascending: false });

        if (year) {
            query = this.applyYearFilter(query, year);
        }

        const { data, error } = await query;
        if (error) throw new DomainError('Error fetching payments', 'DB_ERROR', 500);

        return data.map(this.toDomain);
    }

    async findByUnit(unitId: string, year?: number): Promise<Payment[]> {
        let query = supabase
            .from('payments')
            .select(SELECT_QUERY)
            .eq('unit_id', unitId)
            .order('payment_date', { ascending: false });

        if (year) {
            query = this.applyYearFilter(query, year);
        }

        const { data, error } = await query;
        if (error) throw new DomainError('Error fetching payments for unit', 'DB_ERROR', 500);

        return data.map(this.toDomain);
    }

    async update(payment: Payment): Promise<Payment> {
        const { data, error } = await supabase
            .from('payments')
            .update(this.toPersistence(payment))
            .eq('id', payment.id)
            .select(SELECT_QUERY)
            .single();

        if (error) throw new DomainError('Error updating payment', 'DB_ERROR', 500);

        return this.toDomain(data);
    }

    async findAll(filters?: FindAllPaymentsFilters): Promise<Payment[]> {
        let query = supabase
            .from('payments')
            .select(SELECT_QUERY);

        if (filters) {
            query = this.applyFilters(query, filters);
        }

        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;
        if (error) throw new DomainError('Error fetching payments', 'DB_ERROR', 500);

        return (data || []).map(d => this.toDomain(d));
    }

    async findAllPaginated(
        filters: FindAllPaymentsFilters,
        pagination: PaginationFilters
    ): Promise<{ items: Payment[]; total: number }> {
        const { from, to } = toRange(pagination);

        let unitFilterConditions: string[] = [];
        if (filters?.unit_id) {
            unitFilterConditions.push(`unit_id.eq.${filters.unit_id}`);

            const { data: userUnits } = await supabase
                .from('profile_units')
                .select('user_id')
                .eq('unit_id', filters.unit_id);
            const userIds = (userUnits || []).map((uu: any) => uu.user_id).filter(Boolean);
            if (userIds.length > 0) {
                unitFilterConditions.push(`user_id.in.(${userIds.join(',')})`);
            }

            const { data: unitInvoices } = await supabase
                .from('invoices')
                .select('id')
                .eq('unit_id', filters.unit_id);
            const invoiceIds = (unitInvoices || []).map((i: any) => i.id).filter(Boolean);

            if (invoiceIds.length > 0) {
                const { data: allocs } = await supabase
                    .from('payment_allocations')
                    .select('payment_id')
                    .in('invoice_id', invoiceIds);
                const paymentIdsFromAllocations = (allocs || []).map((a: any) => a.payment_id).filter(Boolean);
                if (paymentIdsFromAllocations.length > 0) {
                    unitFilterConditions.push(`id.in.(${paymentIdsFromAllocations.join(',')})`);
                }
            }
        }

        let query = supabase
            .from('payments')
            .select(SELECT_QUERY, { count: 'exact' });

        if (filters?.building_id) query = query.eq('building_id', filters.building_id);
        if (filters?.status) query = query.eq('status', filters.status);
        if (filters?.user_id) query = query.eq('user_id', filters.user_id);
        if (filters?.year) query = this.applyYearFilter(query, filters.year);

        if (unitFilterConditions.length > 0) {
            query = query.or(unitFilterConditions.join(','));
        }

        query = query.order('created_at', { ascending: false });

        const { data, count, error } = await query.range(from, to);
        if (error) throw new DomainError('Error fetching payments: ' + error.message, 'DB_ERROR', 500);

        return {
            items: (data || []).map(d => this.toDomain(d)),
            total: count || 0,
        };
    }

    private applyFilters(query: any, filters: FindAllPaymentsFilters): any {
        if (filters.building_id) query = query.eq('building_id', filters.building_id);
        if (filters.status) query = query.eq('status', filters.status);
        if (filters.user_id) query = query.eq('user_id', filters.user_id);
        if (filters.unit_id) query = query.eq('unit_id', filters.unit_id);
        if (filters.year) query = this.applyYearFilter(query, filters.year);
        return query;
    }

    private applyYearFilter(query: any, year: number): any {
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;
        return query.gte('payment_date', startDate).lte('payment_date', endDate);
    }

    async delete(id: string): Promise<void> {
        const { error } = await supabase
            .from('payments')
            .delete()
            .eq('id', id);

        if (error) {
            throw new DomainError('Error deleting payment', 'DB_ERROR', 500);
        }
    }
}
