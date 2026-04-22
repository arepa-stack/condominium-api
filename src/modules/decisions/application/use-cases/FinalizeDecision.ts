import { DomainError } from '@/core/errors';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
  DecisionRepository,
  DecisionQuoteRepository,
  DecisionVoteRepository,
  DecisionAuditLogRepository,
} from '@/modules/decisions/domain/repository';
import { computeTally } from '@/modules/decisions/domain/services/TallyService';

export type FinalizeOutcome =
  | 'ADVANCED_TO_VOTING'
  | 'RESOLVED'
  | 'TIEBREAK_OPENED'
  | 'TIEBREAK_PENDING_MANUAL';

export interface FinalizeDecisionInput {
  decision_id: string;
  actor_user_id: string;
}

export class FinalizeDecision {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly quotes: DecisionQuoteRepository,
    private readonly votes: DecisionVoteRepository,
    private readonly audit: DecisionAuditLogRepository,
  ) {}

  async execute(input: FinalizeDecisionInput): Promise<{ outcome: FinalizeOutcome }> {
    await this.decisions.acquireFinalizeLock(input.decision_id);
    const d = await this.decisions.findByIdLocked(input.decision_id);
    if (!d) throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);

    // --- RECEPTION → VOTING ---
    if (d.status === DecisionStatus.RECEPTION) {
      d.advanceToVoting();
      await this.decisions.update(d);
      await this.audit.record({
        decision_id: d.id,
        event: AuditEvent.PHASE_ADVANCED,
        actor_user_id: input.actor_user_id,
        payload: { from: 'RECEPTION', to: 'VOTING' },
      });
      return { outcome: 'ADVANCED_TO_VOTING' };
    }

    // --- VOTING → finalize ---
    if (d.status === DecisionStatus.VOTING) {
      const activeQuotes = await this.quotes.listForDecision(d.id, false);
      if (activeQuotes.length === 0) {
        d.markTiebreakPendingManual();
        await this.decisions.update(d);
        await this.audit.record({
          decision_id: d.id,
          event: AuditEvent.TIEBREAK_OPENED,
          actor_user_id: input.actor_user_id,
          payload: { reason: 'NO_ACTIVE_QUOTES' },
        });
        return { outcome: 'TIEBREAK_PENDING_MANUAL' };
      }

      const currentVotes = await this.votes.listForDecision(d.id, d.current_round);
      const tally = computeTally(
        currentVotes.map((v) => ({
          apartment_id: v.apartment_id,
          quote_id: v.quote_id,
          round: v.round,
        })),
        d.current_round,
      );

      if (tally.total_votes === 0) {
        d.markTiebreakPendingManual();
        await this.decisions.update(d);
        await this.audit.record({
          decision_id: d.id,
          event: AuditEvent.TIEBREAK_OPENED,
          actor_user_id: input.actor_user_id,
          payload: { reason: 'NO_VOTES_CAST' },
        });
        return { outcome: 'TIEBREAK_PENDING_MANUAL' };
      }

      if (!tally.is_tied) {
        d.resolve(tally.winner_quote_id!);
        await this.decisions.update(d);
        await this.audit.record({
          decision_id: d.id,
          event: AuditEvent.FINALIZED,
          actor_user_id: input.actor_user_id,
          payload: { winner_quote_id: tally.winner_quote_id },
        });
        return { outcome: 'RESOLVED' };
      }

      // Tie
      if (d.current_round === 1) {
        d.openTiebreak();
        await this.decisions.update(d);
        await this.audit.record({
          decision_id: d.id,
          event: AuditEvent.TIEBREAK_OPENED,
          actor_user_id: input.actor_user_id,
          payload: { reason: 'TIE_ROUND_1', tied_quote_ids: tally.tied_quote_ids },
        });
        return { outcome: 'TIEBREAK_OPENED' };
      }

      // Round >= 2: manual resolution required
      d.markTiebreakPendingManual();
      await this.decisions.update(d);
      await this.audit.record({
        decision_id: d.id,
        event: AuditEvent.TIEBREAK_OPENED,
        actor_user_id: input.actor_user_id,
        payload: { reason: 'TIE_ROUND_2_MANUAL', tied_quote_ids: tally.tied_quote_ids },
      });
      return { outcome: 'TIEBREAK_PENDING_MANUAL' };
    }

    throw new DomainError(
      `cannot finalize decision in status ${d.status}`,
      'DECISION_WRONG_STATUS',
      422,
    );
  }
}
