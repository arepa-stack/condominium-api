import { describe, expect, test, mock } from "bun:test";
import { IUserRepository } from "@/modules/users/domain/repository";
import { IInvoiceRepository, IPaymentAllocationRepository, ICreditLedgerRepository } from "@/modules/billing/domain/repository";
import { IPaymentRepository } from "@/modules/payments/domain/repository";
import { User } from "@/modules/users/domain/entities/User";
import { Invoice } from "@/modules/billing/domain/entities/Invoice";
import { Payment } from "@/modules/payments/domain/entities/Payment";
import { PaymentAllocation } from "@/modules/billing/domain/entities/PaymentAllocation";
import { CreditLedgerEntry } from "@/modules/billing/domain/entities/CreditLedgerEntry";

export const createMockUserRepository = (): IUserRepository => ({
    create: mock(async (user: User) => user),
    findById: mock(async (id: string) => null),
    findByEmail: mock(async (email: string) => null),
    update: mock(async (user: User) => user),
    findAll: mock(async () => []),
    findAllPaginated: mock(async () => ({ items: [], total: 0 })),
    findUnitsByProfilePaginated: mock(async () => ({ items: [], total: 0 })),
    removeUnit: mock(async () => { }),
    delete: mock(async () => { })
});

export const createMockInvoiceRepository = (): IInvoiceRepository => ({
    create: mock(async (invoice: Invoice) => invoice),
    findById: mock(async (id: string) => null),
    findAll: mock(async () => []),
    findAllPaginated: mock(async () => ({ items: [], total: 0 })),
    findInvoicesForAdmin: mock(async () => ({ items: [], total: 0 })),
    findByBuildingId: mock(async () => ({ items: [], total: 0 })),
    update: mock(async (invoice: Invoice) => invoice),
    createBatch: mock(async (invoices: Invoice[]) => invoices)
});

export const createMockPaymentRepository = (): IPaymentRepository => ({
    create: mock(async (payment: Payment) => payment),
    findById: mock(async (id: string) => null),
    findAll: mock(async () => []),
    findAllPaginated: mock(async () => ({ items: [], total: 0 })),
    update: mock(async (payment: Payment) => payment),
    findByUserId: mock(async () => []),
    findByUnit: mock(async () => []),
    delete: mock(async () => { })
});

export const createMockAllocationRepository = (): IPaymentAllocationRepository => ({
    create: mock(async (alloc: PaymentAllocation) => alloc),
    delete: mock(async (id: string) => { }),
    findByPaymentId: mock(async (id: string) => []),
    findByInvoiceId: mock(async (id: string) => []),
    findPaymentsByInvoiceId: mock(async (id: string) => []),
    findInvoicesByPaymentId: mock(async (id: string) => []),
    findPaymentsByInvoiceIdPaginated: mock(async () => ({ items: [], total: 0 })),
    findInvoicesByPaymentIdPaginated: mock(async () => ({ items: [], total: 0 }))
});

export const createMockCreditLedgerRepository = (): ICreditLedgerRepository => ({
    addCredit: mock(async (entry: CreditLedgerEntry) => entry),
    deductCredit: mock(async (entry: CreditLedgerEntry) => entry),
    getBalanceForUnit: mock(async () => 0),
    getEntriesForUnit: mock(async () => []),
    findByReferenceId: mock(async () => [])
});
