import { describe, expect, it } from 'bun:test';
import { AwardSoleQuote } from '@/modules/decisions/application/use-cases/AwardSoleQuote';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
  InMemoryAuditRepo,
  InMemoryDecisionRepo,
  InMemoryQuoteRepo,
} from '../fakes';

const future = (milliseconds: number) => new Date(Date.now() + milliseconds);

const makeDecision = (status = DecisionStatus.RECEPTION) => new Decision({
  id: 'd1',
  building_id: 'b1',
  created_by: 'admin-1',
  title: 'Reparación del ascensor',
  reception_deadline: future(60_000),
  voting_deadline: future(120_000),
  status,
});

const makeQuote = (id: string, deleted = false) => new DecisionQuote({
  id,
  decision_id: 'd1',
  uploader_user_id: 'admin-1',
  provider_name: `Proveedor ${id}`,
  amount: 1250,
  file_url: `/${id}.pdf`,
  deleted_at: deleted ? new Date() : null,
  deleted_by: deleted ? 'admin-1' : null,
  deletion_reason: deleted ? 'Cotización reemplazada' : null,
});

const buildUseCase = () => {
  const decisions = new InMemoryDecisionRepo();
  const quotes = new InMemoryQuoteRepo();
  const audit = new InMemoryAuditRepo();
  return {
    decisions,
    quotes,
    audit,
    useCase: new AwardSoleQuote(decisions, quotes, audit),
  };
};

describe('AwardSoleQuote', () => {
  it('resolves a RECEPTION decision with its only active quote', async () => {
    const ctx = buildUseCase();
    await ctx.decisions.create(makeDecision());
    await ctx.quotes.create(makeQuote('q1'));

    const result = await ctx.useCase.execute({
      decision_id: 'd1',
      actor_user_id: 'admin-1',
      reason: 'Es el único proveedor disponible',
    });

    expect(result.status).toBe(DecisionStatus.RESOLVED);
    expect(result.winner_quote_id).toBe('q1');
    expect(result.current_round).toBe(1);

    const logs = await ctx.audit.listForDecision('d1');
    expect(logs).toHaveLength(1);
    expect(logs[0].event).toBe(AuditEvent.DIRECT_AWARD);
    expect(logs[0].payload).toMatchObject({
      winner_quote_id: 'q1',
      provider_name: 'Proveedor q1',
      amount: 1250,
      reason: 'Es el único proveedor disponible',
    });
  });

  it('ignores deleted quotes when verifying the sole active quote', async () => {
    const ctx = buildUseCase();
    await ctx.decisions.create(makeDecision());
    await ctx.quotes.create(makeQuote('q-deleted', true));
    await ctx.quotes.create(makeQuote('q-active'));

    const result = await ctx.useCase.execute({
      decision_id: 'd1',
      actor_user_id: 'admin-1',
      reason: 'Única cotización activa disponible',
    });

    expect(result.winner_quote_id).toBe('q-active');
  });

  it('rejects a direct award when there are no active quotes', async () => {
    const ctx = buildUseCase();
    await ctx.decisions.create(makeDecision());

    await expect(ctx.useCase.execute({
      decision_id: 'd1',
      actor_user_id: 'admin-1',
      reason: 'No hay otra alternativa disponible',
    })).rejects.toMatchObject({ code: 'DECISION_NO_ACTIVE_QUOTES' });
  });

  it('requires an auditable reason', async () => {
    const ctx = buildUseCase();
    await ctx.decisions.create(makeDecision());
    await ctx.quotes.create(makeQuote('q1'));

    await expect(ctx.useCase.execute({
      decision_id: 'd1',
      actor_user_id: 'admin-1',
      reason: '   ',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect((await ctx.decisions.findById('d1'))?.status).toBe(DecisionStatus.RECEPTION);
  });

  it('rejects a direct award when more than one active quote exists', async () => {
    const ctx = buildUseCase();
    await ctx.decisions.create(makeDecision());
    await ctx.quotes.create(makeQuote('q1'));
    await ctx.quotes.create(makeQuote('q2'));

    await expect(ctx.useCase.execute({
      decision_id: 'd1',
      actor_user_id: 'admin-1',
      reason: 'Selección administrativa directa',
    })).rejects.toMatchObject({
      code: 'DECISION_DIRECT_AWARD_REQUIRES_SINGLE_QUOTE',
    });
  });

  it('rejects direct award outside RECEPTION', async () => {
    const ctx = buildUseCase();
    await ctx.decisions.create(makeDecision(DecisionStatus.VOTING));
    await ctx.quotes.create(makeQuote('q1'));

    await expect(ctx.useCase.execute({
      decision_id: 'd1',
      actor_user_id: 'admin-1',
      reason: 'Selección administrativa directa',
    })).rejects.toMatchObject({ code: 'DECISION_WRONG_STATUS' });
  });

  it('is idempotent after the decision was already resolved', async () => {
    const ctx = buildUseCase();
    const decision = makeDecision();
    decision.awardDirectly('q1');
    await ctx.decisions.create(decision);

    const result = await ctx.useCase.execute({
      decision_id: 'd1',
      actor_user_id: 'admin-1',
      reason: 'Reintento de la misma operación',
    });

    expect(result.winner_quote_id).toBe('q1');
    expect(await ctx.audit.listForDecision('d1')).toHaveLength(0);
  });
});
