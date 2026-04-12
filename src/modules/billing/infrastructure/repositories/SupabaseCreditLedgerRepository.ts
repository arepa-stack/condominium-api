import { ICreditLedgerRepository } from '../../domain/repository';
import { CreditLedgerEntry, CreditLedgerReferenceType } from '../../domain/entities/CreditLedgerEntry';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

export class SupabaseCreditLedgerRepository implements ICreditLedgerRepository {
    private toDomain(data: Record<string, unknown>): CreditLedgerEntry {
        return new CreditLedgerEntry({
            id: data.id as string,
            unit_id: data.unit_id as string,
            amount: data.amount as number,
            reason: data.reason as string,
            reference_type: data.reference_type as CreditLedgerReferenceType,
            reference_id: data.reference_id as string,
            created_at: data.created_at ? new Date(data.created_at as string) : undefined
        });
    }

    async addCredit(entry: CreditLedgerEntry): Promise<CreditLedgerEntry> {
        const { data, error } = await supabase
            .from('unit_credit_ledger')
            .insert({
                id: entry.id || undefined,
                unit_id: entry.unit_id,
                amount: entry.amount,
                reason: entry.reason,
                reference_type: entry.reference_type,
                reference_id: entry.reference_id,
                created_at: entry.created_at
            })
            .select()
            .single();

        if (error) {
            throw new DomainError('Error adding credit entry: ' + error.message, 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async deductCredit(entry: CreditLedgerEntry): Promise<CreditLedgerEntry> {
        // Technically the same as addCredit but with negative amount
        return this.addCredit(entry);
    }

    async getBalanceForUnit(unitId: string): Promise<number> {
        const { data, error } = await supabase
            .from('unit_credit_balance')
            .select('balance')
            .eq('unit_id', unitId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return 0; // No rows — balance is 0
            throw new DomainError('Error fetching credit balance: ' + error.message, 'DB_ERROR', 500);
        }

        return (data?.balance as number) ?? 0;
    }

    async getEntriesForUnit(unitId: string): Promise<CreditLedgerEntry[]> {
        const { data, error } = await supabase
            .from('unit_credit_ledger')
            .select('*')
            .eq('unit_id', unitId)
            .order('created_at', { ascending: false });

        if (error) {
            throw new DomainError('Error fetching credit entries: ' + error.message, 'DB_ERROR', 500);
        }

        return (data || []).map(d => this.toDomain(d as Record<string, unknown>));
    }

    async findByReferenceId(referenceId: string): Promise<CreditLedgerEntry[]> {
        const { data, error } = await supabase
            .from('unit_credit_ledger')
            .select('*')
            .eq('reference_id', referenceId);

        if (error) {
            throw new DomainError('Error finding credit entries by reference: ' + error.message, 'DB_ERROR', 500);
        }

        return (data || []).map(d => this.toDomain(d as Record<string, unknown>));
    }
}
