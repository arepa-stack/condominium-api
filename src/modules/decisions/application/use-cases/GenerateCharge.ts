import { DomainError } from '@/core/errors';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
  DecisionRepository,
  DecisionQuoteRepository,
  DecisionAuditLogRepository,
} from '@/modules/decisions/domain/repository';
import {
  InvoiceChargeGenerator,
  AssessmentChargeGenerator,
} from '@/modules/decisions/application/ports/ChargeGenerator';

export interface GenerateChargeInput {
  decision_id: string;
  type: 'INVOICE' | 'ASSESSMENT';
  actor_user_id: string;
  description_override?: string;
  amount_override?: number;
  overrides?: Record<string, unknown>;
}

export class GenerateCharge {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly quotes: DecisionQuoteRepository,
    private readonly audit: DecisionAuditLogRepository,
    private readonly invoiceGen: InvoiceChargeGenerator,
    private readonly assessmentGen: AssessmentChargeGenerator,
  ) {}

  async execute(input: GenerateChargeInput) {
    const d = await this.decisions.findById(input.decision_id);
    if (!d) throw new DomainError('not found', 'DECISION_NOT_FOUND', 404);
    if (d.status !== DecisionStatus.RESOLVED) {
      throw new DomainError('decision is not resolved', 'DECISION_WRONG_STATUS', 422);
    }
    if (d.resulting_id) {
      throw new DomainError('charge already generated', 'DECISION_ALREADY_CHARGED', 409);
    }
    if (!d.winner_quote_id) {
      throw new DomainError('no winner quote', 'DECISION_NO_WINNER', 422);
    }

    const winner = await this.quotes.findById(d.winner_quote_id);
    if (!winner) throw new DomainError('winner quote missing', 'QUOTE_NOT_FOUND', 404);

    const req = {
      decision_id: d.id,
      building_id: d.building_id,
      amount: input.amount_override ?? winner.amount,
      description: input.description_override ?? d.title,
      actor_user_id: input.actor_user_id,
      overrides: input.overrides,
    };

    const result =
      input.type === 'INVOICE'
        ? await this.invoiceGen.generate(req)
        : await this.assessmentGen.generate(req);

    d.attachCharge(result.type, result.id);
    await this.decisions.update(d);
    await this.audit.record({
      decision_id: d.id,
      event: AuditEvent.CHARGE_GENERATED,
      actor_user_id: input.actor_user_id,
      payload: result as unknown as Record<string, unknown>,
    });

    return { decision: d, resulting: result };
  }
}
