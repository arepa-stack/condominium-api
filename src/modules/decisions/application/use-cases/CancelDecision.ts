import { DomainError } from '@/core/errors';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import { DecisionRepository, DecisionAuditLogRepository } from '@/modules/decisions/domain/repository';

export interface CancelDecisionInput {
  decision_id: string;
  reason: string;
  actor_user_id: string;
}

export class CancelDecision {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly audit: DecisionAuditLogRepository,
  ) {}

  async execute(input: CancelDecisionInput) {
    if (!input.reason?.trim()) {
      throw new DomainError('reason required', 'VALIDATION_ERROR', 400);
    }
    const d = await this.decisions.findById(input.decision_id);
    if (!d) throw new DomainError('not found', 'DECISION_NOT_FOUND', 404);

    d.cancel(input.reason);
    const updated = await this.decisions.update(d);
    await this.audit.record({
      decision_id: d.id,
      event: AuditEvent.CANCELLED,
      actor_user_id: input.actor_user_id,
      payload: { reason: input.reason },
    });
    return updated;
  }
}
