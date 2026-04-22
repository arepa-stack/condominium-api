import { DomainError } from '@/core/errors';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import { DecisionRepository, DecisionAuditLogRepository } from '@/modules/decisions/domain/repository';

export interface ExtendDeadlinesInput {
  decision_id: string;
  reception_deadline?: Date;
  voting_deadline?: Date;
  reason: string;
  actor_user_id: string;
}

export class ExtendDeadlines {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly audit: DecisionAuditLogRepository,
  ) {}

  async execute(input: ExtendDeadlinesInput) {
    if (!input.reason?.trim()) {
      throw new DomainError('reason required', 'VALIDATION_ERROR', 400);
    }
    const d = await this.decisions.findById(input.decision_id);
    if (!d) throw new DomainError('not found', 'DECISION_NOT_FOUND', 404);

    const old = {
      reception_deadline: d.reception_deadline,
      voting_deadline: d.voting_deadline,
    };

    d.extendDeadlines({
      reception_deadline: input.reception_deadline,
      voting_deadline: input.voting_deadline,
    });

    const updated = await this.decisions.update(d);
    await this.audit.record({
      decision_id: d.id,
      event: AuditEvent.DEADLINE_EXTENDED,
      actor_user_id: input.actor_user_id,
      payload: {
        old,
        new: { reception_deadline: d.reception_deadline, voting_deadline: d.voting_deadline },
        reason: input.reason,
      },
    });
    return updated;
  }
}
