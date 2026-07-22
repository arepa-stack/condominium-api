import {
  Decision,
  DecisionProcessType,
} from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
  DecisionRepository,
  DecisionQuoteRepository,
  DecisionAuditLogRepository,
} from '@/modules/decisions/domain/repository';
import { DomainError } from '@/core/errors';

export interface CreateDirectDecisionInput {
  decisionId: string;
  quoteId: string;
  buildingId: string;
  actorUserId: string;
  title: string;
  description?: string;
  providerName: string;
  amount: number;
  notes?: string;
  fileUrl?: string;
  reason: string;
}

export interface CreateDirectDecisionResult {
  decision: Decision;
  quote: DecisionQuote;
}

/**
 * Creates and resolves a direct-award decision in one application flow.
 * Deadline values are internal compatibility fields for the existing table;
 * DIRECT_AWARD decisions never expose deadline actions to the user.
 */
export class CreateDirectDecision {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly quotes: DecisionQuoteRepository,
    private readonly audit: DecisionAuditLogRepository,
  ) {}

  async execute(input: CreateDirectDecisionInput): Promise<CreateDirectDecisionResult> {
    const reason = input.reason?.trim();
    if (!reason || reason.length < 5) {
      throw new DomainError(
        'direct award reason must have at least 5 characters',
        'VALIDATION_ERROR',
        400,
      );
    }

    const now = Date.now();
    // Build both aggregates before persisting either one so domain validation
    // cannot leave an incomplete direct-award decision behind.
    const decisionToCreate = new Decision({
      id: input.decisionId,
      building_id: input.buildingId,
      created_by: input.actorUserId,
      title: input.title,
      description: input.description ?? null,
      process_type: DecisionProcessType.DIRECT_AWARD,
      reception_deadline: new Date(now + 1_000),
      voting_deadline: new Date(now + 2_000),
    });
    const quoteToCreate = new DecisionQuote({
      id: input.quoteId,
      decision_id: input.decisionId,
      uploader_user_id: input.actorUserId,
      provider_name: input.providerName,
      amount: input.amount,
      notes: input.notes ?? null,
      file_url: input.fileUrl ?? null,
    });

    const decision = await this.decisions.create(decisionToCreate);

    await this.audit.record({
      decision_id: decision.id,
      event: AuditEvent.CREATED,
      actor_user_id: input.actorUserId,
      payload: {
        title: input.title,
        process_type: DecisionProcessType.DIRECT_AWARD,
      },
    });

    const quote = await this.quotes.create(quoteToCreate);

    decision.awardDirectly(quote.id);
    const resolvedDecision = await this.decisions.update(decision);

    await this.audit.record({
      decision_id: decision.id,
      event: AuditEvent.DIRECT_AWARD,
      actor_user_id: input.actorUserId,
      payload: {
        winner_quote_id: quote.id,
        provider_name: quote.provider_name,
        amount: quote.amount,
        reason,
      },
    });

    return { decision: resolvedDecision, quote };
  }
}
