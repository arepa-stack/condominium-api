import { Decision, DecisionStatus } from './entities/Decision';
import { DecisionQuote } from './entities/DecisionQuote';
import { DecisionVote } from './entities/DecisionVote';
import { DecisionAuditLog, AuditEvent } from './entities/DecisionAuditLog';

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

export interface DecisionListFilters {
  building_id?: string;
  statuses?: DecisionStatus[];
  created_by?: string;
  search?: string;
  /** When set, filter to decisions where this user has cast a vote */
  has_my_vote_for_user_id?: string;
  pagination: PaginationOptions;
}

export interface DecisionRepository {
  create(d: Decision): Promise<Decision>;
  update(d: Decision): Promise<Decision>;
  findById(id: string): Promise<Decision | null>;
  findByIdLocked(id: string): Promise<Decision | null>; // SELECT ... FOR UPDATE
  list(filters: DecisionListFilters): Promise<PaginatedResult<Decision>>;
  acquireFinalizeLock(id: string): Promise<void>; // pg_advisory_xact_lock
}

export interface DecisionQuoteRepository {
  create(q: DecisionQuote): Promise<DecisionQuote>;
  update(q: DecisionQuote): Promise<DecisionQuote>;
  findById(id: string): Promise<DecisionQuote | null>;
  listForDecision(decisionId: string, includeDeleted?: boolean): Promise<DecisionQuote[]>;
  listForDecisionPaginated(
    decisionId: string,
    includeDeleted: boolean,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DecisionQuote>>;
}

export interface DecisionVoteRepository {
  create(v: DecisionVote): Promise<DecisionVote>;
  listForDecision(decisionId: string, round?: number): Promise<DecisionVote[]>;
  listForDecisionPaginated(
    decisionId: string,
    round: number | undefined,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DecisionVote>>;
  findByDecisionApartmentRound(
    decisionId: string,
    apartmentId: string,
    round: number,
  ): Promise<DecisionVote | null>;
  countByQuote(decisionId: string, round: number): Promise<Record<string, number>>;
}

export interface DecisionAuditLogRepository {
  record(args: {
    decision_id: string;
    event: AuditEvent;
    actor_user_id: string | null;
    payload?: Record<string, unknown> | null;
  }): Promise<DecisionAuditLog>;
  listForDecision(decisionId: string): Promise<DecisionAuditLog[]>;
  listForDecisionPaginated(
    decisionId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DecisionAuditLog>>;
}
