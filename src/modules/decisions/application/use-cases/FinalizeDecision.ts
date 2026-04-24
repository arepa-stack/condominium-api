import { DomainError } from '@/core/errors';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
  DecisionRepository,
  DecisionQuoteRepository,
  DecisionVoteRepository,
  DecisionAuditLogRepository,
} from '@/modules/decisions/domain/repository';
import { computeTally } from '@/modules/decisions/domain/services/TallyService';

export interface FinalizeDecisionInput {
  decision_id: string;
  actor_user_id: string;
  /**
   * When true, bypasses the `reception_deadline` check for the
   * RECEPTION → VOTING transition. Admin/board use this when all
   * expected quotes are in and waiting would serve no purpose.
   * Ignored for VOTING → RESOLVED (that path has no deadline check).
   */
  force?: boolean;
  /** Required when `force: true`. Captured in the audit log. */
  reason?: string;
}

/**
 * Advances or resolves a decision based on current phase and deadlines.
 * Per spec §7.6: idempotent — calling again on a terminal state (RESOLVED,
 * CANCELLED) returns the current decision without mutation. Returns the
 * latest Decision so the client can re-render without refetching.
 */
export class FinalizeDecision {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly quotes: DecisionQuoteRepository,
    private readonly votes: DecisionVoteRepository,
    private readonly audit: DecisionAuditLogRepository,
  ) {}

  async execute(input: FinalizeDecisionInput): Promise<Decision> {
    await this.decisions.acquireFinalizeLock(input.decision_id);
    const d = await this.decisions.findByIdLocked(input.decision_id);
    if (!d) throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);

    // Idempotency: terminal statuses return current state unchanged.
    if (d.status === DecisionStatus.RESOLVED || d.status === DecisionStatus.CANCELLED) {
      return d;
    }

    // --- RECEPTION → VOTING ---
    if (d.status === DecisionStatus.RECEPTION) {
      // §7.6: cannot advance to VOTING without at least one active quote
      const activeQuotesForVoting = await this.quotes.listForDecision(d.id, false);
      if (activeQuotesForVoting.length === 0) {
        throw new DomainError(
          'cannot advance to VOTING: no active quotes',
          'DECISION_NO_ACTIVE_QUOTES',
          422,
        );
      }

      if (input.force) {
        if (!input.reason?.trim()) {
          throw new DomainError(
            'reason required when forcing advance',
            'VALIDATION_ERROR',
            400,
          );
        }
      }

      const previousDeadline = d.reception_deadline.toISOString();
      d.advanceToVoting({ force: input.force });
      const saved = await this.decisions.update(d);
      await this.audit.record({
        decision_id: d.id,
        event: AuditEvent.PHASE_ADVANCED,
        actor_user_id: input.actor_user_id,
        payload: input.force
          ? {
              from: 'RECEPTION',
              to: 'VOTING',
              forced: true,
              reason: input.reason,
              previous_reception_deadline: previousDeadline,
            }
          : { from: 'RECEPTION', to: 'VOTING' },
      });
      return saved;
    }

    // --- VOTING → finalize ---
    if (d.status === DecisionStatus.VOTING) {
      const activeQuotes = await this.quotes.listForDecision(d.id, false);
      if (activeQuotes.length === 0) {
        d.markTiebreakPendingManual();
        const saved = await this.decisions.update(d);
        await this.audit.record({
          decision_id: d.id,
          event: AuditEvent.TIEBREAK_OPENED,
          actor_user_id: input.actor_user_id,
          payload: { reason: 'NO_ACTIVE_QUOTES' },
        });
        return saved;
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
        const saved = await this.decisions.update(d);
        await this.audit.record({
          decision_id: d.id,
          event: AuditEvent.TIEBREAK_OPENED,
          actor_user_id: input.actor_user_id,
          payload: { reason: 'NO_VOTES_CAST' },
        });
        return saved;
      }

      if (!tally.is_tied) {
        d.resolve(tally.winner_quote_id!);
        const saved = await this.decisions.update(d);
        await this.audit.record({
          decision_id: d.id,
          event: AuditEvent.FINALIZED,
          actor_user_id: input.actor_user_id,
          payload: { winner_quote_id: tally.winner_quote_id },
        });
        return saved;
      }

      // Tie
      if (d.current_round === 1) {
        d.openTiebreak();
        const saved = await this.decisions.update(d);
        await this.audit.record({
          decision_id: d.id,
          event: AuditEvent.TIEBREAK_OPENED,
          actor_user_id: input.actor_user_id,
          payload: { reason: 'TIE_ROUND_1', tied_quote_ids: tally.tied_quote_ids },
        });
        return saved;
      }

      // Round >= 2: manual resolution required
      d.markTiebreakPendingManual();
      const saved = await this.decisions.update(d);
      await this.audit.record({
        decision_id: d.id,
        event: AuditEvent.TIEBREAK_OPENED,
        actor_user_id: input.actor_user_id,
        payload: { reason: 'TIE_ROUND_2_MANUAL', tied_quote_ids: tally.tied_quote_ids },
      });
      return saved;
    }

    // TIEBREAK_PENDING: manual action required via resolve-tiebreak
    throw new DomainError(
      `cannot finalize decision in status ${d.status}`,
      'DECISION_WRONG_STATUS',
      422,
    );
  }
}
