import { describe, it, expect } from 'bun:test';
import { GetDecision } from '@/modules/decisions/application/use-cases/GetDecision';
import { InMemoryDecisionRepo, InMemoryQuoteRepo, InMemoryVoteRepo } from '../fakes';
import { Decision } from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';

const future = (ms: number) => new Date(Date.now() + ms);

const makeDecision = () =>
  new Decision({
    id: 'd1',
    building_id: 'b1',
    created_by: 'u1',
    title: 'Reparación portón',
    reception_deadline: future(60_000),
    voting_deadline: future(120_000),
  });

const makeQuote = (id: string) =>
  new DecisionQuote({ id, decision_id: 'd1', uploader_user_id: 'u1', provider_name: 'Acme SA', amount: 1000, file_url: '/f.pdf' });

const makeVote = (id: string, user: string, apt: string, quote: string) =>
  new DecisionVote({ id, decision_id: 'd1', round: 1, apartment_id: apt, quote_id: quote, voted_by_user_id: user });

describe('GetDecision', () => {
  it('throws 404 when decision not found', async () => {
    const uc = new GetDecision(new InMemoryDecisionRepo(), new InMemoryQuoteRepo(), new InMemoryVoteRepo());
    await expect(uc.execute('missing', { caller_user_id: null })).rejects.toThrow();
  });

  it('returns decision, quotes, tally, my_vote=null when no caller', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    await decRepo.create(makeDecision());
    await quoteRepo.create(makeQuote('q1'));
    await voteRepo.create(makeVote('v1', 'u1', 'apt1', 'q1'));
    const uc = new GetDecision(decRepo, quoteRepo, voteRepo);
    const result = await uc.execute('d1', { caller_user_id: null });
    expect(result.decision.id).toBe('d1');
    expect(result.quotes.length).toBe(1);
    expect(result.tally.totals['q1']).toBe(1);
    expect(result.my_vote).toBeNull();
  });

  it('returns my_vote when caller has voted', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    await decRepo.create(makeDecision());
    await quoteRepo.create(makeQuote('q1'));
    await voteRepo.create(makeVote('v1', 'u1', 'apt1', 'q1'));
    const uc = new GetDecision(decRepo, quoteRepo, voteRepo);
    const result = await uc.execute('d1', { caller_user_id: 'u1' });
    expect(result.my_vote).not.toBeNull();
    expect(result.my_vote!.quote_id).toBe('q1');
  });
});
