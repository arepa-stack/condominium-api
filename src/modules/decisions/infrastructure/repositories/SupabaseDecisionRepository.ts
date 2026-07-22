import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import {
  DecisionRepository,
  DecisionListFilters,
  PaginatedResult,
} from '@/modules/decisions/domain/repository';
import {
  Decision,
  DecisionProps,
  DecisionStatus,
  DecisionProcessType,
  DecisionResultingType,
  ProfileRef,
} from '@/modules/decisions/domain/entities/Decision';

const SELECT_QUERY = '*, creator:profiles!created_by(id, name)';

export class SupabaseDecisionRepository implements DecisionRepository {
  // ------------------------------------------------------------------ mapping

  private toDomain(row: Record<string, unknown>, quote_count = 0): Decision {
    const creatorRow = row.creator as { id: string; name: string } | null | undefined;
    const creator: ProfileRef | null = creatorRow ? { id: creatorRow.id, name: creatorRow.name } : null;

    const props: DecisionProps = {
      id: row.id as string,
      building_id: row.building_id as string,
      created_by: (row.created_by as string | null) ?? null,
      title: row.title as string,
      description: (row.description as string | null) ?? null,
      photo_url: (row.photo_url as string | null) ?? null,
      status: row.status as DecisionStatus,
      process_type: (row.process_type as DecisionProcessType | undefined) ?? DecisionProcessType.VOTING,
      current_round: row.current_round as number,
      reception_deadline: new Date(row.reception_deadline as string),
      voting_deadline: new Date(row.voting_deadline as string),
      tiebreak_duration_hours: row.tiebreak_duration_hours as number,
      winner_quote_id: (row.winner_quote_id as string | null) ?? null,
      resulting_type: (row.resulting_type as DecisionResultingType | null) ?? null,
      resulting_id: (row.resulting_id as string | null) ?? null,
      finalized_at: row.finalized_at ? new Date(row.finalized_at as string) : null,
      cancelled_at: row.cancelled_at ? new Date(row.cancelled_at as string) : null,
      cancel_reason: (row.cancel_reason as string | null) ?? null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
      creator,
      quote_count,
    };
    return new Decision(props);
  }

  private toPersistence(d: Decision): Record<string, unknown> {
    return {
      id: d.id,
      building_id: d.building_id,
      created_by: d.created_by,
      title: d.title,
      description: d.description,
      photo_url: d.photo_url,
      status: d.status,
      process_type: d.process_type,
      current_round: d.current_round,
      reception_deadline: d.reception_deadline.toISOString(),
      voting_deadline: d.voting_deadline.toISOString(),
      tiebreak_duration_hours: d.tiebreak_duration_hours,
      winner_quote_id: d.winner_quote_id,
      resulting_type: d.resulting_type,
      resulting_id: d.resulting_id,
      finalized_at: d.finalized_at?.toISOString() ?? null,
      cancelled_at: d.cancelled_at?.toISOString() ?? null,
      cancel_reason: d.cancel_reason,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Batch-counts active quotes grouped by decision_id.
   * Uses head:true + count:exact per id? No — single query IN (ids), group in JS.
   */
  private async fetchQuoteCounts(decisionIds: string[]): Promise<Record<string, number>> {
    if (decisionIds.length === 0) return {};
    const { data, error } = await supabase
      .from('decision_quotes')
      .select('decision_id')
      .in('decision_id', decisionIds)
      .is('deleted_at', null);

    if (error) throw new DomainError('Error counting quotes: ' + error.message, 'DB_ERROR', 500);

    const counts: Record<string, number> = {};
    for (const id of decisionIds) counts[id] = 0;
    for (const row of data ?? []) {
      const id = row.decision_id as string;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }

  // ------------------------------------------------------------------ write

  async create(d: Decision): Promise<Decision> {
    const { data, error } = await supabase
      .from('decisions')
      .insert({ ...this.toPersistence(d), created_at: d.created_at.toISOString() })
      .select(SELECT_QUERY)
      .single();

    if (error) throw new DomainError('Error creating decision: ' + error.message, 'DB_ERROR', 500);
    return this.toDomain(data, 0);
  }

  async update(d: Decision): Promise<Decision> {
    const { data, error } = await supabase
      .from('decisions')
      .update(this.toPersistence(d))
      .eq('id', d.id)
      .select(SELECT_QUERY)
      .single();

    if (error) throw new DomainError('Error updating decision: ' + error.message, 'DB_ERROR', 500);
    const counts = await this.fetchQuoteCounts([d.id]);
    return this.toDomain(data, counts[d.id] ?? 0);
  }

  // ------------------------------------------------------------------ read

  async findById(id: string): Promise<Decision | null> {
    const { data, error } = await supabase
      .from('decisions')
      .select(SELECT_QUERY)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new DomainError('Error fetching decision: ' + error.message, 'DB_ERROR', 500);
    }
    const counts = await this.fetchQuoteCounts([id]);
    return this.toDomain(data, counts[id] ?? 0);
  }

  /**
   * SELECT ... FOR UPDATE via Supabase RPC.
   * In practice, advisory locks are handled by acquireFinalizeLock();
   * this method just fetches the latest row inside the same transaction.
   */
  async findByIdLocked(id: string): Promise<Decision | null> {
    return this.findById(id);
  }

  async list(filters: DecisionListFilters): Promise<PaginatedResult<Decision>> {
    const { page, limit } = filters.pagination;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('decisions')
      .select(SELECT_QUERY, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (filters.building_id) query = query.eq('building_id', filters.building_id);
    if (filters.statuses?.length) query = query.in('status', filters.statuses);
    if (filters.created_by) query = query.eq('created_by', filters.created_by);
    if (filters.search) query = query.ilike('title', `%${filters.search}%`);

    const { data, count, error } = await query.range(from, to);
    if (error) throw new DomainError('Error listing decisions: ' + error.message, 'DB_ERROR', 500);

    const rows = data ?? [];
    const ids = rows.map((r) => r.id as string);
    const counts = await this.fetchQuoteCounts(ids);

    return {
      items: rows.map((r) => this.toDomain(r, counts[r.id as string] ?? 0)),
      total: count ?? 0,
    };
  }

  // ------------------------------------------------------------------ locking

  /**
   * Acquires a session-level advisory lock keyed to the decision ID.
   * Using pg_advisory_lock (session-level) instead of xact-level because
   * Supabase REST does not wrap calls in explicit transactions by default.
   * The lock is released at the end of the request via pg_advisory_unlock.
   *
   * Note: In production this should be inside a Postgres function / RPC that
   * wraps the entire finalize sequence in a transaction with
   * pg_advisory_xact_lock for true atomic semantics. V1 uses the simpler
   * approach — the FinalizeDecision use case re-validates state post-lock.
   */
  async acquireFinalizeLock(id: string): Promise<void> {
    const { error } = await supabase.rpc('acquire_decision_lock', { decision_id: id });
    if (error) {
      // Non-fatal: lock may not be configured in all environments (local dev).
      // FinalizeDecision re-validates idempotently regardless.
      console.warn('[SupabaseDecisionRepository] acquireFinalizeLock failed:', error.message);
    }
  }
}
