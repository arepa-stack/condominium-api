/**
 * Billing App Routes — APK (Residents)
 * Read-only: invoices, balance, credit for own unit.
 */

import { Elysia, t } from 'elysia';
import { SupabaseInvoiceRepository } from '../infrastructure/repositories/SupabaseInvoiceRepository';
import { SupabaseCreditLedgerRepository } from '../infrastructure/repositories/SupabaseCreditLedgerRepository';
import { SupabasePaymentAllocationRepository } from '../infrastructure/repositories/SupabasePaymentAllocationRepository';
import { GetUnitBalance } from '../application/use-cases/GetUnitBalance';
import { GetUnitInvoices } from '../application/use-cases/GetUnitInvoices';
import { GetUnitCredit } from '../application/use-cases/GetUnitCredit';
import { UnauthorizedError, NotFoundError } from '@/core/errors';
import { supabase, supabaseAdmin } from '@/infrastructure/supabase';
import { InvoiceTag } from '@/core/domain/enums';

const invoiceRepository = new SupabaseInvoiceRepository();
const creditLedgerRepository = new SupabaseCreditLedgerRepository();
const allocationRepository = new SupabasePaymentAllocationRepository();

const getUnitBalance = new GetUnitBalance(invoiceRepository, creditLedgerRepository);
const getUnitInvoices = new GetUnitInvoices(invoiceRepository);
const getUnitCredit = new GetUnitCredit(creditLedgerRepository);

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
    creditBalance: t.Number(),
    netBalance: t.Number(),
    details: t.Array(BalanceDetailSchema)
});

export const billingAppRoutes = new Elysia({ prefix: '/billing' })
    .derive(async ({ request }) => {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new UnauthorizedError('Authentication required');
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) throw new UnauthorizedError('Invalid or expired token');

        // Phase 4 contract: read app_role + joined building_members. The
        // previous SELECT asked for the legacy `role` column which was
        // dropped in phase 4; the query was silently failing and the
        // handler returned 401 'Profile not found' for every request.
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
    .get('/units/:id/balance', async ({ params, profile }) => {
        if (profile.isResidentOnly) {
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === params.id);
            if (!hasAccess) throw new UnauthorizedError('Unauthorized');
        }
        return await getUnitBalance.execute(params.id);
    }, {
        response: BalanceSchema,
        detail: { tags: ['App - Billing'], summary: 'Get unit balance and pending invoices' }
    })
    .get('/units/:id/invoices', async ({ params, query, profile }) => {
        if (profile.isResidentOnly) {
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === params.id);
            if (!hasAccess) throw new UnauthorizedError('Unauthorized');
        }
        const invoices = await getUnitInvoices.execute(params.id, query.tag as InvoiceTag | undefined);
        return invoices.map(inv => inv.toJSON());
    }, {
        query: t.Object({
            tag: t.Optional(t.Union([t.Literal(InvoiceTag.NORMAL), t.Literal(InvoiceTag.PETTY_CASH)]))
        }),
        response: t.Array(InvoiceSchema),
        detail: { tags: ['App - Billing'], summary: 'Get invoices for a unit' }
    })
    .get('/units/:id/credit', async ({ params, profile }) => {
        if (profile.isResidentOnly) {
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === params.id);
            if (!hasAccess) throw new UnauthorizedError('Unauthorized');
        }
        const result = await getUnitCredit.execute(params.id);
        return { balance: result.balance, history: result.history.map(e => e.toJSON()) };
    }, {
        response: t.Object({
            balance: t.Number(),
            history: t.Array(t.Object({
                id: t.String(), unit_id: t.String(), amount: t.Number(),
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
        detail: { tags: ['App - Billing'], summary: 'Get credit balance for a unit' }
    })
    // Invoice detail by id. Mirrors the admin endpoint at
    // /admin/billing/invoices/:id but with ownership enforcement for
    // residents — a resident can only fetch invoices belonging to one
    // of their own units.
    .get('/invoices/:id', async ({ params, profile }) => {
        const invoice = await invoiceRepository.findById(params.id);
        if (!invoice) throw new NotFoundError('Invoice not found');

        if (profile.isResidentOnly) {
            const ownsUnit = invoice.unit_id
                && profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === invoice.unit_id);
            if (!ownsUnit) {
                throw new UnauthorizedError('You do not have access to this invoice');
            }
        }

        return invoice.toJSON();
    }, {
        response: InvoiceSchema,
        detail: { tags: ['App - Billing'], summary: 'Get invoice details' }
    })
    // List payments allocated to a specific invoice. Mirrors the admin
    // endpoint at /admin/billing/invoices/:id/payments but with ownership
    // enforcement for residents — a resident can only see the payments
    // applied to an invoice that belongs to one of their own units.
    .get('/invoices/:id/payments', async ({ params, profile }) => {
        const invoice = await invoiceRepository.findById(params.id);
        if (!invoice) throw new NotFoundError('Invoice not found');

        if (profile.isResidentOnly) {
            const ownsUnit = invoice.unit_id
                && profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === invoice.unit_id);
            if (!ownsUnit) {
                throw new UnauthorizedError('You do not have access to this invoice');
            }
        }

        return await allocationRepository.findPaymentsByInvoiceId(params.id);
    }, {
        response: t.Array(t.Object({
            id: t.String(),
            amount: t.Number(),
            status: t.String(),
            payment_date: t.Any(),
            method: t.String(),
            reference: t.Optional(t.Union([t.String(), t.Null()])),
            allocated_amount: t.Number(),
            allocation_id: t.String(),
            allocated_at: t.Any(),
            user: t.Optional(t.Object({
                id: t.String(),
                name: t.String()
            }))
        })),
        detail: { tags: ['App - Billing'], summary: 'List payments applied to an invoice' }
    });
