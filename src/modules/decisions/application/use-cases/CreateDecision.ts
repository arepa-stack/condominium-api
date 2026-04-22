import { randomUUID } from 'crypto';
import { Decision } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import { DecisionRepository, DecisionAuditLogRepository } from '@/modules/decisions/domain/repository';

export interface CreateDecisionInput {
  building_id: string;
  actor_user_id: string;
  title: string;
  description?: string;
  photo_url?: string;
  reception_deadline: Date;
  voting_deadline: Date;
  tiebreak_duration_hours?: number;
}

export class CreateDecision {
  constructor(
    private readonly repo: DecisionRepository,
    private readonly audit: DecisionAuditLogRepository,
  ) {}

  async execute(input: CreateDecisionInput): Promise<Decision> {
    const d = new Decision({
      id: randomUUID(),
      building_id: input.building_id,
      created_by: input.actor_user_id,
      title: input.title,
      description: input.description ?? null,
      photo_url: input.photo_url ?? null,
      reception_deadline: input.reception_deadline,
      voting_deadline: input.voting_deadline,
      tiebreak_duration_hours: input.tiebreak_duration_hours,
    });
    const created = await this.repo.create(d);
    await this.audit.record({
      decision_id: created.id,
      event: AuditEvent.CREATED,
      actor_user_id: input.actor_user_id,
      payload: {
        title: input.title,
        reception_deadline: input.reception_deadline,
        voting_deadline: input.voting_deadline,
      },
    });
    return created;
  }
}
