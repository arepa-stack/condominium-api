import { describe, it, expect } from 'bun:test';
import { ListVotes } from '@/modules/decisions/application/use-cases/ListVotes';
import { InMemoryVoteRepo } from '../fakes';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';

const makeVote = (id: string, round: number, apt: string) =>
  new DecisionVote({ id, decision_id: 'd1', round, apartment_id: apt, quote_id: 'q1', voted_by_user_id: 'u1' });

describe('ListVotes', () => {
  it('returns all votes for a decision', async () => {
    const repo = new InMemoryVoteRepo();
    await repo.create(makeVote('v1', 1, 'apt1'));
    await repo.create(makeVote('v2', 2, 'apt2'));
    const uc = new ListVotes(repo);
    const result = await uc.execute('d1');
    expect(result.length).toBe(2);
  });

  it('filters by round', async () => {
    const repo = new InMemoryVoteRepo();
    await repo.create(makeVote('v1', 1, 'apt1'));
    await repo.create(makeVote('v2', 2, 'apt2'));
    const uc = new ListVotes(repo);
    const result = await uc.execute('d1', 1);
    expect(result.length).toBe(1);
    expect(result[0].round).toBe(1);
  });
});
