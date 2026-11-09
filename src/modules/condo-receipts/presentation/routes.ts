import { Elysia, t } from 'elysia';
import { requireBuildingAccess, requireRole } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';
import { exchangeRateService } from '@/infrastructure/exchange-rate';
import { SupabaseBuildingRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseBuildingRepository';
import { SupabaseUnitRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseUnitRepository';
import { SupabaseBuildingPaymentInfoRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseBuildingPaymentInfoRepository';
import { SupabaseChargeConceptRepository } from '@/modules/billing/infrastructure/repositories/SupabaseChargeConceptRepository';
import { SupabaseInvoiceRepository } from '@/modules/billing/infrastructure/repositories/SupabaseInvoiceRepository';
import { CondoReceipts } from '../application/CondoReceipts';
import { ExpenseInvoiceStorage, SupabaseCondoReceiptRepository } from '../infrastructure/SupabaseCondoReceiptRepository';

const condoReceipts = new CondoReceipts(new SupabaseCondoReceiptRepository(), new ExpenseInvoiceStorage(), {
    buildingRepo: new SupabaseBuildingRepository(),
    unitRepo: new SupabaseUnitRepository(),
    conceptRepo: new SupabaseChargeConceptRepository(),
    invoiceRepo: new SupabaseInvoiceRepository(),
    paymentInfoRepo: new SupabaseBuildingPaymentInfoRepository(),
    exchangeRates: exchangeRateService,
});

const TAG = 'Admin - Condo Receipts';
const Period = t.String({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$' });
const BuildingParams = t.Object({ buildingId: t.String({ format: 'uuid' }) });
const PeriodParams = t.Object({ buildingId: t.String({ format: 'uuid' }), period: Period });

export const condoReceiptRoutes = new Elysia({ prefix: '/condo-receipts/buildings/:buildingId' })
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
    .use(requireBuildingAccess((ctx) => ctx.params.buildingId, 'condo-receipts-access'))

    // Expense code catalog
    .get('/codes', ({ params }) => condoReceipts.listCodes(params.buildingId), {
        params: BuildingParams,
        detail: { tags: [TAG], summary: 'List the expense codes of a building' },
    })
    .post('/codes', async ({ params, body, set }) => {
        set.status = 201;
        return condoReceipts.createCode(params.buildingId, body.code, body.description);
    }, {
        params: BuildingParams,
        body: t.Object({
            code: t.String({ minLength: 1, maxLength: 20 }),
            description: t.String({ minLength: 1, maxLength: 160 }),
        }),
        detail: { tags: [TAG], summary: 'Add an expense code (e.g. 6.1.2.14 CONSUMO DE AGUA)' },
    })

    .post('/codes/standard', ({ params }) => condoReceipts.loadStandardCodes(params.buildingId), {
        params: BuildingParams,
        detail: { tags: [TAG], summary: 'Load the standard expense catalog (chart of accounts, group 6); existing codes are kept' },
    })

    // Expenses of the month
    .get('/periods/:period/expenses', ({ params }) => condoReceipts.listExpenses(params.buildingId, params.period), {
        params: PeriodParams,
        detail: { tags: [TAG], summary: 'Expenses of a period with signed invoice URLs; `closed` once the receipt exists' },
    })
    .post('/periods/:period/expenses', async ({ params, body, profile, set }) => {
        set.status = 201;
        return condoReceipts.addExpense({
            buildingId: params.buildingId,
            period: params.period,
            codeId: body.code_id,
            detail: body.detail,
            amount: body.amount,
            currency: body.currency,
            expenseDate: body.expense_date,
            file: body.invoice
                ? { name: body.invoice.name, bytes: new Uint8Array(await body.invoice.arrayBuffer()), mime: body.invoice.type }
                : undefined,
            userId: profile.id,
        });
    }, {
        params: PeriodParams,
        type: 'multipart/form-data',
        body: t.Object({
            code_id: t.String({ format: 'uuid' }),
            detail: t.Optional(t.String({ maxLength: 500 })),
            amount: t.Numeric({ exclusiveMinimum: 0 }),
            currency: t.Union([t.Literal('USD'), t.Literal('VES')]),
            expense_date: t.Optional(t.String({ format: 'date' })),
            invoice: t.Optional(t.File({ description: 'Invoice (PDF, PNG, JPG or WEBP, max 10 MB)' })),
        }),
        detail: { tags: [TAG], summary: 'Add an expense of the month with its invoice' },
    })
    .delete('/expenses/:expenseId', async ({ params, set }) => {
        await condoReceipts.deleteExpense(params.buildingId, params.expenseId);
        set.status = 204;
    }, {
        params: t.Object({ buildingId: t.String({ format: 'uuid' }), expenseId: t.String({ format: 'uuid' }) }),
        detail: { tags: [TAG], summary: 'Delete an expense of an open period' },
    })

    // Receipts
    .get('/receipts', ({ params }) => condoReceipts.listReceipts(params.buildingId), {
        params: BuildingParams,
        detail: { tags: [TAG], summary: 'Generated receipts of a building (newest first)' },
    })
    .get('/receipts/:period', ({ params }) => condoReceipts.getReceipt(params.buildingId, params.period), {
        params: PeriodParams,
        detail: { tags: [TAG], summary: 'Receipt of a period: lines and per-unit totals' },
    })
    .post('/receipts/:period', async ({ params, body, profile, set }) => {
        set.status = 201;
        return condoReceipts.generate({
            buildingId: params.buildingId,
            period: params.period,
            reservePercent: body.reserve_percent ?? 10,
            rateDate: body.rate_date,
            dueDate: body.due_date ? new Date(body.due_date) : undefined,
            userId: profile.id,
        });
    }, {
        params: PeriodParams,
        body: t.Object({
            reserve_percent: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
            rate_date: t.Optional(t.String({ format: 'date' })),
            due_date: t.Optional(t.String({ format: 'date' })),
        }),
        detail: { tags: [TAG], summary: "Generate the period's receipt and bill every unit by aliquot; closes the period" },
    })
    .delete('/receipts/:period', async ({ params, set }) => {
        await condoReceipts.void(params.buildingId, params.period);
        set.status = 204;
    }, {
        params: PeriodParams,
        detail: { tags: [TAG], summary: 'Void a receipt without payments: cancels its invoices and reopens the period' },
    })
    .get('/receipts/:period/units/:unitId', ({ params }) =>
        condoReceipts.getUnitReceipt(params.buildingId, params.period, params.unitId), {
        params: t.Object({ buildingId: t.String({ format: 'uuid' }), period: Period, unitId: t.String({ format: 'uuid' }) }),
        detail: { tags: [TAG], summary: 'Printable notice of one unit (aviso de cobro)' },
    });
