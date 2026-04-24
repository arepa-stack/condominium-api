import { Decision } from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';
import { DecisionAuditLog, AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
  DecisionRepository,
  DecisionQuoteRepository,
  DecisionVoteRepository,
  DecisionAuditLogRepository,
  DecisionListFilters,
  PaginatedResult,
  PaginationOptions,
} from '@/modules/decisions/domain/repository';
import { randomUUID } from 'crypto';

export class InMemoryDecisionRepo implements DecisionRepository {
  public store = new Map<string, Decision>();

  async create(d: Decision) {
    this.store.set(d.id, d);
    return d;
  }

  async update(d: Decision) {
    this.store.set(d.id, d);
    return d;
  }

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }

  async findByIdLocked(id: string) {
    return this.findById(id);
  }

  async acquireFinalizeLock(_id: string) {
    /* no-op in memory */
  }

  async list(f: DecisionListFilters): Promise<PaginatedResult<Decision>> {
    let items = [...this.store.values()];
    if (f.building_id) items = items.filter((d) => d.building_id === f.building_id);
    if (f.statuses?.length) items = items.filter((d) => f.statuses!.includes(d.status));
    if (f.created_by) items = items.filter((d) => d.created_by === f.created_by);
    if (f.search) items = items.filter((d) => d.title.toLowerCase().includes(f.search!.toLowerCase()));
    const total = items.length;
    const start = (f.pagination.page - 1) * f.pagination.limit;
    items = items.slice(start, start + f.pagination.limit);
    return { items, total };
  }
}

export class InMemoryQuoteRepo implements DecisionQuoteRepository {
  public store = new Map<string, DecisionQuote>();

  async create(q: DecisionQuote) {
    this.store.set(q.id, q);
    return q;
  }

  async update(q: DecisionQuote) {
    this.store.set(q.id, q);
    return q;
  }

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }

  async listForDecision(did: string, includeDeleted = false) {
    return [...this.store.values()].filter(
      (q) => q.decision_id === did && (includeDeleted || !q.isDeleted),
    );
  }

  async listForDecisionPaginated(
    did: string,
    includeDeleted: boolean,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DecisionQuote>> {
    const all = await this.listForDecision(did, includeDeleted);
    const total = all.length;
    const start = (pagination.page - 1) * pagination.limit;
    return { items: all.slice(start, start + pagination.limit), total };
  }
}

export class InMemoryVoteRepo implements DecisionVoteRepository {
  public store = new Map<string, DecisionVote>();

  async create(v: DecisionVote) {
    const isDuplicate = [...this.store.values()].some(
      (x) => x.decision_id === v.decision_id && x.round === v.round && x.apartment_id === v.apartment_id,
    );
    if (isDuplicate) {
      const err: any = new Error('unique violation');
      err.code = 'VOTE_ALREADY_CAST';
      throw err;
    }
    const key = `${v.decision_id}|${v.round}|${v.apartment_id}`;
    this.store.set(key, v);
    return v;
  }

  async listForDecision(did: string, round?: number) {
    return [...this.store.values()].filter(
      (v) => v.decision_id === did && (round === undefined || v.round === round),
    );
  }

  async listForDecisionPaginated(
    did: string,
    round: number | undefined,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DecisionVote>> {
    const all = await this.listForDecision(did, round);
    const total = all.length;
    const start = (pagination.page - 1) * pagination.limit;
    return { items: all.slice(start, start + pagination.limit), total };
  }

  async findByDecisionApartmentRound(did: string, apt: string, r: number) {
    return (
      [...this.store.values()].find(
        (v) => v.decision_id === did && v.apartment_id === apt && v.round === r,
      ) ?? null
    );
  }

  async countByQuote(did: string, round: number) {
    const out: Record<string, number> = {};
    for (const v of await this.listForDecision(did, round)) {
      out[v.quote_id] = (out[v.quote_id] ?? 0) + 1;
    }
    return out;
  }
}

export class InMemoryAuditRepo implements DecisionAuditLogRepository {
  public store: DecisionAuditLog[] = [];

  async record(args: {
    decision_id: string;
    event: AuditEvent;
    actor_user_id: string | null;
    payload?: Record<string, unknown> | null;
  }) {
    const e = new DecisionAuditLog({
      id: randomUUID(),
      decision_id: args.decision_id,
      event: args.event,
      actor_user_id: args.actor_user_id,
      payload: args.payload ?? null,
    });
    this.store.push(e);
    return e;
  }

  async listForDecision(did: string) {
    return this.store.filter((e) => e.decision_id === did);
  }

  async listForDecisionPaginated(
    did: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DecisionAuditLog>> {
    const all = await this.listForDecision(did);
    const total = all.length;
    const start = (pagination.page - 1) * pagination.limit;
    return { items: all.slice(start, start + pagination.limit), total };
  }
}
