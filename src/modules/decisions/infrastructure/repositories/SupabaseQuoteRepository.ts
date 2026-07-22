import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import {
  DecisionQuoteRepository,
  PaginatedResult,
  PaginationOptions,
} from '@/modules/decisions/domain/repository';
import { DecisionQuote, DecisionQuoteProps } from '@/modules/decisions/domain/entities/DecisionQuote';
import type { ProfileRef } from '@/modules/decisions/domain/entities/Decision';

const SELECT_QUERY =
  '*, uploader:profiles!uploader_user_id(id, name), deleter:profiles!deleted_by(id, name)';

export class SupabaseQuoteRepository implements DecisionQuoteRepository {
  // ------------------------------------------------------------------ mapping

  private toDomain(row: Record<string, unknown>): DecisionQuote {
    const uploaderRow = row.uploader as { id: string; name: string } | null | undefined;
    const uploader: ProfileRef | null = uploaderRow
      ? { id: uploaderRow.id, name: uploaderRow.name }
      : null;

    const deleterRow = row.deleter as { id: string; name: string } | null | undefined;
    const deleter: ProfileRef | null = deleterRow
      ? { id: deleterRow.id, name: deleterRow.name }
      : null;

    const props: DecisionQuoteProps = {
      id: row.id as string,
      decision_id: row.decision_id as string,
      uploader_user_id: row.uploader_user_id as string,
      uploader_unit_id: (row.uploader_unit_id as string | null) ?? null,
      provider_name: row.provider_name as string,
      amount: Number(row.amount),
      notes: (row.notes as string | null) ?? null,
      file_url: (row.file_url as string | null) ?? null,
      deleted_at: row.deleted_at ? new Date(row.deleted_at as string) : undefined,
      deleted_by: (row.deleted_by as string | null) ?? undefined,
      deletion_reason: (row.deletion_reason as string | null) ?? undefined,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
      uploader,
      deleter,
    };
    return new DecisionQuote(props);
  }

  private toPersistence(q: DecisionQuote): Record<string, unknown> {
    return {
      id: q.id,
      decision_id: q.decision_id,
      uploader_user_id: q.uploader_user_id,
      uploader_unit_id: q.uploader_unit_id,
      provider_name: q.provider_name,
      amount: q.amount,
      notes: q.notes,
      file_url: q.file_url,
      deleted_at: q.deleted_at?.toISOString() ?? null,
      deleted_by: q.deleted_by ?? null,
      deletion_reason: q.deletion_reason ?? null,
      updated_at: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------ write

  async create(q: DecisionQuote): Promise<DecisionQuote> {
    const { data, error } = await supabase
      .from('decision_quotes')
      .insert({ ...this.toPersistence(q), created_at: q.created_at?.toISOString() ?? new Date().toISOString() })
      .select(SELECT_QUERY)
      .single();

    if (error) throw new DomainError('Error creating quote: ' + error.message, 'DB_ERROR', 500);
    return this.toDomain(data);
  }

  async update(q: DecisionQuote): Promise<DecisionQuote> {
    const { data, error } = await supabase
      .from('decision_quotes')
      .update(this.toPersistence(q))
      .eq('id', q.id)
      .select(SELECT_QUERY)
      .single();

    if (error) throw new DomainError('Error updating quote: ' + error.message, 'DB_ERROR', 500);
    return this.toDomain(data);
  }

  // ------------------------------------------------------------------ read

  async findById(id: string): Promise<DecisionQuote | null> {
    const { data, error } = await supabase
      .from('decision_quotes')
      .select(SELECT_QUERY)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new DomainError('Error fetching quote: ' + error.message, 'DB_ERROR', 500);
    }
    return this.toDomain(data);
  }

  async listForDecision(decisionId: string, includeDeleted = false): Promise<DecisionQuote[]> {
    let query = supabase
      .from('decision_quotes')
      .select(SELECT_QUERY)
      .eq('decision_id', decisionId)
      .order('created_at', { ascending: true });

    if (!includeDeleted) query = query.is('deleted_at', null);

    const { data, error } = await query;
    if (error) throw new DomainError('Error listing quotes: ' + error.message, 'DB_ERROR', 500);
    return (data ?? []).map((r) => this.toDomain(r));
  }

  async listForDecisionPaginated(
    decisionId: string,
    includeDeleted: boolean,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DecisionQuote>> {
    const from = (pagination.page - 1) * pagination.limit;
    const to = from + pagination.limit - 1;

    let query = supabase
      .from('decision_quotes')
      .select(SELECT_QUERY, { count: 'exact' })
      .eq('decision_id', decisionId)
      .order('created_at', { ascending: false });

    if (!includeDeleted) query = query.is('deleted_at', null);

    const { data, count, error } = await query.range(from, to);
    if (error) throw new DomainError('Error listing quotes: ' + error.message, 'DB_ERROR', 500);
    return {
      items: (data ?? []).map((r) => this.toDomain(r)),
      total: count ?? 0,
    };
  }
}
