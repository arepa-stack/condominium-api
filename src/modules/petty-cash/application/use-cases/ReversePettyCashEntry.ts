import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashEntry } from '../../domain/entities/PettyCashEntry';
import {
    PettyCashEntryType,
    PettyCashEntryReferenceType,
} from '@/core/domain/enums';
import { NotFoundError, DomainError } from '@/core/errors';

export interface ReversePettyCashEntryDTO {
    entryId: string;
    reason: string;
    userId: string;
    /**
     * Scope enforcement: the route resolves buildingId from the path
     * and passes it down. The use case refuses the operation if the
     * target entry belongs to a fund in a different building — even if
     * the caller had valid auth for THIS buildingId, they shouldn't be
     * allowed to reverse entries outside of it.
     */
    buildingId: string;
}

/**
 * Emit a counter-asiento for a petty-cash ledger entry.
 *
 * Append-only discipline: we never mutate or delete the original
 * entry. A reversal is a NEW row with `type = REVERSAL`, amount flipped
 * in sign, and reference fields pointing back to the original for
 * audit + idempotency.
 *
 * Business rules:
 *  - The target entry must exist.
 *  - You cannot reverse a reversal (no double-negation in the UI —
 *    if the original was wrongly reversed, emit a fresh entry with
 *    the correct sign manually).
 *  - Idempotent: if a reversal already exists that points to this
 *    entry, we return the existing one instead of inserting a
 *    duplicate.
 *
 * Who can call this: ADMIN or BOARD of the building that owns the
 * fund. The route layer enforces that via requireRole +
 * requireBuildingAccess; this use case trusts the caller.
 */
export class ReversePettyCashEntry {
    constructor(private pettyCashRepo: PettyCashRepository) { }

    async execute(dto: ReversePettyCashEntryDTO): Promise<PettyCashEntry> {
        if (!dto.reason?.trim()) {
            throw new DomainError(
                'Reason is required for a petty cash entry reversal',
                'VALIDATION_ERROR',
                400
            );
        }

        const original = await this.pettyCashRepo.findEntryById(dto.entryId);
        if (!original) {
            throw new NotFoundError(`Petty cash entry ${dto.entryId} not found`);
        }

        // Scope check: the entry must belong to the fund of the
        // buildingId the caller claims. Prevents an authorized BOARD of
        // building A from reversing entries of building B.
        const fund = await this.pettyCashRepo.findFundByBuildingId(dto.buildingId);
        if (!fund || fund.id !== original.fund_id) {
            throw new NotFoundError(
                `Petty cash entry ${dto.entryId} does not belong to this building`
            );
        }

        if (original.type === PettyCashEntryType.REVERSAL) {
            throw new DomainError(
                'Cannot reverse a reversal — emit a fresh entry instead',
                'INVALID_OPERATION',
                409
            );
        }

        // Idempotency: if the original has already been reversed, return
        // the existing counter-asiento. Uses reference_type=REVERSAL +
        // reference_id=original.id as the unique marker.
        const existing = await this.pettyCashRepo.findEntriesByReference(
            PettyCashEntryReferenceType.REVERSAL,
            dto.entryId
        );
        if (existing.length > 0) {
            return existing[0];
        }

        const reversalEntry = PettyCashEntry.reversalOf(original, {
            description: `Reversión: ${dto.reason}`,
            createdBy: dto.userId,
        });

        return await this.pettyCashRepo.addEntry(reversalEntry);
    }
}
