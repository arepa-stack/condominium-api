import { describe, it, expect } from 'bun:test';
import { GenerateCharge } from '@/modules/decisions/application/use-cases/GenerateCharge';
import { InMemoryDecisionRepo, InMemoryQuoteRepo, InMemoryAuditRepo } from '../fakes';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { ChargeRequest, ChargeResult, InvoiceChargeGenerator, AssessmentChargeGenerator } from '@/modules/decisions/application/ports/ChargeGenerator';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

const past = (ms: number) => new Date(Date.now() - ms);

const makeResolvedDecision = (winner_quote_id = 'q1') =>
  new Decision({
    id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón',
    reception_deadline: past(10_000), voting_deadline: past(1000),
    status: DecisionStatus.RESOLVED, winner_quote_id,
  });

const makeQuote = () =>
  new DecisionQuote({ id: 'q1', decision_id: 'd1', uploader_user_id: 'u1', provider_name: 'Acme SA', amount: 5000, file_url: '/f.pdf' });

class FakeInvoiceGen implements InvoiceChargeGenerator {
  calls: ChargeRequest[] = [];
  async generate(req: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(req);
    return { type: 'INVOICE', id: 'inv-123' };
  }
}
class FakeAssessmentGen implements AssessmentChargeGenerator {
  calls: ChargeRequest[] = [];
  async generate(req: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(req);
    return { type: 'ASSESSMENT', id: 'asm-456' };
  }
}

describe('GenerateCharge', () => {
  it('generates an INVOICE for resolved decision', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const audit = new InMemoryAuditRepo();
    const invoiceGen = new FakeInvoiceGen();
    const assessmentGen = new FakeAssessmentGen();
    await decRepo.create(makeResolvedDecision());
    await quoteRepo.create(makeQuote());
    const uc = new GenerateCharge(decRepo, quoteRepo, audit, invoiceGen, assessmentGen);
    const result = await uc.execute({ decision_id: 'd1', type: 'INVOICE', actor_user_id: 'admin-1' });
    expect(result.resulting.type).toBe('INVOICE');
    expect(result.resulting.id).toBe('inv-123');
    expect(invoiceGen.calls.length).toBe(1);
    expect(invoiceGen.calls[0].amount).toBe(5000);
    const d = await decRepo.findById('d1');
    expect(d!.resulting_type).toBe('INVOICE');
    expect(d!.resulting_id).toBe('inv-123');
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.CHARGE_GENERATED);
  });

  it('generates an ASSESSMENT for resolved decision', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const invoiceGen = new FakeInvoiceGen();
    const assessmentGen = new FakeAssessmentGen();
    await decRepo.create(makeResolvedDecision());
    await quoteRepo.create(makeQuote());
    const uc = new GenerateCharge(decRepo, quoteRepo, new InMemoryAuditRepo(), invoiceGen, assessmentGen);
    const result = await uc.execute({ decision_id: 'd1', type: 'ASSESSMENT', actor_user_id: 'admin-1' });
    expect(result.resulting.type).toBe('ASSESSMENT');
    expect(result.resulting.id).toBe('asm-456');
    expect(assessmentGen.calls.length).toBe(1);
  });

  it('respects amount_override', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const invoiceGen = new FakeInvoiceGen();
    await decRepo.create(makeResolvedDecision());
    await quoteRepo.create(makeQuote());
    const uc = new GenerateCharge(decRepo, quoteRepo, new InMemoryAuditRepo(), invoiceGen, new FakeAssessmentGen());
    await uc.execute({ decision_id: 'd1', type: 'INVOICE', actor_user_id: 'admin-1', amount_override: 3000 });
    expect(invoiceGen.calls[0].amount).toBe(3000);
  });

  it('throws 409 when decision already has a charge', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const invoiceGen = new FakeInvoiceGen();
    await decRepo.create(makeResolvedDecision());
    await quoteRepo.create(makeQuote());
    const uc = new GenerateCharge(decRepo, quoteRepo, new InMemoryAuditRepo(), invoiceGen, new FakeAssessmentGen());
    await uc.execute({ decision_id: 'd1', type: 'INVOICE', actor_user_id: 'admin-1' });
    await expect(uc.execute({ decision_id: 'd1', type: 'INVOICE', actor_user_id: 'admin-1' })).rejects.toThrow();
  });

  it('throws 422 when decision is not RESOLVED', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const d = new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: past(10_000), voting_deadline: past(1000), status: DecisionStatus.VOTING });
    await decRepo.create(d);
    await quoteRepo.create(makeQuote());
    const uc = new GenerateCharge(decRepo, quoteRepo, new InMemoryAuditRepo(), new FakeInvoiceGen(), new FakeAssessmentGen());
    await expect(uc.execute({ decision_id: 'd1', type: 'INVOICE', actor_user_id: 'admin-1' })).rejects.toThrow();
  });
});
