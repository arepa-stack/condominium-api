import { DomainError } from '@/core/errors';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
  DecisionRepository,
  DecisionQuoteRepository,
  DecisionAuditLogRepository,
} from '@/modules/decisions/domain/repository';

export type ActorRole = 'admin' | 'board' | 'resident';

export interface DeleteQuoteInput {
  decision_id: string;
  quote_id: string;
  actor_user_id: string;
  actor_role: ActorRole;
  reason?: string;
}

export class DeleteQuote {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly quotes: DecisionQuoteRepository,
    private readonly audit: DecisionAuditLogRepository,
  ) {}

  async execute(input: DeleteQuoteInput) {
    const q = await this.quotes.findById(input.quote_id);
    if (!q || q.decision_id !== input.decision_id) {
      throw new DomainError('quote not found', 'QUOTE_NOT_FOUND', 404);
    }
    const d = await this.decisions.findById(input.decision_id);
    if (!d) throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);

    const isSelf = q.uploader_user_id === input.actor_user_id;
    const isAdminOrBoard = input.actor_role === 'admin' || input.actor_role === 'board';

    if (isSelf && d.status === DecisionStatus.RECEPTION) {
      q.softDelete(input.actor_user_id, 'self-deleted by uploader');
    } else if (isAdminOrBoard) {
      if (!input.reason?.trim()) {
        throw new DomainError('reason required', 'VALIDATION_ERROR', 400);
      }
      q.softDelete(input.actor_user_id, input.reason);
    } else {
      throw new DomainError('not allowed', 'DECISION_FORBIDDEN_ROLE', 403);
    }

    const updated = await this.quotes.update(q);
    await this.audit.record({
      decision_id: d.id,
      event: AuditEvent.QUOTE_DELETED,
      actor_user_id: input.actor_user_id,
      payload: { quote_id: q.id, reason: q.deletion_reason },
    });
    return updated;
  }
}
