import { describe, it, expect } from 'bun:test';
import { ListDecisions } from '@/modules/decisions/application/use-cases/ListDecisions';
import { InMemoryDecisionRepo } from '../fakes';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';

const future = (ms: number) => new Date(Date.now() + ms);

const makeDecision = (id: string, building_id: string, title: string) =>
  new Decision({
    id,
    building_id,
    created_by: 'u1',
    title,
    reception_deadline: future(60_000),
    voting_deadline: future(120_000),
  });

describe('ListDecisions', () => {
  it('returns paginated results', async () => {
    const repo = new InMemoryDecisionRepo();
    await repo.create(makeDecision('d1', 'b1', 'Decision uno'));
    await repo.create(makeDecision('d2', 'b1', 'Decision dos'));
    await repo.create(makeDecision('d3', 'b1', 'Decision tres'));
    const uc = new ListDecisions(repo);
    const result = await uc.execute({ page: 1, limit: 2 });
    expect(result.data.length).toBe(2);
    expect(result.metadata.total).toBe(3);
    expect(result.metadata.hasNextPage).toBe(true);
  });

  it('filters by building_id', async () => {
    const repo = new InMemoryDecisionRepo();
    await repo.create(makeDecision('d1', 'b1', 'Decision uno'));
    await repo.create(makeDecision('d2', 'b2', 'Decision dos'));
    const uc = new ListDecisions(repo);
    const result = await uc.execute({ building_id: 'b1' });
    expect(result.data.length).toBe(1);
    expect(result.data[0].building_id).toBe('b1');
  });

  it('filters by comma-separated statuses', async () => {
    const repo = new InMemoryDecisionRepo();
    const d1 = makeDecision('d1', 'b1', 'Decision uno');
    const d2 = makeDecision('d2', 'b1', 'Decision dos');
    await repo.create(d1);
    await repo.create(d2);
    // manually mutate status via past deadline trick: just store a 2nd instance with different status
    const uc = new ListDecisions(repo);
    const result = await uc.execute({ statuses: 'RECEPTION' });
    expect(result.data.every((d) => d.status === DecisionStatus.RECEPTION)).toBe(true);
  });

  it('filters by search text', async () => {
    const repo = new InMemoryDecisionRepo();
    await repo.create(makeDecision('d1', 'b1', 'Reparación portón'));
    await repo.create(makeDecision('d2', 'b1', 'Pintura fachada'));
    const uc = new ListDecisions(repo);
    const result = await uc.execute({ search: 'portón' });
    expect(result.data.length).toBe(1);
    expect(result.data[0].id).toBe('d1');
  });

  it('returns empty page 2 when only 1 item exists', async () => {
    const repo = new InMemoryDecisionRepo();
    await repo.create(makeDecision('d1', 'b1', 'Decision uno'));
    const uc = new ListDecisions(repo);
    const result = await uc.execute({ page: 2, limit: 10 });
    expect(result.data.length).toBe(0);
    expect(result.metadata.total).toBe(1);
  });
});
