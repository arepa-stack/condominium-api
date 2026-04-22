import { DomainError } from '@/core/errors';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
  DecisionRepository,
  DecisionQuoteRepository,
  DecisionAuditLogRepository,
} from '@/modules/decisions/domain/repository';

export interface ResolveTiebreakInput {
  decision_id: string;
  winner_quote_id: string;
  actor_user_id: string;
}

export class ResolveTiebreak {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly quotes: DecisionQuoteRepository,
    private readonly audit: DecisionAuditLogRepository,
  ) {}

  async execute(input: ResolveTiebreakInput) {
    const d = await this.decisions.findById(input.decision_id);
    if (!d) throw new DomainError('not found', 'DECISION_NOT_FOUND', 404);
    if (d.status !== DecisionStatus.TIEBREAK_PENDING) {
      throw new DomainError('decision is not in TIEBREAK_PENDING', 'TIEBREAK_MANUAL_NOT_ALLOWED', 422);
    }

    const q = await this.quotes.findById(input.winner_quote_id);
    if (!q || q.decision_id !== d.id || q.isDeleted) {
      throw new DomainError('invalid winner quote', 'QUOTE_NOT_FOUND', 404);
    }

    d.resolve(q.id);
    const updated = await this.decisions.update(d);
    await this.audit.record({
      decision_id: d.id,
      event: AuditEvent.WINNER_SET_MANUAL,
      actor_user_id: input.actor_user_id,
      payload: { winner_quote_id: q.id },
    });
    return updated;
  }
}
