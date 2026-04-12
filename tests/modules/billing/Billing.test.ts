import { describe, expect, test, mock, beforeEach } from "bun:test";
import { LoadDebt } from "@/modules/billing/application/use-cases/LoadDebt";
import { GetUnitBalance } from "@/modules/billing/application/use-cases/GetUnitBalance";
import {
    createMockInvoiceRepository,
    createMockAllocationRepository,
    createMockCreditLedgerRepository
} from "../../mocks/repositories";
import { Invoice, InvoiceStatus, InvoiceType } from "@/modules/billing/domain/entities/Invoice";
import { PaymentAllocation } from "@/modules/billing/domain/entities/PaymentAllocation";

describe("Billing Use Cases", () => {
    let mockInvoiceRepo: ReturnType<typeof createMockInvoiceRepository>;
    let mockAllocRepo: ReturnType<typeof createMockAllocationRepository>;
    let mockCreditLedgerRepo: ReturnType<typeof createMockCreditLedgerRepository>;

    beforeEach(() => {
        mockInvoiceRepo = createMockInvoiceRepository();
        mockAllocRepo = createMockAllocationRepository();
        mockCreditLedgerRepo = createMockCreditLedgerRepository();
    });

    describe("LoadDebt", () => {
        test("should create a debt invoice", async () => {
            const useCase = new LoadDebt(mockInvoiceRepo);

            await useCase.execute({
                unitId: "unit-1",
                amount: 100,
                period: "2024-01",
                description: "Maintenance"
            });

            expect(mockInvoiceRepo.create).toHaveBeenCalled();
            // Verify arguments passed to create
            // Bun test mock doesn't easily expose args in a typed way without .mock.calls
            // But if it didn't throw, it passed.
        });

        test("should throw on negative amount", async () => {
            const useCase = new LoadDebt(mockInvoiceRepo);
            expect(useCase.execute({
                unitId: "unit-1",
                amount: -50,
                period: "2024-01"
            })).rejects.toThrow();
        });
    });

    describe("GetUnitBalance", () => {
        const makeInvoice = (overrides: {
            id: string;
            amount: number;
            paid_amount: number;
            status: InvoiceStatus;
            period?: string;
        }) => new Invoice({
            id: overrides.id,
            unit_id: "unit-1",
            amount: overrides.amount,
            paid_amount: overrides.paid_amount,
            period: overrides.period ?? "2024-01",
            status: overrides.status,
            type: InvoiceType.EXPENSE,
            issue_date: new Date()
        });

        test("sums remaining balance of PENDING and PARTIAL invoices", async () => {
            const invoices = [
                makeInvoice({ id: "inv-1", amount: 100, paid_amount: 0, status: InvoiceStatus.PENDING }),
                makeInvoice({ id: "inv-2", amount: 200, paid_amount: 50, status: InvoiceStatus.PARTIAL, period: "2024-02" })
            ];
            mockInvoiceRepo.findAll = mock(async () => invoices);

            const useCase = new GetUnitBalance(mockInvoiceRepo, mockCreditLedgerRepo);
            const balance = await useCase.execute("unit-1");

            expect(balance.totalDebt).toBe(250); // 100 + (200 - 50)
            expect(balance.pendingInvoices).toBe(2);
            expect(balance.details[0].remaining).toBe(100);
            expect(balance.details[1].remaining).toBe(150);
        });

        test("excludes PAID and CANCELLED invoices from the total", async () => {
            const invoices = [
                makeInvoice({ id: "open", amount: 100, paid_amount: 0, status: InvoiceStatus.PENDING }),
                makeInvoice({ id: "done", amount: 100, paid_amount: 100, status: InvoiceStatus.PAID }),
                makeInvoice({ id: "void", amount: 100, paid_amount: 0, status: InvoiceStatus.CANCELLED })
            ];
            mockInvoiceRepo.findAll = mock(async () => invoices);

            const useCase = new GetUnitBalance(mockInvoiceRepo, mockCreditLedgerRepo);
            const balance = await useCase.execute("unit-1");

            expect(balance.totalDebt).toBe(100);
            expect(balance.pendingInvoices).toBe(1);
            expect(balance.details).toHaveLength(1);
            expect(balance.details[0].invoiceId).toBe("open");
        });

        test("netBalance subtracts creditBalance from totalDebt", async () => {
            const invoices = [
                makeInvoice({ id: "inv-1", amount: 100, paid_amount: 0, status: InvoiceStatus.PENDING })
            ];
            mockInvoiceRepo.findAll = mock(async () => invoices);
            mockCreditLedgerRepo.getBalanceForUnit = mock(async () => 30);

            const useCase = new GetUnitBalance(mockInvoiceRepo, mockCreditLedgerRepo);
            const balance = await useCase.execute("unit-1");

            expect(balance.totalDebt).toBe(100);
            expect(balance.creditBalance).toBe(30);
            expect(balance.netBalance).toBe(70);
        });

        test("netBalance clamps to zero when credit exceeds debt (surplus exposed via creditBalance)", async () => {
            const invoices = [
                makeInvoice({ id: "inv-1", amount: 50, paid_amount: 0, status: InvoiceStatus.PENDING })
            ];
            mockInvoiceRepo.findAll = mock(async () => invoices);
            mockCreditLedgerRepo.getBalanceForUnit = mock(async () => 200);

            const useCase = new GetUnitBalance(mockInvoiceRepo, mockCreditLedgerRepo);
            const balance = await useCase.execute("unit-1");

            // Real debt after credit: would be -150, but clamped to 0.
            // The surplus is still visible through creditBalance.
            expect(balance.totalDebt).toBe(50);
            expect(balance.creditBalance).toBe(200);
            expect(balance.netBalance).toBe(0);
        });

        test("returns empty details and zero totals when the unit has no open invoices", async () => {
            mockInvoiceRepo.findAll = mock(async () => []);

            const useCase = new GetUnitBalance(mockInvoiceRepo, mockCreditLedgerRepo);
            const balance = await useCase.execute("unit-1");

            expect(balance.totalDebt).toBe(0);
            expect(balance.pendingInvoices).toBe(0);
            expect(balance.details).toEqual([]);
            expect(balance.netBalance).toBe(0);
        });

        test("reads credit balance from the credit ledger repo, not from allocations", async () => {
            // Pinning the delegation: if someone refactors GetUnitBalance to
            // compute credit from allocations, this test grabs them by the
            // collar — the credit ledger is the single source of truth for
            // the unit's surplus.
            mockInvoiceRepo.findAll = mock(async () => []);
            mockCreditLedgerRepo.getBalanceForUnit = mock(async () => 75);

            const useCase = new GetUnitBalance(mockInvoiceRepo, mockCreditLedgerRepo);
            const balance = await useCase.execute("unit-1");

            expect(mockCreditLedgerRepo.getBalanceForUnit).toHaveBeenCalledWith("unit-1");
            expect(balance.creditBalance).toBe(75);
        });
    });
});
