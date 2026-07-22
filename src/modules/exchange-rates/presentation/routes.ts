import { Elysia, t } from 'elysia';
import { exchangeRateService } from '@/infrastructure/exchange-rate';
import { requireRole } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';

// ── Schemas ───────────────────────────────────────────────────────────────
const RateSchema = t.Object({
    source: t.String(),
    rate_date: t.String(),
    bs_per_unit: t.Number(),
    source_updated_at: t.Nullable(t.String()),
    fetched_at: t.String(),
    is_manual: t.Boolean(),
});

const RateSetSchema = t.Object({
    rate_date: t.String(),
    rates: t.Object({
        euro_oficial: t.Nullable(RateSchema),
        dolar_oficial: t.Nullable(RateSchema),
        dolar_paralelo: t.Nullable(RateSchema),
    }),
});

const SourceSchema = t.Union([
    t.Literal('euro_oficial'),
    t.Literal('dolar_oficial'),
    t.Literal('dolar_paralelo'),
]);

const todayIso = () => new Date().toISOString().slice(0, 10);

// ── App-facing (any authenticated user): read-only ─────────────────────────
export const exchangeRateAppRoutes = new Elysia()
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD, UserRole.RESIDENT]))
    .get('/exchange-rates', ({ query }) => exchangeRateService.getRatesForDate(query.date ?? todayIso()), {
        query: t.Object({ date: t.Optional(t.String()) }),
        response: RateSetSchema,
        detail: {
            tags: ['App - Exchange Rates'],
            summary: 'Get the 3 Venezuelan rates (euro/dólar oficial, paralelo) for a date',
            security: [{ BearerAuth: [] }],
        },
    })
    .get('/exchange-rates/latest', () => exchangeRateService.getLatest(), {
        response: RateSetSchema,
        detail: {
            tags: ['App - Exchange Rates'],
            summary: "Today's rates",
            security: [{ BearerAuth: [] }],
        },
    });

// ── Admin-facing: force refresh + manual override ──────────────────────────
// Mounted under adminRoutes, which already guards with requireRole([ADMIN, BOARD]).
export const exchangeRateAdminRoutes = new Elysia()
    .post('/exchange-rates/refresh', ({ body }) => exchangeRateService.refresh(body?.date), {
        body: t.Optional(t.Object({ date: t.Optional(t.String()) })),
        response: RateSetSchema,
        detail: {
            tags: ['Admin - Exchange Rates'],
            summary: 'Force a fresh fetch from dolarapi (keeps manual overrides)',
            security: [{ BearerAuth: [] }],
        },
    })
    .put('/exchange-rates/manual', async ({ body }) => {
        await exchangeRateService.setManualRate(body.date, body.source, body.bs_per_unit);
        return exchangeRateService.getRatesForDate(body.date);
    }, {
        body: t.Object({
            date: t.String(),
            source: SourceSchema,
            bs_per_unit: t.Number({ exclusiveMinimum: 0 }),
        }),
        response: RateSetSchema,
        detail: {
            tags: ['Admin - Exchange Rates'],
            summary: 'Manually set a rate for a date/source (overrides the API value)',
            security: [{ BearerAuth: [] }],
        },
    });
