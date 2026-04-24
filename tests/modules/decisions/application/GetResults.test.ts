import { describe, it, expect } from 'bun:test';
import { GetResults } from '@/modules/decisions/application/use-cases/GetResults';
import { InMemoryDecisionRepo, InMemoryQuoteRepo, InMemoryVoteRepo } from '../fakes';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';

const future = (ms: number) => new Date(Date.now() + ms);
const past = (ms: number) => new Date(Date.now() - ms);

const makeDecision = (status = DecisionStatus.VOTING) =>
  new Decision({
    id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón',
    reception_deadline: past(5000),
    voting_deadline: future(60_000),
    status,
  });

const makeQuote = (id: string) =>
  new DecisionQuote({ id, decision_id: 'd1', uploader_user_id: 'u1', provider_name: 'Prov ' + id, amount: 1000, file_url: '/f.pdf' });

const makeVote = (id: string, apt: string, quote: string) =>
  new DecisionVote({ id, decision_id: 'd1', round: 1, apartment_id: apt, quote_id: quote, voted_by_user_id: 'u' + id });

describe('GetResults', () => {
  it('returns zero participation when no votes', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    await decRepo.create(makeDecision());
    await quoteRepo.create(makeQuote('q1'));
    const uc = new GetResults(decRepo, quoteRepo, voteRepo, async () => 10);
    const result = await uc.execute('d1');
    expect(result.total_votes).toBe(0);
    expect(result.participation_pct).toBe(0);
    expect(result.tallies[0].votes).toBe(0);
  });

  it('computes participation_pct correctly', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    await decRepo.create(makeDecision());
    await quoteRepo.create(makeQuote('q1'));
    await quoteRepo.create(makeQuote('q2'));
    await voteRepo.create(makeVote('v1', 'apt1', 'q1'));
    await voteRepo.create(makeVote('v2', 'apt2', 'q1'));
    const uc = new GetResults(decRepo, quoteRepo, voteRepo, async () => 4);
    const result = await uc.execute('d1');
    expect(result.total_votes).toBe(2);
    expect(result.participation_pct).toBe(50);
    expect(result.tallies.find((t) => t.quote_id === 'q1')!.votes).toBe(2);
  });

  it('includes winner_quote_id when RESOLVED', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    const d = new Decision({
      id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón',
      reception_deadline: past(5000), voting_deadline: past(1000),
      status: DecisionStatus.RESOLVED, winner_quote_id: 'q1',
    });
    await decRepo.create(d);
    await quoteRepo.create(makeQuote('q1'));
    const uc = new GetResults(decRepo, quoteRepo, voteRepo, async () => 5);
    const result = await uc.execute('d1');
    expect(result.winner_quote_id).toBe('q1');
  });

  it('throws 404 when decision not found', async () => {
    const uc = new GetResults(new InMemoryDecisionRepo(), new InMemoryQuoteRepo(), new InMemoryVoteRepo(), async () => 0);
    await expect(uc.execute('missing')).rejects.toThrow();
  });

  it('early-finalize: ALL_VOTED when every apartment has voted', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    await decRepo.create(makeDecision());
    await quoteRepo.create(makeQuote('q1'));
    await voteRepo.create(makeVote('v1', 'apt1', 'q1'));
    await voteRepo.create(makeVote('v2', 'apt2', 'q1'));
    await voteRepo.create(makeVote('v3', 'apt3', 'q1'));
    const uc = new GetResults(decRepo, quoteRepo, voteRepo, async () => 3);
    const result = await uc.execute('d1');
    expect(result.is_early_finalizable).toBe(true);
    expect(result.early_finalize_reason).toBe('ALL_VOTED');
  });

  it('early-finalize: MATHEMATICALLY_DECIDED when leader lead > remaining', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    await decRepo.create(makeDecision());
    await quoteRepo.create(makeQuote('q1'));
    await quoteRepo.create(makeQuote('q2'));
    // 10 apts, 6 votes to q1, 2 to q2, remaining 2. 6-2=4 > 2 → decided.
    for (let i = 0; i < 6; i++) await voteRepo.create(makeVote('v' + i, 'apt' + i, 'q1'));
    for (let i = 0; i < 2; i++) await voteRepo.create(makeVote('w' + i, 'aptw' + i, 'q2'));
    const uc = new GetResults(decRepo, quoteRepo, voteRepo, async () => 10);
    const result = await uc.execute('d1');
    expect(result.is_early_finalizable).toBe(true);
    expect(result.early_finalize_reason).toBe('MATHEMATICALLY_DECIDED');
  });

  it('early-finalize: null when race is still open', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    await decRepo.create(makeDecision());
    await quoteRepo.create(makeQuote('q1'));
    await quoteRepo.create(makeQuote('q2'));
    await voteRepo.create(makeVote('v1', 'apt1', 'q1'));
    const uc = new GetResults(decRepo, quoteRepo, voteRepo, async () => 10);
    const result = await uc.execute('d1');
    expect(result.is_early_finalizable).toBe(false);
    expect(result.early_finalize_reason).toBeNull();
  });

  it('early-finalize: false when status is not VOTING', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    await decRepo.create(makeDecision(DecisionStatus.RECEPTION));
    await quoteRepo.create(makeQuote('q1'));
    const uc = new GetResults(decRepo, quoteRepo, voteRepo, async () => 3);
    const result = await uc.execute('d1');
    expect(result.is_early_finalizable).toBe(false);
    expect(result.early_finalize_reason).toBeNull();
  });
});
