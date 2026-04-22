import { describe, it, expect } from 'bun:test';
import { UploadQuote } from '@/modules/decisions/application/use-cases/UploadQuote';
import { InMemoryDecisionRepo, InMemoryQuoteRepo } from '../fakes';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';

const future = (ms: number) => new Date(Date.now() + ms);
const past = (ms: number) => new Date(Date.now() - ms);

const makeReceptionDecision = () =>
  new Decision({
    id: 'd1', building_id: 'b1', created_by: 'u1',
    title: 'Reparación portón',
    reception_deadline: future(60_000),
    voting_deadline: future(120_000),
  });

describe('UploadQuote', () => {
  it('creates quote in RECEPTION decision', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    await decRepo.create(makeReceptionDecision());
    const uc = new UploadQuote(decRepo, quoteRepo);
    const q = await uc.execute({
      decision_id: 'd1', uploader_user_id: 'u1',
      provider_name: 'Acme SA', amount: 1500, file_url: '/file.pdf',
    });
    expect(q.provider_name).toBe('Acme SA');
    expect(q.amount).toBe(1500);
    expect(await quoteRepo.findById(q.id)).not.toBeNull();
  });

  it('throws 404 when decision not found', async () => {
    const uc = new UploadQuote(new InMemoryDecisionRepo(), new InMemoryQuoteRepo());
    await expect(uc.execute({
      decision_id: 'missing', uploader_user_id: 'u1',
      provider_name: 'Acme SA', amount: 1000, file_url: '/f.pdf',
    })).rejects.toThrow();
  });

  it('throws when decision is not in RECEPTION', async () => {
    const decRepo = new InMemoryDecisionRepo();
    // Create a decision in VOTING status by constructing with past reception_deadline
    const d = new Decision({
      id: 'd2', building_id: 'b1', created_by: 'u1',
      title: 'Pintura fachada',
      reception_deadline: past(5000),
      voting_deadline: future(60_000),
      status: DecisionStatus.VOTING,
    });
    await decRepo.create(d);
    const uc = new UploadQuote(decRepo, new InMemoryQuoteRepo());
    await expect(uc.execute({
      decision_id: 'd2', uploader_user_id: 'u1',
      provider_name: 'Beta SRL', amount: 2000, file_url: '/f.pdf',
    })).rejects.toThrow();
  });
});
