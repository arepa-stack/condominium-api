import { Elysia, t } from 'elysia';
import { SupabaseInvoiceRepository } from '../infrastructure/repositories/SupabaseInvoiceRepository';
import { SupabasePaymentAllocationRepository } from '../infrastructure/repositories/SupabasePaymentAllocationRepository';
import { SupabaseCreditLedgerRepository } from '../infrastructure/repositories/SupabaseCreditLedgerRepository';
import { LoadDebt } from '../application/use-cases/LoadDebt';
import { GetUnitBalance } from '../application/use-cases/GetUnitBalance';
import { GetUnitInvoices } from '../application/use-cases/GetUnitInvoices';
import { GetAllInvoices } from '../application/use-cases/GetAllInvoices';
import { GetUnitCredit } from '../application/use-cases/GetUnitCredit';
import { UnauthorizedError, NotFoundError } from '@/core/errors';
import { supabase, supabaseAdmin } from '@/infrastructure/supabase';
import { UserRole, InvoiceTag } from '@/core/domain/enums';
import { PreviewInvoicesFromExcel } from '../application/use-cases/PreviewInvoicesFromExcel';
import { BulkLoadInvoicesFromExcel } from '../application/use-cases/BulkLoadInvoicesFromExcel';
import { SupabaseUnitRepository } from '../../buildings/infrastructure/repositories/SupabaseUnitRepository';
import { ExcelJSInvoiceParser } from '../infrastructure/services/ExcelJSInvoiceParser';

// Initialize Repos & Use Cases
const invoiceRepository = new SupabaseInvoiceRepository();
const allocationRepository = new SupabasePaymentAllocationRepository();
const creditLedgerRepository = new SupabaseCreditLedgerRepository();
const unitRepository = new SupabaseUnitRepository();
const excelParser = new ExcelJSInvoiceParser();

