import { randomUUID } from 'crypto';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { DecisionRepository, DecisionQuoteRepository } from '@/modules/decisions/domain/repository';
import { DomainError } from '@/core/errors';

export interface UploadQuoteInput {
  decision_id: string;
  uploader_user_id: string;
  uploader_unit_id?: string | null;
  provider_name: string;
  amount: number;
  notes?: string;
  file_url: string;
}

export class UploadQuote {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly quotes: DecisionQuoteRepository,
  ) {}

  async execute(input: UploadQuoteInput): Promise<DecisionQuote> {
    const d = await this.decisions.findById(input.decision_id);
    if (!d) throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);
    if (d.status !== DecisionStatus.RECEPTION) {
      throw new DomainError('quotes only allowed in RECEPTION', 'DECISION_WRONG_STATUS', 422);
    }
    const q = new DecisionQuote({
      id: randomUUID(),
      decision_id: input.decision_id,
      uploader_user_id: input.uploader_user_id,
      uploader_unit_id: input.uploader_unit_id ?? null,
      provider_name: input.provider_name,
      amount: input.amount,
      notes: input.notes ?? null,
      file_url: input.file_url,
    });
    return this.quotes.create(q);
  }
}
