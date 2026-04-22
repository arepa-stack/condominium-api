import { describe, it, expect } from 'bun:test';
import { FinalizeDecision } from '@/modules/decisions/application/use-cases/FinalizeDecision';
import { InMemoryDecisionRepo, InMemoryQuoteRepo, InMemoryVoteRepo, InMemoryAuditRepo } from '../fakes';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

const past = (ms: number) => new Date(Date.now() - ms);
const future = (ms: number) => new Date(Date.now() + ms);

const makeDecisionReceptionExpired = () =>
  new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: past(5000), voting_deadline: future(60_000) });

const makeVotingDecision = (id = 'd1', round = 1) =>
  new Decision({ id, building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: past(10_000), voting_deadline: past(1000), status: DecisionStatus.VOTING, current_round: round });

const makeQuote = (id: string, decId = 'd1', deleted = false) => {
  const q = new DecisionQuote({ id, decision_id: decId, uploader_user_id: 'u1', provider_name: 'Acme', amount: 1000, file_url: '/f.pdf' });
  if (deleted) q.softDelete('admin', 'test');
  return q;
};

const makeVote = (id: string, apt: string, quote: string, round = 1) =>
  new DecisionVote({ id, decision_id: 'd1', round, apartment_id: apt, quote_id: quote, voted_by_user_id: 'u' + id });

describe('FinalizeDecision', () => {
  it('RECEPTION expired → advances to VOTING', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeDecisionReceptionExpired());
    const uc = new FinalizeDecision(decRepo, quoteRepo, voteRepo, audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.outcome).toBe('ADVANCED_TO_VOTING');
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.PHASE_ADVANCED);
  });

  it('VOTING with clear winner → RESOLVED', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1'));
    await quoteRepo.create(makeQuote('q2'));
    await voteRepo.create(makeVote('v1', 'apt1', 'q1'));
    await voteRepo.create(makeVote('v2', 'apt2', 'q1'));
    await voteRepo.create(makeVote('v3', 'apt3', 'q2'));
    const uc = new FinalizeDecision(decRepo, quoteRepo, voteRepo, audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.outcome).toBe('RESOLVED');
    const d = await decRepo.findById('d1');
    expect(d!.status).toBe(DecisionStatus.RESOLVED);
    expect(d!.winner_quote_id).toBe('q1');
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.FINALIZED);
  });

  it('VOTING with tie round 1 → opens tiebreak (round 2)', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1'));
    await quoteRepo.create(makeQuote('q2'));
    await voteRepo.create(makeVote('v1', 'apt1', 'q1'));
    await voteRepo.create(makeVote('v2', 'apt2', 'q2'));
    const uc = new FinalizeDecision(decRepo, quoteRepo, voteRepo, audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.outcome).toBe('TIEBREAK_OPENED');
    const d = await decRepo.findById('d1');
    expect(d!.current_round).toBe(2);
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.TIEBREAK_OPENED);
  });

  it('VOTING with tie round 2 → TIEBREAK_PENDING (manual resolution)', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeVotingDecision('d1', 2));
    await quoteRepo.create(makeQuote('q1'));
    await quoteRepo.create(makeQuote('q2'));
    await voteRepo.create(makeVote('v1', 'apt1', 'q1', 2));
    await voteRepo.create(makeVote('v2', 'apt2', 'q2', 2));
    const uc = new FinalizeDecision(decRepo, quoteRepo, voteRepo, audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.outcome).toBe('TIEBREAK_PENDING_MANUAL');
    const d = await decRepo.findById('d1');
    expect(d!.status).toBe(DecisionStatus.TIEBREAK_PENDING);
  });

  it('VOTING with no votes → TIEBREAK_PENDING', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1'));
    const uc = new FinalizeDecision(decRepo, quoteRepo, new InMemoryVoteRepo(), audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.outcome).toBe('TIEBREAK_PENDING_MANUAL');
  });

  it('VOTING with no active quotes → TIEBREAK_PENDING', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1', 'd1', true));
    const uc = new FinalizeDecision(decRepo, quoteRepo, new InMemoryVoteRepo(), audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.outcome).toBe('TIEBREAK_PENDING_MANUAL');
  });

  it('throws 404 when decision not found', async () => {
    const uc = new FinalizeDecision(new InMemoryDecisionRepo(), new InMemoryQuoteRepo(), new InMemoryVoteRepo(), new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'missing', actor_user_id: 'system' })).rejects.toThrow();
  });

  it('throws when decision already resolved', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const d = new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: past(10_000), voting_deadline: past(1000), status: DecisionStatus.RESOLVED, winner_quote_id: 'q1' });
    await decRepo.create(d);
    const uc = new FinalizeDecision(decRepo, new InMemoryQuoteRepo(), new InMemoryVoteRepo(), new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'd1', actor_user_id: 'system' })).rejects.toThrow();
  });
});