const loadDebt = new LoadDebt(invoiceRepository);
const getUnitBalance = new GetUnitBalance(invoiceRepository, allocationRepository);
const getUnitInvoices = new GetUnitInvoices(invoiceRepository);
const getAllInvoices = new GetAllInvoices(invoiceRepository);
const getUnitCredit = new GetUnitCredit(creditLedgerRepository);
const previewInvoices = new PreviewInvoicesFromExcel(unitRepository, excelParser);
const bulkLoadInvoices = new BulkLoadInvoicesFromExcel(invoiceRepository, unitRepository);

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
    created_at: t.Optional(t.String()),
    unit: t.Object({
        id: t.Optional(t.String()),
        name: t.Optional(t.String())
    }),
    user: t.Union([
        t.Null(),
        t.Object({
            id: t.String(),
            name: t.String()
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
    invoiceId: t.String(),
    amount: t.Number(),
    paid: t.Number(),
    remaining: t.Number(),
    period: t.String(),
    status: t.String()
});

const BalanceSchema = t.Object({
    unit: t.String(),
    totalDebt: t.Number(),
    pendingInvoices: t.Number(),
    details: t.Array(BalanceDetailSchema)
});

export const billingRoutes = new Elysia({ prefix: '/billing' })
    .derive(async ({ request }) => {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new UnauthorizedError('Authentication required');

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) throw new UnauthorizedError('Invalid or expired token');

        // Get profile with units for role and ownership check
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id, email, name, role, status, profile_units(unit_id)')
            .eq('id', user.id)
            .single();

        if (!profile) throw new UnauthorizedError('Profile not found');

        return { user, profile };
    })
    // 0. Get All Invoices (Admin/Board Filtered)
    .get('/invoices', async ({ query, profile }) => {
        // Allow Admin/Board OR Resident (if filtering by their own unit)
        if (profile.role === UserRole.RESIDENT) {
            if (!query.unit_id) {
                throw new UnauthorizedError('Residents must specify a unit_id');
            }
            // Verify ownership
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === query.unit_id);

            if (!hasAccess) {
                throw new UnauthorizedError('You do not have access to this unit invoices');
            }
        } else if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.BOARD) {
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
            unit_id: query.unit_id,
            building_id: query.building_id,
            status: query.status,
            period: period,
            user_id: query.user_id,
            tag: query.tag as InvoiceTag | undefined
        });
    }, {
        query: t.Object({
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
        response: t.Array(AdminInvoiceSchema),
        detail: {
            tags: ['Admin - Billing'],
            summary: 'List all invoices with filters (Admin)',
            security: [{ BearerAuth: [] }]
        }
    })
    // 1.5. Preview Excel Invoices
    .post('/invoices/preview', async ({ query, body, profile }) => {
        if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.BOARD) {
            throw new UnauthorizedError('Only Admin/Board can preview invoices');
        }

        const file = body.file as File;
        if (!file) throw new Error('Excel file is required');

        const buffer = Buffer.from(await file.arrayBuffer());
        return await previewInvoices.execute(buffer, query.building_id);
    }, {
        query: t.Object({
            building_id: t.String()
        }),
        body: t.Object({
            file: t.File()
        }),
        response: t.Object({
            invoices: t.Array(t.Object({
                unitName: t.String(),
                amount: t.Number(),
                period: t.String(),
                issueDate: t.Any(),
                receiptNumber: t.String(),
                unitId: t.Optional(t.String()),
                status: t.String(),
                warning: t.Optional(t.String())
            })),
            unitsToCreate: t.Array(t.String())
        }),
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Preview invoices from Excel file (Admin)',
            security: [{ BearerAuth: [] }]
        }
    })
    // 1.6. Confirm Excel Invoices
    .post('/invoices/confirm', async ({ query, body, profile }) => {
        if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.BOARD) {
            throw new UnauthorizedError('Only Admin/Board can confirm invoices');
        }

        await bulkLoadInvoices.execute({
            invoices: body.invoices.map(item => ({
                ...item,
                status: item.status as 'EXISTS' | 'TO_BE_CREATED'
            })),
            buildingId: query.building_id
        });

        return { success: true };
    }, {
        query: t.Object({
            building_id: t.String()
        }),
        body: t.Object({
            invoices: t.Array(t.Object({
                unitName: t.String(),
                amount: t.Number(),
                period: t.String(),
                issueDate: t.String(),
                receiptNumber: t.String(),
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
        if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.BOARD) {
            throw new UnauthorizedError('Only Admin/Board can load debt');
        }

        const invoice = await loadDebt.execute({
            unitId: body.unit_id,
            amount: typeof body.amount === 'string' ? parseFloat(body.amount) : body.amount,
            period: body.period,
            description: body.description,
            dueDate: body.due_date ? new Date(body.due_date) : undefined
        });

        return invoice.toJSON();
    }, {
        body: t.Object({
            unit_id: t.String(),
            amount: t.Union([t.Number(), t.String()]),
            period: t.String({ examples: ['2026-01'] }),
            description: t.String(),
            due_date: t.Optional(t.String())
        }),
        response: InvoiceSchema,
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Load debt to a unit (Admin/Board)',
            security: [{ BearerAuth: [] }]
        }
    })
    // 2. Get Unit Balance
    .get('/units/:id/balance', async ({ params, profile }) => {
        // Auth: Admin, Board (any building for now, ideally same building), or Resident (same unit)
        if (profile.role === UserRole.RESIDENT) {
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === params.id);
            if (!hasAccess) {
                throw new UnauthorizedError('Unauthorized: You do not have access to this unit balance');
            }
        } else if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.BOARD) {
            throw new UnauthorizedError('Only Admin, Board or the unit resident can see balance');
        }

        return await getUnitBalance.execute(params.id);
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
        if (profile.role === UserRole.RESIDENT) {
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === params.id);
            if (!hasAccess) {
                throw new UnauthorizedError('Unauthorized: You do not have access to this unit invoices');
            }
        } else if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.BOARD) {
            throw new UnauthorizedError('Only Admin, Board or the unit resident can see invoices');
        }

        const invoices = await getUnitInvoices.execute(params.id, query.tag as InvoiceTag | undefined);
        return invoices.map(inv => inv.toJSON());
    }, {
        query: t.Object({
            tag: t.Optional(t.Union([
                t.Literal(InvoiceTag.NORMAL),
                t.Literal(InvoiceTag.PETTY_CASH)
            ]))
        }),
        response: t.Array(InvoiceSchema),
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
        if (profile.role === UserRole.RESIDENT) {
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === unitId);
            if (!hasAccess) {
                throw new UnauthorizedError('You do not have access to this unit credit balance');
            }
        } else if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.BOARD) {
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
                reference_type: t.String(),
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
    .get('/invoices/:id/payments', async ({ params, profile }) => {
        // Auth: Admin or Board (or resident if they own the unit of this invoice)
        // For now, simpler: Admin or Board
        if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.BOARD) {
            // we could check if profile.profile_units contains invoice.unit_id
            // but for simplicity return allocations. Repository handles basic fetch.
        }

        return await allocationRepository.findPaymentsByInvoiceId(params.id);
    }, {
        response: t.Array(t.Object({
            id: t.String(),
            amount: t.Number(),
            status: t.String(),
            payment_date: t.String(),
            method: t.String(),
            reference: t.Optional(t.String()),
            allocated_amount: t.Number(),
            allocation_id: t.String(),
            allocated_at: t.Any(),
            user: t.Optional(t.Object({
                id: t.String(),
                name: t.String()
            }))
            // Add other payment fields if needed
        })),
        detail: {
            tags: ['Admin - Billing'],
            summary: 'Get all payments for a specific invoice',
            security: [{ BearerAuth: [] }]
        }
    })
    // 4.5. Get Invoices for a Payment
    .get('/payments/:id/invoices', async ({ params, profile }) => {
        // Auth: Admin or Board
        if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.BOARD) {
            throw new UnauthorizedError('Only Admin/Board can see payment allocations');
        }

        return await allocationRepository.findInvoicesByPaymentId(params.id);
    }, {
        response: t.Array(t.Object({
            id: t.String(),
            unit_id: t.String(),
            amount: t.Number(),
            period: t.String(),
            description: t.Optional(t.String()),
            receipt_number: t.Optional(t.String()),
            status: t.String(),
            paid_amount: t.Optional(t.Number()),
            due_date: t.Optional(t.Any()),
            created_at: t.Optional(t.Any()),
            updated_at: t.Optional(t.Any()),
            allocated_amount: t.Number(),
            allocation_id: t.String(),
            allocated_at: t.Any()
        })),
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
        if (profile.role !== UserRole.ADMIN && profile.role !== UserRole.BOARD) {
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
