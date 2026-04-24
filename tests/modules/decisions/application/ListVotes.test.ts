import { describe, it, expect } from 'bun:test';
import { ListVotes } from '@/modules/decisions/application/use-cases/ListVotes';
import { InMemoryVoteRepo } from '../fakes';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';

const makeVote = (id: string, round: number, apt: string, label: string | null = null) =>
  new DecisionVote({
    id,
    decision_id: 'd1',
    round,
    apartment_id: apt,
    quote_id: 'q1',
    voted_by_user_id: 'u1',
    apartment_label: label,
  });

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

describe('ListVotes.executePaginated', () => {
  it('returns empty paginated result when no votes', async () => {
    const repo = new InMemoryVoteRepo();
    const uc = new ListVotes(repo);
    const result = await uc.executePaginated({ decision_id: 'd1' });
    expect(result.data).toEqual([]);
    expect(result.metadata.total).toBe(0);
    expect(result.metadata.page).toBe(1);
    expect(result.metadata.total_pages).toBe(0);
    expect(result.metadata.has_next_page).toBe(false);
    expect(result.metadata.has_prev_page).toBe(false);
  });

  it('returns single page when total fits within limit', async () => {
    const repo = new InMemoryVoteRepo();
    await repo.create(makeVote('v1', 1, 'apt1', '3B'));
    await repo.create(makeVote('v2', 1, 'apt2', 'PH-2'));
    const uc = new ListVotes(repo);
    const result = await uc.executePaginated({ decision_id: 'd1', limit: 20 });
    expect(result.data.length).toBe(2);
    expect(result.metadata.total).toBe(2);
    expect(result.metadata.total_pages).toBe(1);
    expect(result.metadata.has_next_page).toBe(false);
  });

  it('paginates across multiple pages', async () => {
    const repo = new InMemoryVoteRepo();
    for (let i = 0; i < 25; i++) {
      await repo.create(makeVote(`v${i}`, 1, `apt${i}`, `${i}A`));
    }
    const uc = new ListVotes(repo);
    const page1 = await uc.executePaginated({ decision_id: 'd1', page: 1, limit: 10 });
    expect(page1.data.length).toBe(10);
    expect(page1.metadata.total).toBe(25);
    expect(page1.metadata.total_pages).toBe(3);
    expect(page1.metadata.has_next_page).toBe(true);
    expect(page1.metadata.has_prev_page).toBe(false);

    const page3 = await uc.executePaginated({ decision_id: 'd1', page: 3, limit: 10 });
    expect(page3.data.length).toBe(5);
    expect(page3.metadata.has_next_page).toBe(false);
    expect(page3.metadata.has_prev_page).toBe(true);
  });

  it('emits apartment_label on each item', async () => {
    const repo = new InMemoryVoteRepo();
    await repo.create(makeVote('v1', 1, 'apt1', '3B'));
    const uc = new ListVotes(repo);
    const result = await uc.executePaginated({ decision_id: 'd1' });
    expect(result.data[0].apartment_label).toBe('3B');
    expect(result.data[0].toJSON().apartment_label).toBe('3B');
  });
});
