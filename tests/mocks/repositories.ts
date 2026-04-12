import { describe, expect, test, mock } from "bun:test";
import { IUserRepository } from "@/modules/users/domain/repository";
import { IInvoiceRepository, IPaymentAllocationRepository } from "@/modules/billing/domain/repository";
import { IPaymentRepository } from "@/modules/payments/domain/repository";
import { User } from "@/modules/users/domain/entities/User";
import { Invoice } from "@/modules/billing/domain/entities/Invoice";
import { Payment } from "@/modules/payments/domain/entities/Payment";
import { PaymentAllocation } from "@/modules/billing/domain/entities/PaymentAllocation";

export const createMockUserRepository = (): IUserRepository => ({
    create: mock(async (user: User) => user),
    findById: mock(async (id: string) => null),
    findByEmail: mock(async (email: string) => null),
    update: mock(async (user: User) => user),
    findAll: mock(async () => []),
    delete: mock(async () => { })
});

export const createMockInvoiceRepository = (): IInvoiceRepository => ({
    create: mock(async (invoice: Invoice) => invoice),
    findById: mock(async (id: string) => null),
    findAll: mock(async () => []),
    findInvoicesForAdmin: mock(async () => []),
    findByBuildingId: mock(async () => []),
    update: mock(async (invoice: Invoice) => invoice),
    createBatch: mock(async (invoices: Invoice[]) => invoices)
});

export const createMockPaymentRepository = (): IPaymentRepository => ({
    create: mock(async (payment: Payment) => payment),
    findById: mock(async (id: string) => null),
    findAll: mock(async () => []),
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
    findInvoicesByPaymentId: mock(async (id: string) => [])
});
