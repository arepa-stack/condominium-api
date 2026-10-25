import { Elysia, t } from 'elysia';
import { SupabaseInvoiceRepository } from '../infrastructure/repositories/SupabaseInvoiceRepository';
import { SupabasePaymentAllocationRepository } from '../infrastructure/repositories/SupabasePaymentAllocationRepository';
import { SupabaseCreditLedgerRepository } from '../infrastructure/repositories/SupabaseCreditLedgerRepository';
import { LoadDebt } from '../application/use-cases/LoadDebt';
import { GetUnitBalance } from '../application/use-cases/GetUnitBalance';
import { GetUnitInvoices } from '../application/use-cases/GetUnitInvoices';
import { GetAllInvoices } from '../application/use-cases/GetAllInvoices';
import { GetUnitCredit } from '../application/use-cases/GetUnitCredit';
import { GetInvoicePayments } from '../application/use-cases/GetInvoicePayments';
import { GetPaymentInvoices } from '../application/use-cases/GetPaymentInvoices';
import { UnauthorizedError, NotFoundError, DomainError } from '@/core/errors';
import { supabase, supabaseAdmin } from '@/infrastructure/supabase';
import { InvoiceTag } from '@/core/domain/enums';
import { InvoiceStatus } from '../domain/entities/Invoice';
import { PreviewInvoicesFromExcel } from '../application/use-cases/PreviewInvoicesFromExcel';
import { BulkLoadInvoicesFromExcel } from '../application/use-cases/BulkLoadInvoicesFromExcel';
import { SupabaseUnitRepository } from '../../buildings/infrastructure/repositories/SupabaseUnitRepository';
import { ExcelJSInvoiceParser } from '../infrastructure/services/ExcelJSInvoiceParser';
import { DinastiaNoticePdfParser } from '../infrastructure/services/DinastiaNoticePdfParser';
import { ProcessInvoiceOverpayment } from '../application/use-cases/ProcessInvoiceOverpayment';
import { ChargeConceptGuard } from '../application/services/ChargeConceptGuard';
import { SupabaseChargeConceptRepository } from '../infrastructure/repositories/SupabaseChargeConceptRepository';
import { SupabasePaymentRepository } from '@/modules/payments/infrastructure/repositories/SupabasePaymentRepository';
import { RegisterPayment } from '@/modules/payments/application/use-cases/RegisterPayment';
import { ApprovePayment } from '@/modules/payments/application/use-cases/ApprovePayment';
import { RecordInvoicePayment } from '@/modules/payments/application/use-cases/RecordInvoicePayment';
import { SupabaseUserRepository } from '@/modules/users/infrastructure/repositories/SupabaseUserRepository';
import { SupabaseBuildingRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseBuildingRepository';
import { SupabasePettyCashRepository } from '@/modules/petty-cash/infrastructure/repositories/SupabasePettyCashRepository';
import { exchangeRateService } from '@/infrastructure/exchange-rate';
import { PaymentMethod } from '@/core/domain/enums';
import type { RateSource } from '@/core/domain/ports/IExchangeRateService';

// Initialize Repos & Use Cases
const invoiceRepository = new SupabaseInvoiceRepository();
const allocationRepository = new SupabasePaymentAllocationRepository();
const creditLedgerRepository = new SupabaseCreditLedgerRepository();
const unitRepository = new SupabaseUnitRepository();
const excelParser = new ExcelJSInvoiceParser();

const paymentRepository = new SupabasePaymentRepository();
const userRepository = new SupabaseUserRepository();
const recordInvoicePayment = new RecordInvoicePayment(
    invoiceRepository,
    unitRepository,
    userRepository,
    paymentRepository,
    new RegisterPayment(paymentRepository, allocationRepository, new SupabaseBuildingRepository(), exchangeRateService),
    new ApprovePayment(
        paymentRepository,
        userRepository,
        allocationRepository,
        new ProcessInvoiceOverpayment(invoiceRepository, creditLedgerRepository),
        invoiceRepository,
        new SupabasePettyCashRepository()
    )
);
const conceptGuard = new ChargeConceptGuard(new SupabaseChargeConceptRepository(), unitRepository);
const loadDebt = new LoadDebt(invoiceRepository, recordInvoicePayment, conceptGuard);

const toNumber = (value: number | string | undefined | null) =>
    value === undefined || value === null || value === '' ? undefined : (typeof value === 'string' ? parseFloat(value) : value);

function parsePaymentMethod(value: string | undefined): PaymentMethod | undefined {
    if (value === undefined) return undefined;
    if (!(Object.values(PaymentMethod) as string[]).includes(value)) {
        throw new DomainError(`Invalid payment method: ${value}`, 'VALIDATION_ERROR', 400);
    }
    return value as PaymentMethod;
}

const RateSourceSchema = t.Union([t.Literal('euro_oficial'), t.Literal('dolar_oficial'), t.Literal('dolar_paralelo'), t.Null()]);
const getUnitBalance = new GetUnitBalance(invoiceRepository, creditLedgerRepository);
const getUnitInvoices = new GetUnitInvoices(invoiceRepository);
const getAllInvoices = new GetAllInvoices(invoiceRepository);
const getUnitCredit = new GetUnitCredit(creditLedgerRepository);
const getInvoicePayments = new GetInvoicePayments(allocationRepository);
const getPaymentInvoices = new GetPaymentInvoices(allocationRepository);
const previewInvoices = new PreviewInvoicesFromExcel(unitRepository, excelParser);
const previewPdfInvoices = new PreviewInvoicesFromExcel(unitRepository, new DinastiaNoticePdfParser());
const bulkLoadInvoices = new BulkLoadInvoicesFromExcel(invoiceRepository, unitRepository, conceptGuard);

const InvoiceSchema = t.Object({
    id: t.String(),
    unit_id: t.Optional(t.Union([t.String(), t.Null(), t.Undefined()])),
    building_id: t.Optional(t.Union([t.String(), t.Null(), t.Undefined()])),
    amount: t.Number(),
    period: t.String(),
    description: t.Optional(t.Union([t.String(), t.Null()])),
    receipt_number: t.Optional(t.Union([t.String(), t.Null()])),
    status: t.String(),
    tag: t.Optional(t.String()),
    paid_amount: t.Optional(t.Union([t.Number(), t.Null()])),
    concept_id: t.Optional(t.Union([t.String(), t.Null()])),
    due_date: t.Optional(t.Any()),
    created_at: t.Optional(t.Any()),
    updated_at: t.Optional(t.Any())
});

const AdminInvoiceSchema = t.Object({
    id: t.String(),
    amount: t.Number(),
    paid_amount: t.Number(),
    status: t.String(),
    period: t.String(),
    year: t.Number(),
    month: t.Number(),
    issue_date: t.String(),
    receipt_number: t.Optional(t.Union([t.String(), t.Null()])),
    description: t.Optional(t.Union([t.String(), t.Null()])),
    due_date: t.Optional(t.Union([t.String(), t.Null()])),
    concept_id: t.Optional(t.Union([t.String(), t.Null()])),
    created_at: t.Optional(t.String()),
    unit: t.Object({
        id: t.Optional(t.String()),
        name: t.Optional(t.String()),
        aliquot: t.Optional(t.Union([t.Number(), t.Null()]))
    }),
    user: t.Union([
        t.Null(),
        t.Object({
            id: t.String(),
            name: t.String(),
            email: t.Optional(t.Union([t.String(), t.Null()])),
            phone: t.Optional(t.Union([t.String(), t.Null()]))
        })
    ])
});

const AllocationSchema = t.Object({
    id: t.String(),
    payment_id: t.String(),
    invoice_id: t.String(),
    amount: t.Number(),
    created_at: t.Optional(t.Any())
});

const BalanceDetailSchema = t.Object({
    invoice_id: t.String(),
    amount: t.Number(),
    paid: t.Number(),
    remaining: t.Number(),
    period: t.String(),
    status: t.String()
});

const BalanceSchema = t.Object({
    unit: t.String(),
    total_debt: t.Number(),
    pending_invoices: t.Number(),
    credit_balance: t.Number(),
    net_balance: t.Number(),
    details: t.Array(BalanceDetailSchema)
});

const PaginationMetadataSchema = t.Object({
    total: t.Number(),
    page: t.Number(),
    limit: t.Number(),
    total_pages: t.Number(),
    has_next_page: t.Boolean(),
    has_prev_page: t.Boolean()
});

const PaginatedAdminInvoiceSchema = t.Object({
    data: t.Array(AdminInvoiceSchema),
    metadata: PaginationMetadataSchema
});

const InvoicePaymentSchema = t.Object({
    id: t.String(),
    amount: t.Number(),
    status: t.String(),
    payment_date: t.String(),
    method: t.String(),
    // Nullable: cash payments carry no bank reference.
    reference: t.Optional(t.Union([t.String(), t.Null()])),
    allocated_amount: t.Number(),
    allocation_id: t.String(),
    allocated_at: t.Any(),
    user: t.Optional(t.Object({
        id: t.String(),
        name: t.String()
    }))
});

const PaginatedInvoicePaymentSchema = t.Object({
    data: t.Array(InvoicePaymentSchema),
    metadata: PaginationMetadataSchema
});

const PaymentInvoiceSchema = t.Object({
    id: t.String(),
    unit_id: t.String(),
    amount: t.Number(),
    period: t.String(),
    description: t.Optional(t.Union([t.String(), t.Null()])),
    receipt_number: t.Optional(t.Union([t.String(), t.Null()])),
    status: t.String(),
    paid_amount: t.Optional(t.Number()),
    due_date: t.Optional(t.Any()),
    created_at: t.Optional(t.Any()),
    updated_at: t.Optional(t.Any()),
    allocated_amount: t.Number(),
    allocation_id: t.String(),
    allocated_at: t.Any()
});

const PaginatedPaymentInvoiceSchema = t.Object({
    data: t.Array(PaymentInvoiceSchema),
    metadata: PaginationMetadataSchema
});

const PaginatedInvoiceSchema = t.Object({
    data: t.Array(InvoiceSchema),
    metadata: PaginationMetadataSchema
});

export const billingRoutes = new Elysia({ prefix: '/billing' })
    .derive(async ({ request }) => {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new UnauthorizedError('Authentication required');

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) throw new UnauthorizedError('Invalid or expired token');

        // Load profile + units + board memberships in one round-trip.
        // Phase 4 contract: app_role + boardBuildingIds. The legacy `role`
        // column/field is gone — downstream inline checks use two helpers
        // (isAdmin, isBoardAnywhere, isResidentOnly) derived at the end.
        const { data: rawProfile } = await supabaseAdmin
            .from('profiles')
            .select('id, email, name, app_role, status, profile_units(unit_id), building_members(building_id, role)')
            .eq('id', user.id)
            .single();

        if (!rawProfile) throw new UnauthorizedError('Profile not found');

        const app_role: 'admin' | 'user' = (rawProfile.app_role as 'admin' | 'user') ?? 'user';

        const boardBuildingIds = ((rawProfile.building_members as any[] | null) ?? [])
            .filter(bm => bm.role === 'board')
            .map(bm => bm.building_id as string);

        const isAdmin = app_role === 'admin';
        const isBoardAnywhere = boardBuildingIds.length > 0;
        const isResidentOnly = !isAdmin && !isBoardAnywhere;

        const profile = {
            ...rawProfile,
            app_role,
            boardBuildingIds,
            isAdmin,
            isBoardAnywhere,
            isResidentOnly,
        };

        return { user, profile };
    })
    // 0. Get All Invoices (Admin/Board Filtered)
    .get('/invoices', async ({ query, profile }) => {
        // Allow Admin/Board OR Resident (if filtering by their own unit)
        if (profile.isResidentOnly) {
            if (!query.unit_id) {
                throw new UnauthorizedError('Residents must specify a unit_id');
            }
            // Verify ownership
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === query.unit_id);

            if (!hasAccess) {
                throw new UnauthorizedError('You do not have access to this unit invoices');
            }
        } else if (!profile.isAdmin && !profile.isBoardAnywhere) {
            throw new UnauthorizedError('Only Admin/Board can list all invoices');
        }

        // Board restriction? Maybe implicitly filtered by building in Repo?
        // Ideally checking Board building_id.
        // For now, assuming Admin access pattern.

        let period = query.period;
        if (!period && query.year && query.month) {
            const m = query.month.toString().padStart(2, '0');
            period = `${query.year}-${m}`;
        }

        return await getAllInvoices.execute({
            page: query.page,
            limit: query.limit,
            unit_id: query.unit_id,
            building_id: query.building_id,
            status: query.status,
            period: period,
            user_id: query.user_id,
            tag: query.tag as InvoiceTag | undefined
        });
    }, {
        query: t.Object({
            page: t.Optional(t.Numeric()),
            limit: t.Optional(t.Union([t.Numeric(), t.Literal('all')])),
            unit_id: t.Optional(t.String()),
            building_id: t.Optional(t.String()),
            status: t.Optional(t.String()),
            period: t.Optional(t.String({ example: '2026-01' })),
            year: t.Optional(t.Numeric()),
            month: t.Optional(t.Numeric()),
            user_id: t.Optional(t.String()),
            tag: t.Optional(t.Union([
                t.Literal(InvoiceTag.NORMAL),
                t.Literal(InvoiceTag.PETTY_CASH)
            ]))
        }),
        response: PaginatedAdminInvoiceSchema,
        detail: {
            tags: ['Admin - Billing'],
            summary: 'List all invoices with filters (Admin)',
            security: [{ BearerAuth: [] }]
        }
    })
    // 1.5. Preview Excel Invoices
    .post('/invoices/preview', async ({ query, body, profile }) => {
        if (!profile.isAdmin && !profile.isBoardAnywhere) {
            throw new UnauthorizedError('Only Admin/Board can preview invoices');
        }

        const file = body.file as File;
        if (!file) throw new Error('Excel file is required');

        const buffer = Buffer.from(await file.arrayBuffer());
        const preview = await previewInvoices.execute(buffer, query.building_id);
        return {
            invoices: preview.invoices.map(inv => ({
                unit_name: inv.unitName,
                amount: inv.amount,
                period: inv.period,
                issue_date: inv.issueDate,
                receipt_number: inv.receiptNumber,
                description: inv.description,
                unit_id: inv.unitId,
                status: inv.status,
                warning: inv.warning
            })),
            units_to_create: preview.unitsToCreate
        };
    }, {
        query: t.Object({
            building_id: t.String()
        }),
        body: t.Object({
            file: t.File()
        }),
        response: t.Object({
            invoices: t.Array(t.Object({
                unit_name: t.String(),
                amount: t.Number(),
                period: t.String(),
                issue_date: t.Any(),
                receipt_number: t.String(),
                description: t.Optional(t.String()),
                unit_id: t.Optional(t.String()),
                status: t.String(),
                warning: t.Optional(t.String())
            })),
            units_to_create: t.Array(t.String())
        }),
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Preview invoices from Excel file (Admin)',
            security: [{ BearerAuth: [] }]
        }
    })
    // 1.5b. Preview invoices from a Dinastia "avisos de cobro" PDF (one notice per page)
    .post('/invoices/preview-pdf', async ({ query, body, profile }) => {
        if (!profile.isAdmin && !profile.isBoardAnywhere) {
            throw new UnauthorizedError('Only Admin/Board can preview invoices');
        }

        const file = body.file as File;
        if (!file) throw new Error('PDF file is required');

        const buffer = Buffer.from(await file.arrayBuffer());
        const preview = await previewPdfInvoices.execute(buffer, query.building_id);
        return {
            invoices: preview.invoices.map(inv => ({
                unit_name: inv.unitName,
                amount: inv.amount,
                period: inv.period,
                issue_date: inv.issueDate,
                receipt_number: inv.receiptNumber,
                description: inv.description,
                unit_id: inv.unitId,
                status: inv.status,
                warning: inv.warning
            })),
            units_to_create: preview.unitsToCreate
        };
    }, {
        query: t.Object({
            building_id: t.String()
        }),
        body: t.Object({
            file: t.File()
        }),
        response: t.Object({
            invoices: t.Array(t.Object({
                unit_name: t.String(),
                amount: t.Number(),
                period: t.String(),
                issue_date: t.Any(),
                receipt_number: t.String(),
                description: t.Optional(t.String()),
                unit_id: t.Optional(t.String()),
                status: t.String(),
                warning: t.Optional(t.String())
            })),
            units_to_create: t.Array(t.String())
        }),
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Preview invoices from administrator PDF notices (Admin)',
            security: [{ BearerAuth: [] }]
        }
    })
    // 1.6. Confirm Excel Invoices
    .post('/invoices/confirm', async ({ query, body, profile }) => {
        if (!profile.isAdmin && !profile.isBoardAnywhere) {
            throw new UnauthorizedError('Only Admin/Board can confirm invoices');
        }

        await bulkLoadInvoices.execute({
            invoices: body.invoices.map(item => ({
                unitName: item.unit_name,
                amount: item.amount,
                period: item.period,
                issueDate: item.issue_date,
                receiptNumber: item.receipt_number,
                description: item.description,
                status: item.status as 'EXISTS' | 'TO_BE_CREATED'
            })),
            buildingId: query.building_id,
            conceptId: body.concept_id ?? undefined
        });

        return { success: true };
    }, {
        query: t.Object({
            building_id: t.String()
        }),
        body: t.Object({
            concept_id: t.Optional(t.Union([t.String({ format: 'uuid' }), t.Null()])),
            invoices: t.Array(t.Object({
                unit_name: t.String(),
                amount: t.Number(),
                period: t.String(),
                issue_date: t.String(),
                receipt_number: t.String(),
                description: t.Optional(t.String()),
                status: t.String()
            }))
        }),
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Confirm and load invoices from Excel (Admin)',
            security: [{ BearerAuth: [] }]
        }
    })
    // 1. Admin loads Debt
    .post('/debt', async ({ body, profile }) => {
        if (!profile.isAdmin && !profile.isBoardAnywhere) {
            throw new UnauthorizedError('Only Admin/Board can load debt');
        }

        const invoice = await loadDebt.execute({
            unitId: body.unit_id,
            amount: typeof body.amount === 'string' ? parseFloat(body.amount) : body.amount,
            period: body.period,
            description: body.description,
            conceptId: body.concept_id ?? undefined,
            dueDate: body.due_date ? new Date(body.due_date) : undefined,
            receiptNumber: body.receipt_number?.trim() || undefined,
            status: body.status as InvoiceStatus | undefined,
            paidAmount: toNumber(body.paid_amount),
            // A payment received with the debt is recorded through RecordInvoicePayment
            actorId: profile.id,
            paymentMethod: parsePaymentMethod(body.payment_method),
            paymentDate: body.payment_date ? new Date(body.payment_date) : undefined,
            amountVes: toNumber(body.amount_ves),
            exchangeRate: toNumber(body.exchange_rate),
            rateSource: body.rate_source as RateSource | null | undefined,
        });

        return invoice.toJSON();
    }, {
        body: t.Object({
            unit_id: t.String(),
            amount: t.Union([t.Number(), t.String()]),
            period: t.String({ examples: ['2026-01'] }),
            description: t.String(),
            concept_id: t.Optional(t.Union([t.String({ format: 'uuid' }), t.Null()])),
            due_date: t.Optional(t.String()),
            receipt_number: t.Optional(t.Union([t.String(), t.Null()])),
            status: t.Optional(t.String()),
            paid_amount: t.Optional(t.Union([t.Number(), t.String()])),
            payment_method: t.Optional(t.String()),
            payment_date: t.Optional(t.String()),
            amount_ves: t.Optional(t.Union([t.Number(), t.String()])),
            exchange_rate: t.Optional(t.Union([t.Number(), t.String()])),
            rate_source: t.Optional(RateSourceSchema),
        }),
        response: InvoiceSchema,
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Load debt to a unit (Admin/Board)',
            security: [{ BearerAuth: [] }]
        }
    })
    // 1.1 Admin updates invoice (e.g. mark as PAID)
    .patch('/invoices/:id', async ({ params, body, profile }) => {
        if (!profile.isAdmin && !profile.isBoardAnywhere) {
            throw new UnauthorizedError('Only Admin/Board can update invoices');
        }

        const invoice = await invoiceRepository.findById(params.id);
        if (!invoice) throw new NotFoundError('Invoice not found');

        const updates: any = {};
        if (body.description !== undefined) updates.description = body.description;
        if (body.receipt_number !== undefined) updates.receipt_number = body.receipt_number;
        if (body.due_date !== undefined) updates.due_date = body.due_date ? new Date(body.due_date) : null;

        const paymentMethod = parsePaymentMethod(body.payment_method);

        // Money only moves through the payment path, never by writing paid_amount here.
        if (body.paid_amount !== undefined && body.status !== 'PAID') {
            throw new DomainError('Use POST /billing/invoices/:id/payments to register a payment', 'VALIDATION_ERROR', 400);
        }
        if (body.status !== undefined && body.status !== 'PAID') {
            updates.status = body.status;
        }

        updates.updated_at = new Date();

        const { data, error } = await supabaseAdmin
            .from('invoices')
            .update(updates)
            .eq('id', params.id)
            .select()
            .single();

        if (error) {
            throw new DomainError('Error updating invoice: ' + error.message, 'DB_ERROR', 500);
        }

        // "Marcar como pagada": pay the remaining balance with an approved payment.
        if (body.status === 'PAID' && invoice.status !== InvoiceStatus.PAID) {
            await recordInvoicePayment.execute({
                invoiceId: invoice.id,
                actorId: profile.id,
                amount: invoice.remainingBalance,
                method: paymentMethod ?? PaymentMethod.CASH,
                paymentDate: body.payment_date ? new Date(body.payment_date) : new Date(),
                reference: body.receipt_number || invoice.receipt_number || undefined,
                notes: 'Factura marcada como pagada por administración.',
            });

            const { data: paid, error: readError } = await supabaseAdmin
                .from('invoices')
                .select()
                .eq('id', params.id)
                .single();
            if (readError) {
                throw new DomainError('Error reading invoice: ' + readError.message, 'DB_ERROR', 500);
            }
            return paid;
        }

        return data;
    }, {
        body: t.Object({
            status: t.Optional(t.String()),
            paid_amount: t.Optional(t.Union([t.Number(), t.String()])),
            receipt_number: t.Optional(t.Union([t.String(), t.Null()])),
            description: t.Optional(t.String()),
            due_date: t.Optional(t.Union([t.String(), t.Null()])),
            payment_method: t.Optional(t.String()),
            payment_date: t.Optional(t.String()),
        }),
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Update invoice status or details (Admin/Board)',
            security: [{ BearerAuth: [] }]
        }
    })
    // 1.2 Admin/Board records a full or partial payment on an existing invoice
    .post('/invoices/:id/payments', async ({ params, body, profile }) => {
        if (!profile.isAdmin && !profile.isBoardAnywhere) {
            throw new UnauthorizedError('Only Admin/Board can record invoice payments');
        }

        const { invoice, payment } = await recordInvoicePayment.execute({
            invoiceId: params.id,
            actorId: profile.id,
            amount: toNumber(body.amount) ?? 0,
            method: parsePaymentMethod(body.method)!,
            paymentDate: body.payment_date ? new Date(body.payment_date) : new Date(),
            reference: body.reference?.trim() || undefined,
            bank: body.bank?.trim() || undefined,
            notes: body.notes?.trim() || undefined,
            amountVes: toNumber(body.amount_ves),
            exchangeRate: toNumber(body.exchange_rate),
            rateSource: body.rate_source as RateSource | null | undefined,
        });

        return { invoice: invoice.toJSON(), payment: payment.toJSON() };
    }, {
        body: t.Object({
            amount: t.Union([t.Number(), t.String()], { examples: [50] }),
            method: t.String({ examples: ['PAGO_MOVIL', 'TRANSFER', 'CASH'] }),
            payment_date: t.Optional(t.String({ examples: ['2026-10-20'] })),
            reference: t.Optional(t.String()),
            bank: t.Optional(t.String()),
            notes: t.Optional(t.String()),
            amount_ves: t.Optional(t.Union([t.Number(), t.String()])),
            exchange_rate: t.Optional(t.Union([t.Number(), t.String()])),
            rate_source: t.Optional(RateSourceSchema),
        }),
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Record a full or partial payment on an existing invoice (Admin/Board)',
            description: 'Registers an approved payment allocated to the invoice. Rejects amounts above the remaining balance and PAID/CANCELLED invoices. When paid in Bolívares, amount stays the credited USD and amount_ves/exchange_rate/rate_source are kept as provenance.',
            security: [{ BearerAuth: [] }]
        }
    })
    // 2. Get Unit Balance
    .get('/units/:id/balance', async ({ params, profile }) => {
        // Auth: Admin, Board (any building for now, ideally same building), or Resident (same unit)
        if (profile.isResidentOnly) {
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === params.id);
            if (!hasAccess) {
                throw new UnauthorizedError('Unauthorized: You do not have access to this unit balance');
            }
        } else if (!profile.isAdmin && !profile.isBoardAnywhere) {
            throw new UnauthorizedError('Only Admin, Board or the unit resident can see balance');
        }

        const balance = await getUnitBalance.execute(params.id);
        return {
            unit: balance.unit,
            total_debt: balance.totalDebt,
            pending_invoices: balance.pendingInvoices,
            credit_balance: balance.creditBalance,
            net_balance: balance.netBalance,
            details: balance.details.map(d => ({
                invoice_id: d.invoiceId,
                amount: d.amount,
                paid: d.paid,
                remaining: d.remaining,
                period: d.period,
                status: d.status
            }))
        };
    }, {
        response: BalanceSchema,
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Get unit balance and pending invoices',
            security: [{ BearerAuth: [] }]
        }
    })
    // 3. Get All Unit Invoices
    .get('/units/:id/invoices', async ({ params, query, profile }) => {
        // Auth: Admin, Board or Resident (same unit)
        if (profile.isResidentOnly) {
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === params.id);
            if (!hasAccess) {
                throw new UnauthorizedError('Unauthorized: You do not have access to this unit invoices');
            }
        } else if (!profile.isAdmin && !profile.isBoardAnywhere) {
            throw new UnauthorizedError('Only Admin, Board or the unit resident can see invoices');
        }

        const result = await getUnitInvoices.execute(params.id, {
            tag: query.tag as InvoiceTag | undefined,
            page: query.page,
            limit: query.limit,
        });
        return {
            data: result.data.map(inv => inv.toJSON()),
            metadata: result.metadata,
        };
    }, {
        query: t.Object({
            page: t.Optional(t.Numeric()),
            limit: t.Optional(t.Union([t.Numeric(), t.Literal('all')])),
            tag: t.Optional(t.Union([
                t.Literal(InvoiceTag.NORMAL),
                t.Literal(InvoiceTag.PETTY_CASH)
            ]))
        }),
        response: PaginatedInvoiceSchema,
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Get all invoices for a unit',
            security: [{ BearerAuth: [] }]
        }
    })
    // 3.5. Get Unit Credit Balance and History
    .get('/units/:id/credit', async ({ params, profile }) => {
        const unitId = params.id;

        // Auth: Residents can only access their own units; Board/Admin can access any unit in their buildings
        if (profile.isResidentOnly) {
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === unitId);
            if (!hasAccess) {
                throw new UnauthorizedError('You do not have access to this unit credit balance');
            }
        } else if (!profile.isAdmin && !profile.isBoardAnywhere) {
            throw new UnauthorizedError('Only Admin, Board or the unit resident can see credit balance');
        }

        const result = await getUnitCredit.execute(unitId);

        return {
            balance: result.balance,
            history: result.history.map(entry => entry.toJSON())
        };
    }, {
        response: t.Object({
            balance: t.Number(),
            history: t.Array(t.Object({
                id: t.String(),
                unit_id: t.String(),
                amount: t.Number(),
                reason: t.String(),
                reference_type: t.Union([
                    t.Literal('payment'),
                    t.Literal('reversal'),
                    t.Literal('manual_adjustment')
                ]),
                reference_id: t.String(),
                created_at: t.Optional(t.Any())
            }))
        }),
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Get credit balance and history for a unit',
            security: [{ BearerAuth: [] }]
        }
    })
    // 4. Get Payments (allocations) for an Invoice
    .get('/invoices/:id/payments', async ({ params, query, profile }) => {
        // Auth: Admin or Board (or resident if they own the unit of this invoice)
        // For now, simpler: Admin or Board
        if (!profile.isAdmin && !profile.isBoardAnywhere) {
            // we could check if profile.profile_units contains invoice.unit_id
            // but for simplicity return allocations. Repository handles basic fetch.
        }

        return await getInvoicePayments.execute(params.id, {
            page: query.page,
            limit: query.limit,
        });
    }, {
        query: t.Object({
            page: t.Optional(t.Numeric()),
            limit: t.Optional(t.Union([t.Numeric(), t.Literal('all')]))
        }),
        response: PaginatedInvoicePaymentSchema,
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Get all payments for a specific invoice',
            security: [{ BearerAuth: [] }]
        }
    })
    // 4.5. Get Invoices for a Payment
    .get('/payments/:id/invoices', async ({ params, query, profile }) => {
        // Auth: Admin or Board
        if (!profile.isAdmin && !profile.isBoardAnywhere) {
            throw new UnauthorizedError('Only Admin/Board can see payment allocations');
        }

        return await getPaymentInvoices.execute(params.id, {
            page: query.page,
            limit: query.limit,
        });
    }, {
        query: t.Object({
            page: t.Optional(t.Numeric()),
            limit: t.Optional(t.Union([t.Numeric(), t.Literal('all')]))
        }),
        response: PaginatedPaymentInvoiceSchema,
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Get all invoices for a specific payment',
            security: [{ BearerAuth: [] }]
        }
    })
    // 5. Get Invoice Details
    .get('/invoices/:id', async ({ params, profile }) => {
        const invoice = await invoiceRepository.findById(params.id);
        if (!invoice) throw new NotFoundError('Invoice not found');

        // Authorization
        if (!profile.isAdmin && !profile.isBoardAnywhere) {
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === invoice.unit_id);
            if (!hasAccess) {
                throw new UnauthorizedError('Unauthorized: You do not have access to this invoice');
            }
        }

        return invoice.toJSON();
    }, {
        response: InvoiceSchema,
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Get invoice details',
            security: [{ BearerAuth: [] }]
        }
    });
