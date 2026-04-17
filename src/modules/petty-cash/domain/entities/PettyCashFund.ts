/**
 * A petty-cash fund's metadata row. One per building.
 *
 * The fund itself carries almost nothing at this point — balance lives
 * in the `petty_cash_balance` view (derived from `petty_cash_entries`)
 * and currency was removed in Phase 3 because it was never consumed
 * anywhere in the system.
 *
 * Kept as an entity (instead of a plain row) so the use cases have a
 * stable id reference when registering entries and assessments, and so
 * fund lifecycle can grow back metadata (name, timezone, …) without
 * reshaping the persistence layer.
 */
export class PettyCashFund {
    constructor(
        public readonly id: string,
        public readonly building_id: string,
        public readonly updated_at: Date
    ) { }

    public toJSON() {
        return {
            id: this.id,
            building_id: this.building_id,
            updated_at: this.updated_at,
        };
    }
}
