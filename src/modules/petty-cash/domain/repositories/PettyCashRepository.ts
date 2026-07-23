import { PettyCashFund } from '../entities/PettyCashFund';
import { PettyCashEntry } from '../entities/PettyCashEntry';
import { PettyCashAssessment } from '../entities/PettyCashAssessment';
import {
    PettyCashEntryType,
    PettyCashCategory,
} from '@/core/domain/enums';
import { PaginationFilters } from '@/core/domain/pagination';

export interface EntryHistoryFilters {
    type?: PettyCashEntryType;
    category?: PettyCashCategory;
    limit?: number;
    offset?: number;
}

export interface EntryFilters {
    type?: PettyCashEntryType;
    category?: PettyCashCategory;
}

export interface PettyCashRepository {
    // ── Fund (metadata only — balance comes from getBalance) ──────────────
    findFundByBuildingId(buildingId: string): Promise<PettyCashFund | null>;

    /**
     * Upsert the fund metadata row for a building. Creates one if
     * missing, returns the persisted instance with id populated. This
     * is the only path that inserts into `petty_cash_fund`.
     */
    findOrCreateFund(buildingId: string): Promise<PettyCashFund>;

    /**
     * Live balance from the petty_cash_balance view. Returns 0 if the
     * fund has no entries yet.
     */
    getBalance(fundId: string): Promise<number>;

    /**
     * Net balance split by the currency actually held (físico USD vs
     * bolívares). Sums signed original_amount per currency bucket.
     */
    getBalanceByCurrency(fundId: string): Promise<{ currency: string; balance: number }[]>;

    // ── Entries (append-only ledger) ──────────────────────────────────────
    addEntry(entry: PettyCashEntry): Promise<PettyCashEntry>;
    findEntryById(entryId: string): Promise<PettyCashEntry | null>;
    findEntriesByFundId(
        fundId: string,
        filters: EntryHistoryFilters
    ): Promise<PettyCashEntry[]>;

    findEntriesByFundIdPaginated(
        fundId: string,
        filters: EntryFilters,
        pagination: PaginationFilters
    ): Promise<{ items: PettyCashEntry[]; total: number }>;

    /**
     * Entries that reference a given external id (invoice or another
     * entry). Used by reversal flows and for idempotency checks.
     */
    findEntriesByReference(
        referenceType: string,
        referenceId: string
    ): Promise<PettyCashEntry[]>;

    /**
     * Returns the set of original-entry IDs that have been reversed in
     * the given fund. A reversal entry with type='reversal' and
     * reference_type='reversal' points its reference_id at the original
     * entry being counter-asiento'd; this query returns those reference_id
     * values so callers can mark the originals as reversed.
     *
     * Used by GetPettyCashHistory to attach is_reversed to each entry
     * without the frontend doing client-side set math.
     */
    findReversedOriginalIds(fundId: string): Promise<Set<string>>;

    /**
     * Update the target_fund amount for a given fund.
     * Slice B: used by SetTargetFund use case.
     */
    updateFundTargetFund(fundId: string, targetFund: number): Promise<void>;

    // ── Assessment batches ────────────────────────────────────────────────
    createAssessment(assessment: PettyCashAssessment): Promise<PettyCashAssessment>;
    findAssessmentsByFundId(fundId: string): Promise<PettyCashAssessment[]>;
    findAssessmentsByPeriod(
        fundId: string,
        period: string
    ): Promise<PettyCashAssessment[]>;
    /**
     * Fetch a single assessment by its primary key.
     * Slice B: used by CancelExpressAssessment.
     */
    findAssessmentById(assessmentId: string): Promise<PettyCashAssessment | null>;
}
