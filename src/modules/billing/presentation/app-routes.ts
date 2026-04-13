/**
 * Billing App Routes — APK (Residents)
 * Read-only: invoices, balance, credit for own unit.
 */

import { Elysia, t } from 'elysia';
import { SupabaseInvoiceRepository } from '../infrastructure/repositories/SupabaseInvoiceRepository';
import { SupabaseCreditLedgerRepository } from '../infrastructure/repositories/SupabaseCreditLedgerRepository';
import { GetUnitBalance } from '../application/use-cases/GetUnitBalance';
import { GetUnitInvoices } from '../application/use-cases/GetUnitInvoices';
import { GetUnitCredit } from '../application/use-cases/GetUnitCredit';
import { UnauthorizedError } from '@/core/errors';
import { supabase, supabaseAdmin } from '@/infrastructure/supabase';
import { UserRole, InvoiceTag } from '@/core/domain/enums';

const invoiceRepository = new SupabaseInvoiceRepository();
const creditLedgerRepository = new SupabaseCreditLedgerRepository();

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
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id, email, name, role, status, profile_units(unit_id)')
            .eq('id', user.id)
            .single();
        if (!profile) throw new UnauthorizedError('Profile not found');
        return { user, profile };
    })
    .get('/units/:id/balance', async ({ params, profile }) => {
        if (profile.role === UserRole.RESIDENT) {
            const hasAccess = profile.profile_units?.some((u: { unit_id: string }) => u.unit_id === params.id);
            if (!hasAccess) throw new UnauthorizedError('Unauthorized');
        }
        return await getUnitBalance.execute(params.id);
    }, {
        response: BalanceSchema,
        detail: { tags: ['App - Billing'], summary: 'Get unit balance and pending invoices' }
    })
    .get('/units/:id/invoices', async ({ params, query, profile }) => {
        if (profile.role === UserRole.RESIDENT) {
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
        if (profile.role === UserRole.RESIDENT) {
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
    });
