import { describe, it, expect } from 'bun:test';
import { ListQuotes } from '@/modules/decisions/application/use-cases/ListQuotes';
import { InMemoryQuoteRepo } from '../fakes';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';

const makeQuote = (id: string, deleted = false) => {
  const q = new DecisionQuote({
    id, decision_id: 'd1', uploader_user_id: 'u1',
    provider_name: 'Acme SA', amount: 1000, file_url: '/f.pdf',
  });
  if (deleted) q.softDelete('admin', 'test deletion');
  return q;
};

describe('ListQuotes', () => {
  it('returns only non-deleted quotes by default', async () => {
    const repo = new InMemoryQuoteRepo();
    await repo.create(makeQuote('q1'));
    await repo.create(makeQuote('q2', true));
    const uc = new ListQuotes(repo);
    const result = await uc.execute('d1');
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('q1');
  });

  it('includes deleted when includeDeleted=true', async () => {
    const repo = new InMemoryQuoteRepo();
    await repo.create(makeQuote('q1'));
    await repo.create(makeQuote('q2', true));
    const uc = new ListQuotes(repo);
    const result = await uc.execute('d1', true);
    expect(result.length).toBe(2);
  });
});
