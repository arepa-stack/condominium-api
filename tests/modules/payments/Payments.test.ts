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
        const validTransferDto = () => ({
            userId: "user-1",
            unitId: "unit-1",
            amount: 100,
            method: PaymentMethod.TRANSFER,
            paymentDate: new Date(),
            reference: "REF-123",
            bank: "Banesco",
            proofUrl: "https://storage/proof.jpg"
        });

        test("should register a payment without allocation", async () => {
            const useCase = new RegisterPayment(mockPaymentRepo, mockAllocRepo);

            const result = await useCase.execute(validTransferDto());

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
                ...validTransferDto(),
                allocations: [{ invoiceId: "inv-1", amount: 50 }]
            });

            expect(mockAllocRepo.create).toHaveBeenCalled();
        });

        test("should throw if allocation exceeds payment", async () => {
            const useCase = new RegisterPayment(mockPaymentRepo, mockAllocRepo);

            expect(useCase.execute({
                ...validTransferDto(),
                allocations: [{ invoiceId: "inv-1", amount: 150 }]
            })).rejects.toThrow("Allocated amount cannot exceed payment amount");
        });

        test("should throw FUTURE_DATE if paymentDate is after now", async () => {
            const useCase = new RegisterPayment(mockPaymentRepo, mockAllocRepo);
            const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

            expect(useCase.execute({
                ...validTransferDto(),
                paymentDate: tomorrow
            })).rejects.toThrow("Payment date cannot be in the future");
        });

        test("should succeed if proofUrl is absent", async () => {
            const useCase = new RegisterPayment(mockPaymentRepo, mockAllocRepo);

            const result = await useCase.execute({
                ...validTransferDto(),
                proofUrl: undefined
            });

            expect(result.amount).toBe(100);
            expect(mockPaymentRepo.create).toHaveBeenCalled();
        });

        test("should throw MISSING_BANK_INFO for TRANSFER without reference", async () => {
            const useCase = new RegisterPayment(mockPaymentRepo, mockAllocRepo);

            expect(useCase.execute({
                ...validTransferDto(),
                reference: undefined
            })).rejects.toThrow("Reference is required");
        });

        test("should throw MISSING_BANK_INFO for PAGO_MOVIL without bank", async () => {
            const useCase = new RegisterPayment(mockPaymentRepo, mockAllocRepo);

            expect(useCase.execute({
                ...validTransferDto(),
                method: PaymentMethod.PAGO_MOVIL,
                bank: undefined
            })).rejects.toThrow("Bank is required");
        });

        test("should register CASH payment without reference/bank (optional proof)", async () => {
            const useCase = new RegisterPayment(mockPaymentRepo, mockAllocRepo);

            const result = await useCase.execute({
                userId: "user-1",
                unitId: "unit-1",
                amount: 50,
                method: PaymentMethod.CASH,
                paymentDate: new Date(),
                proofUrl: "https://storage/cash-receipt.jpg"
            });

            expect(result.amount).toBe(50);
            expect(mockPaymentRepo.create).toHaveBeenCalled();
        });

        test("should succeed for CASH without proof", async () => {
            const useCase = new RegisterPayment(mockPaymentRepo, mockAllocRepo);

            const result = await useCase.execute({
                userId: "user-1",
                unitId: "unit-1",
                amount: 50,
                method: PaymentMethod.CASH,
                paymentDate: new Date()
            });

            expect(result.amount).toBe(50);
            expect(mockPaymentRepo.create).toHaveBeenCalled();
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
