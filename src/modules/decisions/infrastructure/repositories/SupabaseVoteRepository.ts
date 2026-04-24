import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import { DecisionVoteRepository } from '@/modules/decisions/domain/repository';
import { DecisionVote, DecisionVoteProps } from '@/modules/decisions/domain/entities/DecisionVote';
import type { ProfileRef } from '@/modules/decisions/domain/entities/Decision';

const SELECT_QUERY = '*, voted_by:profiles!voted_by_user_id(id, name)';

export class SupabaseVoteRepository implements DecisionVoteRepository {
  // ------------------------------------------------------------------ mapping

  private toDomain(row: Record<string, unknown>): DecisionVote {
    const voterRow = row.voted_by as { id: string; name: string } | null | undefined;
    const voted_by: ProfileRef | null = voterRow ? { id: voterRow.id, name: voterRow.name } : null;

    const props: DecisionVoteProps = {
      id: row.id as string,
      decision_id: row.decision_id as string,
      round: row.round as number,
      apartment_id: row.apartment_id as string,
      quote_id: row.quote_id as string,
      voted_by_user_id: row.voted_by_user_id as string,
      created_at: new Date(row.created_at as string),
      voted_by,
    };
    return new DecisionVote(props);
  }

  // ------------------------------------------------------------------ write

  async create(v: DecisionVote): Promise<DecisionVote> {
    const { data, error } = await supabase
      .from('decision_votes')
      .insert({
        id: v.id,
        decision_id: v.decision_id,
        round: v.round,
        apartment_id: v.apartment_id,
        quote_id: v.quote_id,
        voted_by_user_id: v.voted_by_user_id,
        created_at: v.created_at?.toISOString() ?? new Date().toISOString(),
      })
      .select(SELECT_QUERY)
      .single();

    if (error) {
      // Unique constraint: (decision_id, round, apartment_id)
      if (error.code === '23505') {
        throw new DomainError('already voted', 'VOTE_ALREADY_CAST', 409);
      }
      throw new DomainError('Error creating vote: ' + error.message, 'DB_ERROR', 500);
    }
    return this.toDomain(data);
  }

  // ------------------------------------------------------------------ read

  async listForDecision(decisionId: string, round?: number): Promise<DecisionVote[]> {
    let query = supabase
      .from('decision_votes')
      .select(SELECT_QUERY)
      .eq('decision_id', decisionId)
      .order('created_at', { ascending: true });

    if (round !== undefined) query = query.eq('round', round);

    const { data, error } = await query;
    if (error) throw new DomainError('Error listing votes: ' + error.message, 'DB_ERROR', 500);
    return (data ?? []).map((r) => this.toDomain(r));
  }

  async findByDecisionApartmentRound(
    decisionId: string,
    apartmentId: string,
    round: number,
  ): Promise<DecisionVote | null> {
    const { data, error } = await supabase
      .from('decision_votes')
      .select(SELECT_QUERY)
      .eq('decision_id', decisionId)
      .eq('apartment_id', apartmentId)
      .eq('round', round)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new DomainError('Error fetching vote: ' + error.message, 'DB_ERROR', 500);
    }
    return this.toDomain(data);
  }

  async countByQuote(decisionId: string, round: number): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from('decision_votes')
      .select('quote_id')
      .eq('decision_id', decisionId)
      .eq('round', round);

    if (error) throw new DomainError('Error counting votes: ' + error.message, 'DB_ERROR', 500);

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const qid = row.quote_id as string;
      counts[qid] = (counts[qid] ?? 0) + 1;
    }
    return counts;
  }
}
