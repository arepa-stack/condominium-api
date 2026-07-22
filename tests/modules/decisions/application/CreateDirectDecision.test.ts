import { describe, expect, it } from 'bun:test';
import { CreateDirectDecision } from '@/modules/decisions/application/use-cases/CreateDirectDecision';
import {
  DecisionProcessType,
  DecisionStatus,
} from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
  InMemoryAuditRepo,
  InMemoryDecisionRepo,
  InMemoryQuoteRepo,
} from '../fakes';

const buildUseCase = () => {
  const decisions = new InMemoryDecisionRepo();
  const quotes = new InMemoryQuoteRepo();
  const audit = new InMemoryAuditRepo();
  return {
    decisions,
    quotes,
    audit,
    useCase: new CreateDirectDecision(decisions, quotes, audit),
  };
};

const input = {
  decisionId: 'd1',
  quoteId: 'q1',
  buildingId: 'b1',
  actorUserId: 'admin-1',
  title: 'Reparación urgente del ascensor',
  description: 'Proveedor autorizado por el fabricante',
  providerName: 'Ascensores ACME',
  amount: 4200,
  notes: 'Incluye repuestos',
  fileUrl: '/quote.pdf',
  reason: 'Es el único servicio técnico autorizado',
};

describe('CreateDirectDecision', () => {
  it('creates the quote and resolves the decision without voting', async () => {
    const ctx = buildUseCase();

    const result = await ctx.useCase.execute(input);

    expect(result.decision.id).toBe('d1');
    expect(result.decision.status).toBe(DecisionStatus.RESOLVED);
    expect(result.decision.process_type).toBe(DecisionProcessType.DIRECT_AWARD);
    expect(result.decision.winner_quote_id).toBe('q1');
    expect(result.quote.id).toBe('q1');
    expect(result.quote.provider_name).toBe('Ascensores ACME');
    expect(result.quote.amount).toBe(4200);
    expect(await ctx.quotes.listForDecision('d1')).toHaveLength(1);

    const logs = await ctx.audit.listForDecision('d1');
    expect(logs.map((entry) => entry.event)).toEqual([
      AuditEvent.CREATED,
      AuditEvent.DIRECT_AWARD,
    ]);
    expect(logs[1].payload).toMatchObject({
      winner_quote_id: 'q1',
      reason: 'Es el único servicio técnico autorizado',
    });
  });

  it('rejects an empty justification before creating records', async () => {
    const ctx = buildUseCase();

    await expect(ctx.useCase.execute({
      ...input,
      reason: '  ',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(await ctx.decisions.findById('d1')).toBeNull();
    expect(await ctx.quotes.listForDecision('d1')).toHaveLength(0);
  });

  it('rejects an invalid quote amount', async () => {
    const ctx = buildUseCase();

    await expect(ctx.useCase.execute({
      ...input,
      amount: 0,
    })).rejects.toMatchObject({ code: 'QUOTE_INVALID_AMOUNT' });

    expect(await ctx.decisions.findById('d1')).toBeNull();
    expect(await ctx.quotes.listForDecision('d1')).toHaveLength(0);
  });
});
