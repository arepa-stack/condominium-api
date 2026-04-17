export enum UserRole {
    ADMIN = 'admin',
    BOARD = 'board',
    RESIDENT = 'resident'
}

/**
 * Global system capability stored in profiles.app_role.
 * 'admin' = staff with access to every building.
 * 'user'  = regular user whose access is scoped via building_members / profile_units.
 * See docs section 2 for the full role model.
 */
export type AppRole = 'admin' | 'user';

export enum UserStatus {
    ACTIVE = 'active',
    PENDING = 'pending',
    INACTIVE = 'inactive',
    REJECTED = 'rejected'
}

export enum PaymentStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED'
}

export enum PaymentMethod {
    PAGO_MOVIL = 'PAGO_MOVIL',
    TRANSFER = 'TRANSFER',
    CASH = 'CASH'
}

export enum SolvencyStatus {
    SOLVENT = 'SOLVENT',
    PENDING = 'PENDING',
    OVERDUE = 'OVERDUE'
}

/**
 * Type of a petty-cash ledger entry (petty_cash_entries.type).
 * Mirrors the SQL CHECK constraint on that column.
 *
 *   income     — manual replenishment by the board.
 *   expense    — building-level spend. Amount stored negative.
 *   collection — auto-entry when a resident pays a PETTY_CASH invoice.
 *   reversal   — counter-entry for any of the above.
 */
export enum PettyCashEntryType {
    INCOME = 'income',
    EXPENSE = 'expense',
    COLLECTION = 'collection',
    REVERSAL = 'reversal'
}

export enum PettyCashEntryReferenceType {
    MANUAL = 'manual',
    INVOICE_PAYMENT = 'invoice_payment',
    REVERSAL = 'reversal'
}

export enum PettyCashCategory {
    REPAIR = 'REPAIR',
    CLEANING = 'CLEANING',
    EMERGENCY = 'EMERGENCY',
    OFFICE = 'OFFICE',
    UTILITIES = 'UTILITIES',
    OTHER = 'OTHER'
}

export enum InvoiceTag {
    NORMAL = 'NORMAL',
    PETTY_CASH = 'PETTY_CASH'
}
