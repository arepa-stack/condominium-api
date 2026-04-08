export enum UserRole {
    ADMIN = 'admin',
    BOARD = 'board',
    RESIDENT = 'resident'
}

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

export enum PettyCashTransactionType {
    INCOME = 'INCOME',
    EXPENSE = 'EXPENSE'
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
