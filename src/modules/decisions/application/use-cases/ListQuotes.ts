import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { DecisionQuoteRepository } from '@/modules/decisions/domain/repository';

export class ListQuotes {
  constructor(private readonly quotes: DecisionQuoteRepository) {}

  async execute(decisionId: string, includeDeleted = false): Promise<DecisionQuote[]> {
    return this.quotes.listForDecision(decisionId, includeDeleted);
  }
}
