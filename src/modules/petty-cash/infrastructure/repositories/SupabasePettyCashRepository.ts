import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashFund } from '../../domain/entities/PettyCashFund';
import { PettyCashTransaction } from '../../domain/entities/PettyCashTransaction';
import { PettyCashTransactionType, PettyCashCategory } from '@/core/domain/enums';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

export class SupabasePettyCashRepository implements PettyCashRepository {
    private fundToDomain(data: any): PettyCashFund {
        return new PettyCashFund(
            data.id,
            data.building_id,
            Number(data.current_balance),
            data.currency,
            new Date(data.updated_at)
        );
    }

    private transactionToDomain(data: any): PettyCashTransaction {
        return new PettyCashTransaction(
            data.id,
            data.fund_id,
            data.type as PettyCashTransactionType,
            Number(data.amount),
            data.description,
            data.category as PettyCashCategory,
            data.created_by,
            data.evidence_url,
            new Date(data.created_at)
        );
    }

    async findFundByBuildingId(buildingId: string): Promise<PettyCashFund | null> {
        const { data, error } = await supabase
            .from('petty_cash_fund')
            .select('*')
            .eq('building_id', buildingId)
            .single();
        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching petty cash fund', 'DB_ERROR', 500);
        }

        return this.fundToDomain(data);
    }

    async saveFund(fund: PettyCashFund): Promise<PettyCashFund> {
        const persistenceData = {
            building_id: fund.building_id,
            current_balance: fund.current_balance,
            currency: fund.currency,
            updated_at: new Date().toISOString()
        };

        let query;
        if (fund.id) {
            query = supabase.from('petty_cash_fund').update(persistenceData).eq('id', fund.id);
        } else {
            query = supabase.from('petty_cash_fund').insert(persistenceData);
        }

        const { data, error } = await query.select('*').single();

        if (error) {
            throw new DomainError('Error saving petty cash fund', 'DB_ERROR', 500);
        }

        return this.fundToDomain(data);
    }

    async saveTransaction(transaction: PettyCashTransaction): Promise<PettyCashTransaction> {
        const persistenceData = {
            fund_id: transaction.fund_id,
            type: transaction.type,
            amount: transaction.amount,
            description: transaction.description,
            category: transaction.category,
            created_by: transaction.created_by,
            evidence_url: transaction.evidence_url
        };

        const { data, error } = await supabase
            .from('petty_cash_transactions')
            .insert(persistenceData)
            .select('*')
            .single();

        if (error) {
            throw new DomainError('Error saving petty cash transaction', 'DB_ERROR', 500);
        }

        return this.transactionToDomain(data);
    }

    async findTransactionsByFundId(
        fundId: string,
        filters: {
            type?: PettyCashTransactionType;
            category?: PettyCashCategory;
            limit?: number;
            offset?: number;
        }
    ): Promise<PettyCashTransaction[]> {
        let query = supabase
            .from('petty_cash_transactions')
            .select('*')
            .eq('fund_id', fundId);

        if (filters.type) {
            query = query.eq('type', filters.type);
        }
        if (filters.category) {
            query = query.eq('category', filters.category);
        }

        query = query.order('created_at', { ascending: false });

        if (filters.limit) {
            query = query.limit(filters.limit);
        }
        if (filters.offset) {
            query = query.range(filters.offset, filters.offset + (filters.limit || 10) - 1);
        }

        const { data, error } = await query;

        if (error) {
            throw new DomainError('Error fetching petty cash transactions', 'DB_ERROR', 500);
        }

        return data.map(d => this.transactionToDomain(d));
    }
}
