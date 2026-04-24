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

describe('ListQuotes.executePaginated', () => {
  it('returns empty paginated result when no quotes', async () => {
    const repo = new InMemoryQuoteRepo();
    const uc = new ListQuotes(repo);
    const result = await uc.executePaginated({ decision_id: 'd1' });
    expect(result.data).toEqual([]);
    expect(result.metadata.total).toBe(0);
    expect(result.metadata.total_pages).toBe(0);
    expect(result.metadata.has_next_page).toBe(false);
  });

  it('returns single page when total fits within limit', async () => {
    const repo = new InMemoryQuoteRepo();
    await repo.create(makeQuote('q1'));
    await repo.create(makeQuote('q2'));
    const uc = new ListQuotes(repo);
    const result = await uc.executePaginated({ decision_id: 'd1', limit: 20 });
    expect(result.data.length).toBe(2);
    expect(result.metadata.total).toBe(2);
    expect(result.metadata.total_pages).toBe(1);
    expect(result.metadata.has_next_page).toBe(false);
  });

  it('paginates across multiple pages', async () => {
    const repo = new InMemoryQuoteRepo();
    for (let i = 0; i < 12; i++) {
      await repo.create(makeQuote(`q${i}`));
    }
    const uc = new ListQuotes(repo);
    const page1 = await uc.executePaginated({ decision_id: 'd1', page: 1, limit: 5 });
    expect(page1.data.length).toBe(5);
    expect(page1.metadata.total).toBe(12);
    expect(page1.metadata.total_pages).toBe(3);
    expect(page1.metadata.has_next_page).toBe(true);

    const page3 = await uc.executePaginated({ decision_id: 'd1', page: 3, limit: 5 });
    expect(page3.data.length).toBe(2);
    expect(page3.metadata.has_next_page).toBe(false);
  });

  it('excludes deleted quotes when include_deleted is false', async () => {
    const repo = new InMemoryQuoteRepo();
    await repo.create(makeQuote('q1'));
    await repo.create(makeQuote('q2', true));
    const uc = new ListQuotes(repo);
    const result = await uc.executePaginated({ decision_id: 'd1' });
    expect(result.metadata.total).toBe(1);
    expect(result.data[0].id).toBe('q1');
  });
});
