import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';
import { DecisionVoteRepository } from '@/modules/decisions/domain/repository';

export class ListVotes {
  constructor(private readonly votes: DecisionVoteRepository) {}

  async execute(decisionId: string, round?: number): Promise<DecisionVote[]> {
    return this.votes.listForDecision(decisionId, round);
  }
}
