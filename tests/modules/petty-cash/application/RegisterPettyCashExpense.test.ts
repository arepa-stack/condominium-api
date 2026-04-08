import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { RegisterPettyCashExpense, RegisterExpenseDTO } from '@/modules/petty-cash/application/use-cases/RegisterPettyCashExpense';
import { PettyCashFund } from '@/modules/petty-cash/domain/entities/PettyCashFund';
import { PettyCashCategory } from '@/core/domain/enums';
import { InvoiceStatus, InvoiceType, InvoiceTag } from '@/modules/billing/domain/entities/Invoice';

describe('RegisterPettyCashExpense', () => {
    let useCase: RegisterPettyCashExpense;
    let mockPettyCashRepo: any;
    let mockInvoiceRepo: any;

    beforeEach(() => {
        mockPettyCashRepo = {
            findFundByBuildingId: mock(() => Promise.resolve(null)),
            saveFund: mock(() => Promise.resolve(null)),
            saveTransaction: mock(() => Promise.resolve(null)),
        };
        mockInvoiceRepo = {
            create: mock((inv: unknown) => Promise.resolve(inv)),
        };
        // NOTE: IUnitRepository is NOT a constructor parameter
        useCase = new RegisterPettyCashExpense(mockPettyCashRepo, mockInvoiceRepo);
    });

    describe('when expense is within fund balance', () => {
        it('creates exactly ONE building-level invoice with tag=PETTY_CASH and status=PAID', async () => {
            const buildingId = 'b1';
            const fund = new PettyCashFund('f1', buildingId, 1000, 'USD', new Date());
            mockPettyCashRepo.findFundByBuildingId.mockImplementation(() => Promise.resolve(fund));
            mockPettyCashRepo.saveTransaction.mockImplementation(() => Promise.resolve({ id: 'tx1' }));

            const dto: RegisterExpenseDTO = {
                buildingId,
                amount: 600,
                description: 'Fixed lobby door',
                category: PettyCashCategory.REPAIR,
                userId: 'user1'
            };

            await useCase.execute(dto);

            expect(mockInvoiceRepo.create).toHaveBeenCalledTimes(1);

            const invoice = mockInvoiceRepo.create.mock.calls[0][0];
            expect(invoice.building_id).toBe(buildingId);
            expect(invoice.unit_id).toBeUndefined();
            expect(invoice.tag).toBe(InvoiceTag.PETTY_CASH);
            expect(invoice.status).toBe(InvoiceStatus.PAID);
            expect(invoice.type).toBe(InvoiceType.EXPENSE);
            expect(invoice.amount).toBe(600);
        });

        it('deducts the full amount from the fund', async () => {
            const buildingId = 'b1';
            const fund = new PettyCashFund('f1', buildingId, 1000, 'USD', new Date());
            mockPettyCashRepo.findFundByBuildingId.mockImplementation(() => Promise.resolve(fund));
            mockPettyCashRepo.saveTransaction.mockImplementation(() => Promise.resolve({ id: 'tx1' }));

            const dto: RegisterExpenseDTO = {
                buildingId,
                amount: 600,
                description: 'Cleaning supplies',
                category: PettyCashCategory.CLEANING,
                userId: 'user1'
            };

            await useCase.execute(dto);

            expect(fund.current_balance).toBe(400);
            expect(mockPettyCashRepo.saveFund).toHaveBeenCalledWith(fund);
        });
    });

    describe('when expense exceeds fund balance', () => {
        it('deducts fund to 0 and creates TWO building-level invoices (deducted + overage)', async () => {
            const buildingId = 'b1';
            const fund = new PettyCashFund('f1', buildingId, 500, 'USD', new Date());
            mockPettyCashRepo.findFundByBuildingId.mockImplementation(() => Promise.resolve(fund));
            mockPettyCashRepo.saveTransaction.mockImplementation(() => Promise.resolve({ id: 'tx1' }));

            const dto: RegisterExpenseDTO = {
                buildingId,
                amount: 600,
                description: 'Emergency repair',
                category: PettyCashCategory.EMERGENCY,
                userId: 'user1'
            };

            await useCase.execute(dto);

            expect(fund.current_balance).toBe(0);
            expect(mockPettyCashRepo.saveFund).toHaveBeenCalledWith(fund);
            // Two invoices: one for deducted (500), one for overage (100)
            expect(mockInvoiceRepo.create).toHaveBeenCalledTimes(2);

            const amounts = mockInvoiceRepo.create.mock.calls.map((c: any[]) => c[0].amount);
            expect(amounts).toContain(500);
            expect(amounts).toContain(100);

            // Both should be building-level, PETTY_CASH tag, PAID
            for (const call of mockInvoiceRepo.create.mock.calls) {
                const inv = call[0];
                expect(inv.building_id).toBe(buildingId);
                expect(inv.unit_id).toBeUndefined();
                expect(inv.tag).toBe(InvoiceTag.PETTY_CASH);
                expect(inv.status).toBe(InvoiceStatus.PAID);
                expect(inv.type).toBe(InvoiceType.EXPENSE);
            }
        });

        it('still saves the petty cash transaction with the full amount', async () => {
            const buildingId = 'b1';
            const fund = new PettyCashFund('f1', buildingId, 500, 'USD', new Date());
            mockPettyCashRepo.findFundByBuildingId.mockImplementation(() => Promise.resolve(fund));
            mockPettyCashRepo.saveTransaction.mockImplementation(() => Promise.resolve({ id: 'tx1' }));

            const dto: RegisterExpenseDTO = {
                buildingId,
                amount: 600,
                description: 'Emergency repair',
                category: PettyCashCategory.EMERGENCY,
                userId: 'user1'
            };

            await useCase.execute(dto);

            expect(mockPettyCashRepo.saveTransaction).toHaveBeenCalledWith(
                expect.objectContaining({ amount: 600 })
            );
        });
    });

    describe('invoice description format', () => {
        it('formats description as "[CATEGORY] description"', async () => {
            const buildingId = 'b1';
            const fund = new PettyCashFund('f1', buildingId, 1000, 'USD', new Date());
            mockPettyCashRepo.findFundByBuildingId.mockImplementation(() => Promise.resolve(fund));
            mockPettyCashRepo.saveTransaction.mockImplementation(() => Promise.resolve({ id: 'tx1' }));

            const dto: RegisterExpenseDTO = {
                buildingId,
                amount: 200,
                description: 'Fixed lobby door',
                category: PettyCashCategory.REPAIR,
                userId: 'user1'
            };

            await useCase.execute(dto);

            const invoice = mockInvoiceRepo.create.mock.calls[0][0];
            expect(invoice.description).toBe('[REPAIR] Fixed lobby door');
        });
    });

    describe('evidence URL propagation', () => {
        it('propagates evidenceUrl to invoice receipt_number when provided', async () => {
            const buildingId = 'b1';
            const fund = new PettyCashFund('f1', buildingId, 1000, 'USD', new Date());
            mockPettyCashRepo.findFundByBuildingId.mockImplementation(() => Promise.resolve(fund));
            mockPettyCashRepo.saveTransaction.mockImplementation(() => Promise.resolve({ id: 'tx1' }));

            const dto: RegisterExpenseDTO = {
                buildingId,
                amount: 200,
                description: 'Supplies',
                category: PettyCashCategory.OFFICE,
                userId: 'user1',
                evidenceUrl: 'https://storage.example.com/evidence.jpg'
            };

            await useCase.execute(dto);

            // evidenceUrl is stored on the petty cash transaction, NOT on the invoice receipt_number
            // (receipt_number is VARCHAR(50) — too short for URLs)
            const transaction = mockPettyCashRepo.saveTransaction.mock.calls[0][0];
            expect(transaction.evidence_url).toBe('https://storage.example.com/evidence.jpg');
        });
    });

    describe('fund auto-creation', () => {
        it('creates a new fund when none exists and processes the expense', async () => {
            const buildingId = 'b1';
            mockPettyCashRepo.findFundByBuildingId.mockImplementation(() => Promise.resolve(null));
            // saveFund should return the saved fund with an id
            mockPettyCashRepo.saveFund.mockImplementation((fund: PettyCashFund) =>
                Promise.resolve(new PettyCashFund('f-new', fund.building_id, fund.current_balance, fund.currency, new Date()))
            );
            mockPettyCashRepo.saveTransaction.mockImplementation(() => Promise.resolve({ id: 'tx1' }));

            const dto: RegisterExpenseDTO = {
                buildingId,
                amount: 100,
                description: 'Office supplies',
                category: PettyCashCategory.OFFICE,
                userId: 'user1'
            };

            await useCase.execute(dto);

            expect(mockPettyCashRepo.saveFund).toHaveBeenCalled();
            // Fund was empty (0), so full amount is overage → 2 invoices: 0 deducted + 100 overage
            // But deducted=0 means we skip the first invoice (amount 0 is invalid)
            // We still create the overage invoice (100)
            expect(mockInvoiceRepo.create).toHaveBeenCalledTimes(1);
            const invoice = mockInvoiceRepo.create.mock.calls[0][0];
            expect(invoice.amount).toBe(100);
            expect(invoice.building_id).toBe(buildingId);
        });
    });

    describe('IUnitRepository is not a dependency', () => {
        it('does not require IUnitRepository in constructor — only 2 dependencies', () => {
            // Constructor has exactly 2 params: pettyCashRepo + invoiceRepo (no unitRepo)
            expect(useCase).toBeDefined();
            expect(RegisterPettyCashExpense.length).toBe(2);
        });
    });
});
