import { describe, expect, test, mock, beforeEach } from "bun:test";
import { RegisterPayment } from "@/modules/payments/application/use-cases/RegisterPayment";
import { AllocatePayment } from "@/modules/payments/application/use-cases/AllocatePayment";
import { createMockPaymentRepository, createMockInvoiceRepository, createMockAllocationRepository } from "../../mocks/repositories";
import { PaymentMethod, PaymentStatus } from "@/core/domain/enums";
import { Payment } from "@/modules/payments/domain/entities/Payment";
import { PaymentAllocation } from "@/modules/billing/domain/entities/PaymentAllocation"; // Note cross-module import logic in test
import { Invoice, InvoiceStatus, InvoiceType } from "@/modules/billing/domain/entities/Invoice";

describe("Payments Use Cases", () => {
    let mockPaymentRepo: ReturnType<typeof createMockPaymentRepository>;
    let mockInvoiceRepo: ReturnType<typeof createMockInvoiceRepository>;
    let mockAllocRepo: ReturnType<typeof createMockAllocationRepository>;

    beforeEach(() => {
        mockPaymentRepo = createMockPaymentRepository();
        mockInvoiceRepo = createMockInvoiceRepository();
        mockAllocRepo = createMockAllocationRepository();
    });

    describe("RegisterPayment", () => {
        test("should register a payment without allocation", async () => {
            const useCase = new RegisterPayment(mockPaymentRepo, mockAllocRepo);

            const result = await useCase.execute({
                userId: "user-1",
                unitId: "unit-1",
                amount: 100,
                method: PaymentMethod.TRANSFER,
                paymentDate: new Date(),
            });

            expect(mockPaymentRepo.create).toHaveBeenCalled();
            expect(result.amount).toBe(100);
            expect(mockAllocRepo.create).not.toHaveBeenCalled();
        });

        test("should register payment with allocations", async () => {
            const useCase = new RegisterPayment(mockPaymentRepo, mockAllocRepo);

            // Mock payment creation to return an ID
            mockPaymentRepo.create = mock(async (p) => {
                return new Payment({ ...p.toJSON(), id: "pay-1" });
            });

            await useCase.execute({
                userId: "user-1",
                unitId: "unit-1",
                amount: 100,
                method: PaymentMethod.TRANSFER,
                paymentDate: new Date(),
                allocations: [{ invoiceId: "inv-1", amount: 50 }]
            });

            expect(mockAllocRepo.create).toHaveBeenCalled();
        });

        test("should throw if allocation exceeds payment", async () => {
            const useCase = new RegisterPayment(mockPaymentRepo, mockAllocRepo);

            expect(useCase.execute({
                userId: "user-1",
                unitId: "unit-1",
                amount: 100,
                method: PaymentMethod.TRANSFER,
                paymentDate: new Date(),
                allocations: [{ invoiceId: "inv-1", amount: 150 }]
            })).rejects.toThrow("Allocated amount cannot exceed payment amount");
        });
    });

    describe("AllocatePayment", () => {
        test("should allocate existing payment", async () => {
            const useCase = new AllocatePayment(mockPaymentRepo, mockInvoiceRepo, mockAllocRepo);

            const payment = new Payment({
                id: "pay-1", user_id: "u1", unit_id: "un1", amount: 100,
                payment_date: new Date(), method: PaymentMethod.CASH, status: PaymentStatus.APPROVED
            });
            mockPaymentRepo.findById = mock(async () => payment);
            mockAllocRepo.findByPaymentId = mock(async () => []); // No prior allocations
            mockInvoiceRepo.findById = mock(async () => new Invoice({
                id: "inv-1",
                unit_id: "un1",
                amount: 100,
                paid_amount: 0,
                period: "2024-01",
                status: InvoiceStatus.PENDING,
                type: InvoiceType.DEBT,
                issue_date: new Date()
            }));

            await useCase.execute({
                paymentId: "pay-1",
                allocations: [{ invoiceId: "inv-1", amount: 60 }]
            });

            expect(mockAllocRepo.create).toHaveBeenCalled();
        });

        test("should fail if total allocation exceeds amount", async () => {
            const useCase = new AllocatePayment(mockPaymentRepo, mockInvoiceRepo, mockAllocRepo);

            const payment = new Payment({
                id: "pay-1", user_id: "u1", unit_id: "un1", amount: 100,
                payment_date: new Date(), method: PaymentMethod.CASH, status: PaymentStatus.APPROVED
            });
            mockPaymentRepo.findById = mock(async () => payment);

            // Assume 50 already allocated
            mockAllocRepo.findByPaymentId = mock(async () => [
                new PaymentAllocation({ id: "a1", payment_id: "pay-1", invoice_id: "inv-old", amount: 50 })
            ]);

            // Try to allocate 60 more (Total 110 > 100)
            expect(useCase.execute({
                paymentId: "pay-1",
                allocations: [{ invoiceId: "inv-1", amount: 60 }]
            })).rejects.toThrow("Total allocations exceed payment amount");
        });
    });
});
