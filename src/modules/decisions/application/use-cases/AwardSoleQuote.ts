import { DomainError } from '@/core/errors';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
  DecisionRepository,
  DecisionQuoteRepository,
  DecisionAuditLogRepository,
} from '@/modules/decisions/domain/repository';

export interface AwardSoleQuoteInput {
  decision_id: string;
  actor_user_id: string;
  reason: string;
}

/**
 * Resolves a decision without voting when exactly one active quote exists.
 * The quote is selected by the use case rather than accepted from the caller,
 * so a stale or manipulated client cannot award a different provider.
 */
export class AwardSoleQuote {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly quotes: DecisionQuoteRepository,
    private readonly audit: DecisionAuditLogRepository,
  ) {}

  async execute(input: AwardSoleQuoteInput) {
    const reason = input.reason?.trim();
    if (!reason || reason.length < 5) {
      throw new DomainError(
        'direct award reason must have at least 5 characters',
        'VALIDATION_ERROR',
        400,
      );
    }

    await this.decisions.acquireFinalizeLock(input.decision_id);
    const decision = await this.decisions.findByIdLocked(input.decision_id);
    if (!decision) {
      throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);
    }

    // A retry after a successful response is safe and does not duplicate audit entries.
    if (decision.status === DecisionStatus.RESOLVED) {
      return decision;
    }
    if (decision.status !== DecisionStatus.RECEPTION) {
      throw new DomainError(
        'direct award is only allowed in RECEPTION',
        'DECISION_WRONG_STATUS',
        422,
      );
    }

    const activeQuotes = await this.quotes.listForDecision(decision.id, false);
    if (activeQuotes.length === 0) {
      throw new DomainError(
        'direct award requires one active quote',
        'DECISION_NO_ACTIVE_QUOTES',
        422,
      );
    }
    if (activeQuotes.length !== 1) {
      throw new DomainError(
        'direct award requires exactly one active quote',
        'DECISION_DIRECT_AWARD_REQUIRES_SINGLE_QUOTE',
        422,
      );
    }

    const winner = activeQuotes[0];
    decision.awardDirectly(winner.id);
    const updated = await this.decisions.update(decision);

    await this.audit.record({
      decision_id: decision.id,
      event: AuditEvent.DIRECT_AWARD,
      actor_user_id: input.actor_user_id,
      payload: {
        winner_quote_id: winner.id,
        provider_name: winner.provider_name,
        amount: winner.amount,
        reason,
      },
    });

    return updated;
  }
}
