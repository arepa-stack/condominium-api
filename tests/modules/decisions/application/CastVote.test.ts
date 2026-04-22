import { describe, it, expect } from 'bun:test';
import { CastVote } from '@/modules/decisions/application/use-cases/CastVote';
import { InMemoryDecisionRepo, InMemoryQuoteRepo, InMemoryVoteRepo } from '../fakes';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';

const future = (ms: number) => new Date(Date.now() + ms);
const past = (ms: number) => new Date(Date.now() - ms);

const makeVotingDecision = (id = 'd1', round = 1) =>
  new Decision({
    id, building_id: 'b1', created_by: 'u1', title: 'Reparación portón',
    reception_deadline: past(5000),
    voting_deadline: future(60_000),
    status: DecisionStatus.VOTING,
    current_round: round,
  });

const makeQuote = (id: string, decId = 'd1', deleted = false) => {
  const q = new DecisionQuote({ id, decision_id: decId, uploader_user_id: 'u1', provider_name: 'Acme SA', amount: 1000, file_url: '/f.pdf' });
  if (deleted) q.softDelete('admin', 'test');
  return q;
};

describe('CastVote', () => {
  it('casts a valid vote in round 1', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1'));
    const uc = new CastVote(decRepo, quoteRepo, voteRepo);
    const vote = await uc.execute({ decision_id: 'd1', apartment_id: 'apt1', quote_id: 'q1', voter_user_id: 'u1' });
    expect(vote.round).toBe(1);
    expect(vote.quote_id).toBe('q1');
  });

  it('throws 409 on duplicate vote', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1'));
    const uc = new CastVote(decRepo, quoteRepo, voteRepo);
    await uc.execute({ decision_id: 'd1', apartment_id: 'apt1', quote_id: 'q1', voter_user_id: 'u1' });
    await expect(uc.execute({ decision_id: 'd1', apartment_id: 'apt1', quote_id: 'q1', voter_user_id: 'u1' })).rejects.toThrow();
  });

  it('throws 422 when decision not in VOTING status', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const d = new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación', reception_deadline: future(60_000), voting_deadline: future(120_000) });
    await decRepo.create(d);
    await quoteRepo.create(makeQuote('q1'));
    const uc = new CastVote(decRepo, quoteRepo, new InMemoryVoteRepo());
    await expect(uc.execute({ decision_id: 'd1', apartment_id: 'apt1', quote_id: 'q1', voter_user_id: 'u1' })).rejects.toThrow();
  });

  it('throws 422 when quote is deleted', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1', 'd1', true));
    const uc = new CastVote(decRepo, quoteRepo, new InMemoryVoteRepo());
    await expect(uc.execute({ decision_id: 'd1', apartment_id: 'apt1', quote_id: 'q1', voter_user_id: 'u1' })).rejects.toThrow();
  });

  it('round 2 rejects quote not in tiebreak set', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    // round 2 decision with tied q1 & q2 in round 1
    await decRepo.create(makeVotingDecision('d1', 2));
    await quoteRepo.create(makeQuote('q1'));
    await quoteRepo.create(makeQuote('q2'));
    await quoteRepo.create(makeQuote('q3'));
    // Add round-1 votes: q1 and q2 tied, q3 has no votes
    await voteRepo.create(new DecisionVote({ id: 'v1', decision_id: 'd1', round: 1, apartment_id: 'apt1', quote_id: 'q1', voted_by_user_id: 'u1' }));
    await voteRepo.create(new DecisionVote({ id: 'v2', decision_id: 'd1', round: 1, apartment_id: 'apt2', quote_id: 'q2', voted_by_user_id: 'u2' }));
    const uc = new CastVote(decRepo, quoteRepo, voteRepo);
    await expect(uc.execute({ decision_id: 'd1', apartment_id: 'apt3', quote_id: 'q3', voter_user_id: 'u3' })).rejects.toThrow();
  });

  it('round 2 accepts quote in tiebreak set', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    await decRepo.create(makeVotingDecision('d1', 2));
    await quoteRepo.create(makeQuote('q1'));
    await quoteRepo.create(makeQuote('q2'));
    await voteRepo.create(new DecisionVote({ id: 'v1', decision_id: 'd1', round: 1, apartment_id: 'apt1', quote_id: 'q1', voted_by_user_id: 'u1' }));
    await voteRepo.create(new DecisionVote({ id: 'v2', decision_id: 'd1', round: 1, apartment_id: 'apt2', quote_id: 'q2', voted_by_user_id: 'u2' }));
    const uc = new CastVote(decRepo, quoteRepo, voteRepo);
    const vote = await uc.execute({ decision_id: 'd1', apartment_id: 'apt3', quote_id: 'q1', voter_user_id: 'u3' });
    expect(vote.round).toBe(2);
  });
});
