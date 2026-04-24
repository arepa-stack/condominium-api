import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import {
  DecisionAuditLogRepository,
  PaginatedResult,
  PaginationOptions,
} from '@/modules/decisions/domain/repository';
import {
  DecisionAuditLog,
  AuditEvent,
} from '@/modules/decisions/domain/entities/DecisionAuditLog';
import type { ProfileRef } from '@/modules/decisions/domain/entities/Decision';

const SELECT_QUERY = '*, actor:profiles!actor_user_id(id, name)';

export class SupabaseAuditLogRepository implements DecisionAuditLogRepository {
  // ------------------------------------------------------------------ mapping

  private toDomain(row: Record<string, unknown>): DecisionAuditLog {
    const actorRow = row.actor as { id: string; name: string } | null | undefined;
    const actor: ProfileRef | null = actorRow ? { id: actorRow.id, name: actorRow.name } : null;

    return new DecisionAuditLog({
      id: row.id as string,
      decision_id: row.decision_id as string,
      event: row.event as AuditEvent,
      actor_user_id: (row.actor_user_id as string | null) ?? null,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      created_at: new Date(row.created_at as string),
      actor,
    });
  }

  // ------------------------------------------------------------------ write

  async record(args: {
    decision_id: string;
    event: AuditEvent;
    actor_user_id: string | null;
    payload?: Record<string, unknown> | null;
  }): Promise<DecisionAuditLog> {
    const { data, error } = await supabase
      .from('decision_audit_log')
      .insert({
        decision_id: args.decision_id,
        event: args.event,
        actor_user_id: args.actor_user_id,
        payload: args.payload ?? null,
        created_at: new Date().toISOString(),
      })
      .select(SELECT_QUERY)
      .single();

    if (error) throw new DomainError('Error recording audit: ' + error.message, 'DB_ERROR', 500);
    return this.toDomain(data);
  }

  // ------------------------------------------------------------------ read

  async listForDecision(decisionId: string): Promise<DecisionAuditLog[]> {
    const { data, error } = await supabase
      .from('decision_audit_log')
      .select(SELECT_QUERY)
      .eq('decision_id', decisionId)
      .order('created_at', { ascending: false });

    if (error) throw new DomainError('Error listing audit log: ' + error.message, 'DB_ERROR', 500);
    return (data ?? []).map((r) => this.toDomain(r));
  }

  async listForDecisionPaginated(
    decisionId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DecisionAuditLog>> {
    const from = (pagination.page - 1) * pagination.limit;
    const to = from + pagination.limit - 1;

    const { data, count, error } = await supabase
      .from('decision_audit_log')
      .select(SELECT_QUERY, { count: 'exact' })
      .eq('decision_id', decisionId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw new DomainError('Error listing audit log: ' + error.message, 'DB_ERROR', 500);
    return {
      items: (data ?? []).map((r) => this.toDomain(r)),
      total: count ?? 0,
    };
  }
}
