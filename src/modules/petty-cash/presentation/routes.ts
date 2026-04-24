import { Elysia, t } from 'elysia';
import { SupabasePettyCashRepository } from '../infrastructure/repositories/SupabasePettyCashRepository';
import { GetPettyCashBalance } from '../application/use-cases/GetPettyCashBalance';
import { GetPettyCashHistory } from '../application/use-cases/GetPettyCashHistory';
import { RegisterPettyCashIncome } from '../application/use-cases/RegisterPettyCashIncome';
import { RegisterPettyCashExpense } from '../application/use-cases/RegisterPettyCashExpense';
import { SupabaseInvoiceRepository } from '@/modules/billing/infrastructure/repositories/SupabaseInvoiceRepository';
import { SupabaseUnitRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseUnitRepository';
import { StorageService } from '@/infrastructure/storage';
import {
    UserRole,
    PettyCashCategory,
    PettyCashEntryType,
} from '@/core/domain/enums';
import { requireRole, requireBuildingAccess } from '@/core/presentation/guards';
import { PreviewAssessments } from '../application/use-cases/PreviewAssessments';
import { GenerateAssessments } from '../application/use-cases/GenerateAssessments';
import { GetPettyCashTransparency } from '../application/use-cases/GetPettyCashTransparency';
import { ReversePettyCashEntry } from '../application/use-cases/ReversePettyCashEntry';

// ── DI ──────────────────────────────────────────────────────────────────────
const pettyCashRepo = new SupabasePettyCashRepository();
const storageService = new StorageService();
const invoiceRepo = new SupabaseInvoiceRepository();
const unitRepo = new SupabaseUnitRepository();

const getBalance = new GetPettyCashBalance(pettyCashRepo);
const getHistory = new GetPettyCashHistory(pettyCashRepo);
const registerIncome = new RegisterPettyCashIncome(pettyCashRepo);
const registerExpense = new RegisterPettyCashExpense(pettyCashRepo);
const previewAssessments = new PreviewAssessments(invoiceRepo, unitRepo, pettyCashRepo);
const generateAssessments = new GenerateAssessments(invoiceRepo, unitRepo, pettyCashRepo);
const getTransparency = new GetPettyCashTransparency(invoiceRepo, unitRepo, pettyCashRepo);
const reverseEntry = new ReversePettyCashEntry(pettyCashRepo);

// ── Schemas ─────────────────────────────────────────────────────────────────

const PettyCashFundSchema = t.Object({
    id: t.String(),
    building_id: t.String(),
    current_balance: t.Number(),
    updated_at: t.Any(),
});

const PettyCashEntrySchema = t.Object({
    id: t.Optional(t.String()),
    fund_id: t.String(),
    type: t.Union([
        t.Literal(PettyCashEntryType.INCOME),
        t.Literal(PettyCashEntryType.EXPENSE),
        t.Literal(PettyCashEntryType.COLLECTION),
        t.Literal(PettyCashEntryType.REVERSAL),
    ]),
    amount: t.Number(),
    category: t.Optional(t.Nullable(t.String())),
    description: t.String(),
    evidence_url: t.Optional(t.Nullable(t.String())),
    reference_type: t.Optional(t.Nullable(t.String())),
    reference_id: t.Optional(t.Nullable(t.String())),
    created_by: t.String(),
    created_at: t.Optional(t.Nullable(t.Any())),
});

const AssessmentUnitSchema = t.Object({
    id: t.String(),
    name: t.String(),
    amount: t.Number(),
});

const AssessmentPreviewSchema = t.Object({
    building_id: t.String(),
    current_balance: t.Number(),
    total_overage: t.Number(),
    already_assessed: t.Number(),
    pending_to_assess: t.Number(),
    units: t.Array(AssessmentUnitSchema),
});

const AssessmentInvoiceSchema = t.Object({
    unit_id: t.String(),
    unit_name: t.String(),
    amount: t.Number(),
    invoice_id: t.String(),
});

const AssessmentResultSchema = t.Object({
    building_id: t.String(),
    assessment_id: t.String(),
    description: t.String(),
    total_assessed: t.Number(),
    invoices_created: t.Number(),
    invoices: t.Array(AssessmentInvoiceSchema),
});

const TransparencyUnitSchema = t.Object({
    unit_id: t.String(),
    unit_name: t.String(),
    expected_amount: t.Number(),
    covered_amount: t.Number(),
    status: t.Union([
        t.Literal('PENDING'),
        t.Literal('PARTIAL'),
        t.Literal('PAID'),
    ]),
});

const AssessmentTransparencySchema = t.Object({
    id: t.String(),
    description: t.String(),
    category: t.Optional(t.Nullable(t.String())),
    total_to_collect: t.Number(),
    total_collected: t.Number(),
    collection_percentage: t.Number(),
    units: t.Array(TransparencyUnitSchema),
});

const TransparencySchema = t.Object({
    building_id: t.String(),
    period: t.String(),
    assessments: t.Array(AssessmentTransparencySchema),
    total_to_collect: t.Number(),
    total_collected: t.Number(),
    collection_percentage: t.Number(),
});

const PaginationMetadataSchema = t.Object({
    total: t.Number(),
    page: t.Number(),
    limit: t.Number(),
    total_pages: t.Number(),
    has_next_page: t.Boolean(),
    has_prev_page: t.Boolean(),
});

const PaginatedPettyCashEntrySchema = t.Object({
    data: t.Array(PettyCashEntrySchema),
    metadata: PaginationMetadataSchema,
});

// ── Routes ──────────────────────────────────────────────────────────────────

function createReadRoutes(tag: string) {
    return new Elysia()
        .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
        .use(requireBuildingAccess((ctx) => ctx.params.buildingId, 'petty-cash-read-access'))
        .get('/funds/:buildingId', async ({ params }) => {
            return await getBalance.execute(params.buildingId);
        }, {
            response: PettyCashFundSchema,
            detail: { tags: [tag], summary: 'Get fund balance for a building' },
        })
        .get('/funds/:buildingId/entries', async ({ params, query }) => {
            const result = await getHistory.execute(params.buildingId, {
                type: query.type as PettyCashEntryType,
                category: query.category as PettyCashCategory,
                page: query.page,
                limit: query.limit,
            });
            return result as any;
        }, {
            query: t.Object({
                type: t.Optional(t.String()),
                category: t.Optional(t.String()),
                page: t.Optional(t.Numeric()),
                limit: t.Optional(t.Union([t.Numeric(), t.Literal('all')])),
            }),
            response: PaginatedPettyCashEntrySchema,
            detail: { tags: [tag], summary: 'List ledger entries for a building fund' },
        })
        .get('/funds/:buildingId/transparency', async ({ params, query }) => {
            return await getTransparency.execute(params.buildingId, query.period);
        }, {
            query: t.Object({
                period: t.String({ minLength: 1, description: 'Period to report (e.g. "2026-04")' }),
            }),
            response: TransparencySchema,
            detail: {
                tags: [tag],
                summary: 'Per-assessment transparency of petty cash replenishment',
                description:
                    'Breaks collection progress down by assessment batch (ascensor, agua, ...). ' +
                    'CANCELLED invoices excluded. covered_amount capped per-invoice at expected.',
            },
        });
}

function createWriteRoutes() {
    return new Elysia()
        .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
        .use(requireBuildingAccess((ctx) => ctx.params.buildingId, 'petty-cash-write-access'))
        .post('/funds/:buildingId/entries', async ({ params, body, profile }) => {
            const buildingId = params.buildingId;
            const amount = typeof body.amount === 'string'
                ? parseFloat(body.amount)
                : body.amount;

            if (body.type === PettyCashEntryType.INCOME) {
                return await registerIncome.execute({
                    buildingId,
                    amount,
                    description: body.description,
                    userId: profile.id,
                });
            }

            // EXPENSE — category is required at the business level;
            // we default to OTHER if the client forgets it, same as
            // the legacy endpoint did.
            let evidenceUrl: string | undefined;
            if (body.evidence_image) {
                evidenceUrl = await storageService.uploadProof(
                    body.evidence_image,
                    profile.id
                );
            }

            return await registerExpense.execute({
                buildingId,
                amount,
                description: body.description,
                category: (body.category ?? PettyCashCategory.OTHER) as PettyCashCategory,
                userId: profile.id,
                evidenceUrl,
            });
        }, {
            body: t.Object({
                type: t.Union([
                    t.Literal(PettyCashEntryType.INCOME),
                    t.Literal(PettyCashEntryType.EXPENSE),
                ]),
                amount: t.Union([t.Number(), t.String()]),
                description: t.String(),
                category: t.Optional(t.String()),
                evidence_image: t.Optional(t.File()),
            }),
            type: 'multipart/form-data',
            response: PettyCashEntrySchema,
            detail: {
                tags: ['Admin - Petty Cash'],
                summary: 'Create a ledger entry (income or expense)',
                description:
                    'INCOME: board replenishes the fund. EXPENSE: board records a spend — ' +
                    'the ledger balance may go negative (overdraft); the next assessment ' +
                    'collects that overdraft from units. Auto-collection entries are NOT ' +
                    'created here — they fire from ApprovePayment when a resident pays.',
            },
        })
        .post('/funds/:buildingId/entries/:entryId/reverse', async ({ params, body, profile }) => {
            return await reverseEntry.execute({
                entryId: params.entryId,
                reason: body.reason,
                userId: profile.id,
                buildingId: params.buildingId,
            });
        }, {
            body: t.Object({
                reason: t.String({
                    minLength: 10,
                    maxLength: 500,
                    description: 'Human-readable explanation of why this entry is being reversed. Stored in the counter-asiento description.',
                }),
            }),
            response: PettyCashEntrySchema,
            detail: {
                tags: ['Admin - Petty Cash'],
                summary: 'Reverse a ledger entry (counter-asiento)',
                description:
                    'Creates a new REVERSAL entry with amount = -original.amount. Original entry is NEVER mutated (append-only). Idempotent: returns the existing reversal if called twice. Cannot reverse an entry whose type is already REVERSAL.',
            },
        });
}

function createAssessmentRoutes() {
    return new Elysia()
        .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
        .use(requireBuildingAccess((ctx) => ctx.params.buildingId, 'petty-cash-assessment-access'))
        .get('/funds/:buildingId/assessments', async ({ params }) => {
            return await previewAssessments.execute(params.buildingId);
        }, {
            response: AssessmentPreviewSchema,
            detail: {
                tags: ['Admin - Petty Cash'],
                summary: 'Preview the remaining overage that can be prorated to units',
                description:
                    'Does NOT create invoices. total_overage = max(0, -current_balance). ' +
                    'already_assessed excludes CANCELLED invoices.',
            },
        })
        .post('/funds/:buildingId/assessments', async ({ params, body, profile }) => {
            const amount = typeof body.amount === 'string'
                ? parseFloat(body.amount)
                : body.amount;
            return await generateAssessments.execute({
                buildingId: params.buildingId,
                description: body.description,
                category: body.category as PettyCashCategory | undefined,
                amount,
                userId: profile.id,
            });
        }, {
            body: t.Object({
                description: t.String({
                    minLength: 1,
                    description: 'Name of this assessment batch (e.g. "Ascensor abril"). Shown on each invoice.',
                }),
                category: t.Optional(t.String({
                    description: 'Optional PettyCashCategory value for dashboards (REPAIR, UTILITIES, …).',
                })),
                amount: t.Union([t.Number(), t.String()], {
                    description: 'Total amount to prorate across units in this batch.',
                }),
            }),
            response: AssessmentResultSchema,
            detail: {
                tags: ['Admin - Petty Cash'],
                summary: 'Generate a named assessment batch (PENDING invoices per unit)',
                description:
                    'Creates a petty_cash_assessment row + one PENDING invoice per unit with ' +
                    'assessment_id linking back. Multiple batches per period are expected ' +
                    '(ascensor, agua, …) — each shows its own progress in transparency.',
            },
        });
}

// ── Exports ─────────────────────────────────────────────────────────────────

export const pettyCashAppRoutes = new Elysia({ prefix: '/petty-cash' })
    .use(createReadRoutes('App - Petty Cash'));

export const pettyCashRoutes = new Elysia({ prefix: '/petty-cash' })
    .use(createReadRoutes('Admin - Petty Cash'))
    .use(createWriteRoutes())
    .use(createAssessmentRoutes());
