import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ApprovePayment } from '@/modules/payments/application/use-cases/ApprovePayment';
import { MockPaymentRepository } from '../mocks';
import { MockUserRepository } from '../../users/mocks';
import { Payment } from '@/modules/payments/domain/entities/Payment';
import { BuildingRole } from '@/modules/users/domain/entities/BuildingRole';
import { User } from '@/modules/users/domain/entities/User';
import { PaymentMethod, PaymentStatus, UserRole, UserStatus } from '@/core/domain/enums';
import { IPaymentAllocationRepository, IInvoiceRepository, ICreditLedgerRepository } from '@/modules/billing/domain/repository';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { PaymentAllocation } from '@/modules/billing/domain/entities/PaymentAllocation';
import { CreditLedgerEntry, CreditLedgerReferenceType } from '@/modules/billing/domain/entities/CreditLedgerEntry';
import { ProcessInvoiceOverpayment } from '@/modules/billing/application/use-cases/ProcessInvoiceOverpayment';

describe('ApprovePayment Use Case', () => {
    let paymentRepo: MockPaymentRepository;
    let userRepo: MockUserRepository;
    let allocationRepo: IPaymentAllocationRepository;
    let invoiceRepo: IInvoiceRepository;
    let creditLedgerRepo: ICreditLedgerRepository;
    let approvePayment: ApprovePayment;

    beforeEach(() => {
        paymentRepo = new MockPaymentRepository();
        userRepo = new MockUserRepository();
        allocationRepo = {
            findByPaymentId: mock(async () => []),
            create: mock(),
            delete: mock(),
            findByInvoiceId: mock(),
            findPaymentsByInvoiceId: mock(),
            findInvoicesByPaymentId: mock()
        };
        invoiceRepo = {
            findById: mock(async () => null),
            create: mock(),
            findAll: mock(),
            findInvoicesForAdmin: mock(),
            findByBuildingId: mock(async () => []),
            update: mock(),
            createBatch: mock()
        };
        creditLedgerRepo = {
            addCredit: mock(async (entry: CreditLedgerEntry) => entry),
            getBalanceForUnit: mock(async () => 0),
            getEntriesForUnit: mock(async () => []),
            findByReferenceId: mock(async () => [])
        };
        const processOverpayment = new ProcessInvoiceOverpayment(invoiceRepo, creditLedgerRepo);
        approvePayment = new ApprovePayment(
            paymentRepo,
            userRepo,
            allocationRepo,
            processOverpayment
        );
    });

    it('should approve payment when requested by admin', async () => {
        const admin = new User({
            id: 'admin-1',
            email: 'admin@test.com',
            name: 'Admin',
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE
        });
        // Admin doesn't necessarily need units, but for consistency:
        admin.setUnits([{ unit_id: 'A1', building_id: 'building-1', building_role: 'owner', is_primary: true } as any]);

        const payment = new Payment({
            id: 'payment-1',
            user_id: 'user-1',
            building_id: 'building-1',
            amount: 100,
            payment_date: new Date(),
            method: PaymentMethod.PAGO_MOVIL,
            status: PaymentStatus.PENDING,
            unit_id: 'A1'
        });

        await userRepo.create(admin);
        await paymentRepo.create(payment);

        await approvePayment.approve({
            paymentId: 'payment-1',
            approverId: 'admin-1',
            notes: 'Approved'
        });

        const updated = await paymentRepo.findById('payment-1');
        expect(updated?.status).toBe(PaymentStatus.APPROVED);
        expect(updated?.notes).toBe('Approved');
    });

    it('should approve payment when requested by board member of same building', async () => {
        const board = new User({
            id: 'board-1',
            email: 'board@test.com',
            name: 'Board Member',
            role: UserRole.BOARD,
            status: UserStatus.ACTIVE
        });
        board.setBuildingRoles([new BuildingRole({ building_id: 'building-1', role: UserRole.BOARD as any })]);

        const payment = new Payment({
            id: 'payment-1',
            user_id: 'user-1',
            building_id: 'building-1',
            amount: 100,
            payment_date: new Date(),
            method: PaymentMethod.TRANSFER,
            status: PaymentStatus.PENDING,
            unit_id: 'B1'
        });

        await userRepo.create(board);
        await paymentRepo.create(payment);

        await approvePayment.approve({
            paymentId: 'payment-1',
            approverId: 'board-1'
        });

        const updated = await paymentRepo.findById('payment-1');
        expect(updated?.status).toBe(PaymentStatus.APPROVED);
    });

    it('should fail when board member is from different building', async () => {
        const board = new User({
            id: 'board-1',
            email: 'board@test.com',
            name: 'Board Member',
            role: UserRole.BOARD,
            status: UserStatus.ACTIVE
        });
        board.setBuildingRoles([new BuildingRole({ building_id: 'building-2', role: UserRole.BOARD as any })]);

        const payment = new Payment({
            id: 'payment-1',
            user_id: 'user-1',
            building_id: 'building-1',
            amount: 100,
            payment_date: new Date(),
            method: PaymentMethod.CASH,
            status: PaymentStatus.PENDING,
            unit_id: 'B1'
        });

        await userRepo.create(board);
        await paymentRepo.create(payment);

        expect(async () => {
            await approvePayment.approve({
                paymentId: 'payment-1',
                approverId: 'board-1'
            });
        }).toThrow();
    });

    it('should fail when approver is resident', async () => {
        const resident = new User({
            id: 'resident-1',
            email: 'resident@test.com',
            name: 'Resident',
            role: UserRole.RESIDENT,
            status: UserStatus.ACTIVE
        });
        resident.setUnits([{ unit_id: 'C1', building_id: 'building-1', building_role: 'resident', is_primary: true } as any]);

        const payment = new Payment({
            id: 'payment-1',
            user_id: 'user-1',
            building_id: 'building-1',
            amount: 100,
            payment_date: new Date(),
            method: PaymentMethod.PAGO_MOVIL,
            status: PaymentStatus.PENDING,
            unit_id: 'C1'
        });

        await userRepo.create(resident);
        await paymentRepo.create(payment);

        expect(async () => {
            await approvePayment.approve({
                paymentId: 'payment-1',
                approverId: 'resident-1'
            });
        }).toThrow();
    });

    it('should reject payment', async () => {
        const admin = new User({
            id: 'admin-1',
            email: 'admin@test.com',
            name: 'Admin',
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE
        });
        admin.setUnits([{ unit_id: 'A1', building_id: 'building-1', building_role: 'owner', is_primary: true } as any]);

        const payment = new Payment({
            id: 'payment-1',
            user_id: 'user-1',
            building_id: 'building-1',
            amount: 100,
            payment_date: new Date(),
            method: PaymentMethod.TRANSFER,
            status: PaymentStatus.PENDING,
            unit_id: 'A1'
        });

        await userRepo.create(admin);
        await paymentRepo.create(payment);

        await approvePayment.reject({
            paymentId: 'payment-1',
            approverId: 'admin-1',
            notes: 'Invalid proof'
        });

        const updated = await paymentRepo.findById('payment-1');
        expect(updated?.status).toBe(PaymentStatus.REJECTED);
        expect(updated?.notes).toBe('Invalid proof');
    });

    describe('Overpayment → credit ledger', () => {
        let admin: User;
        let payment: Payment;

        beforeEach(async () => {
            admin = new User({
                id: 'admin-1',
                email: 'admin@test.com',
                name: 'Admin',
                role: UserRole.ADMIN,
                status: UserStatus.ACTIVE
            });
            payment = new Payment({
                id: 'payment-1',
                user_id: 'user-1',
                building_id: 'building-1',
                amount: 150,
                payment_date: new Date(),
                method: PaymentMethod.TRANSFER,
                status: PaymentStatus.PENDING,
                unit_id: 'unit-1'
            });
            await userRepo.create(admin);
            await paymentRepo.create(payment);
        });

        it('should create a credit entry for overpayment (150 on invoice of 100)', async () => {
            // Allocation of 150 on an invoice worth 100. The domain now owns
            // paid_amount recalculation (triggers were dropped), so the
            // invoice starts in PRE-application state: paid_amount=0, PENDING.
            const allocation = new PaymentAllocation({
                id: 'alloc-1',
                payment_id: 'payment-1',
                invoice_id: 'invoice-1',
                amount: 150
            });

            const invoicePre = new Invoice({
                id: 'invoice-1',
                unit_id: 'unit-1',
                building_id: 'building-1',
                amount: 100,
                paid_amount: 0,
                period: '2026-01',
                issue_date: new Date(),
                status: InvoiceStatus.PENDING,
                type: InvoiceType.DEBT
            });

            (allocationRepo.findByPaymentId as ReturnType<typeof mock>).mockImplementation(async () => [allocation]);
            (invoiceRepo.findById as ReturnType<typeof mock>).mockImplementation(async () => invoicePre);

            await approvePayment.approve({ paymentId: 'payment-1', approverId: 'admin-1' });

            expect(creditLedgerRepo.addCredit).toHaveBeenCalledTimes(1);
            const savedEntry: CreditLedgerEntry = (creditLedgerRepo.addCredit as ReturnType<typeof mock>).mock.calls[0][0];
            expect(savedEntry.unit_id).toBe('unit-1');
            expect(savedEntry.amount).toBe(50); // 150 - 100
            expect(savedEntry.reference_type).toBe(CreditLedgerReferenceType.PAYMENT);
            expect(savedEntry.reference_id).toBe('payment-1');
            expect(savedEntry.reason).toContain('invoice-1');

            // The invoice mutated in place: 100 applied, status now PAID.
            expect(invoicePre.paid_amount).toBe(100);
            expect(invoicePre.status).toBe(InvoiceStatus.PAID);
        });

        it('should NOT create a credit entry for exact payment (100 on 100)', async () => {
            const allocation = new PaymentAllocation({
                id: 'alloc-1',
                payment_id: 'payment-1',
                invoice_id: 'invoice-1',
                amount: 100
            });

            const invoicePre = new Invoice({
                id: 'invoice-1',
                unit_id: 'unit-1',
                building_id: 'building-1',
                amount: 100,
                paid_amount: 0,
                period: '2026-01',
                issue_date: new Date(),
                status: InvoiceStatus.PENDING,
                type: InvoiceType.DEBT
            });

            (allocationRepo.findByPaymentId as ReturnType<typeof mock>).mockImplementation(async () => [allocation]);
            (invoiceRepo.findById as ReturnType<typeof mock>).mockImplementation(async () => invoicePre);

            await approvePayment.approve({ paymentId: 'payment-1', approverId: 'admin-1' });

            expect(creditLedgerRepo.addCredit).not.toHaveBeenCalled();
            expect(invoicePre.paid_amount).toBe(100);
            expect(invoicePre.status).toBe(InvoiceStatus.PAID);
        });

        it('should NOT create a credit entry for partial payment (50 on 100)', async () => {
            const allocation = new PaymentAllocation({
                id: 'alloc-1',
                payment_id: 'payment-1',
                invoice_id: 'invoice-1',
                amount: 50
            });

            const invoicePre = new Invoice({
                id: 'invoice-1',
                unit_id: 'unit-1',
                building_id: 'building-1',
                amount: 100,
                paid_amount: 0,
                period: '2026-01',
                issue_date: new Date(),
                status: InvoiceStatus.PENDING,
                type: InvoiceType.DEBT
            });

            (allocationRepo.findByPaymentId as ReturnType<typeof mock>).mockImplementation(async () => [allocation]);
            (invoiceRepo.findById as ReturnType<typeof mock>).mockImplementation(async () => invoicePre);

            await approvePayment.approve({ paymentId: 'payment-1', approverId: 'admin-1' });

            expect(creditLedgerRepo.addCredit).not.toHaveBeenCalled();
            expect(invoicePre.paid_amount).toBe(50);
            expect(invoicePre.status).toBe(InvoiceStatus.PARTIAL);
        });

        it('should NOT create a credit entry for building-level invoice (no unit_id)', async () => {
            const allocation = new PaymentAllocation({
                id: 'alloc-1',
                payment_id: 'payment-1',
                invoice_id: 'invoice-1',
                amount: 150
            });

            const buildingInvoice = new Invoice({
                id: 'invoice-1',
                building_id: 'building-1', // No unit_id
                amount: 100,
                paid_amount: 0,
                period: '2026-01',
                issue_date: new Date(),
                status: InvoiceStatus.PENDING,
                type: InvoiceType.DEBT
            });

            (allocationRepo.findByPaymentId as ReturnType<typeof mock>).mockImplementation(async () => [allocation]);
            (invoiceRepo.findById as ReturnType<typeof mock>).mockImplementation(async () => buildingInvoice);

            await approvePayment.approve({ paymentId: 'payment-1', approverId: 'admin-1' });

            expect(creditLedgerRepo.addCredit).not.toHaveBeenCalled();
        });
    });

    describe('idempotency', () => {
        it('short-circuits and does not re-process allocations when payment is already APPROVED', async () => {
            const admin = new User({
                id: 'admin-1',
                email: 'admin@test.com',
                name: 'Admin',
                role: UserRole.ADMIN,
                status: UserStatus.ACTIVE
            });

            const alreadyApproved = new Payment({
                id: 'payment-1',
                user_id: 'user-1',
                building_id: 'building-1',
                amount: 150,
                payment_date: new Date(),
                method: PaymentMethod.TRANSFER,
                status: PaymentStatus.APPROVED,
                unit_id: 'unit-1'
            });

            await userRepo.create(admin);
            await paymentRepo.create(alreadyApproved);

            const allocation = new PaymentAllocation({
                id: 'alloc-1',
                payment_id: 'payment-1',
                invoice_id: 'invoice-1',
                amount: 150
            });
            (allocationRepo.findByPaymentId as ReturnType<typeof mock>).mockImplementation(async () => [allocation]);

            await approvePayment.approve({ paymentId: 'payment-1', approverId: 'admin-1' });

            // The allocation loop must NOT run again — no overpayment processing,
            // no duplicate credit entries.
            expect(allocationRepo.findByPaymentId).not.toHaveBeenCalled();
            expect(creditLedgerRepo.addCredit).not.toHaveBeenCalled();
        });
    });
});
