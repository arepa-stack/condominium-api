import { Elysia, t } from 'elysia';
import { SupabasePettyCashRepository } from '../infrastructure/repositories/SupabasePettyCashRepository';
import { GetPettyCashBalance } from '../application/use-cases/GetPettyCashBalance';
import { GetPettyCashHistory } from '../application/use-cases/GetPettyCashHistory';
import { RegisterPettyCashIncome } from '../application/use-cases/RegisterPettyCashIncome';
import { RegisterPettyCashExpense } from '../application/use-cases/RegisterPettyCashExpense';
import { SupabaseInvoiceRepository } from '@/modules/billing/infrastructure/repositories/SupabaseInvoiceRepository';
import { SupabaseUnitRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseUnitRepository';
import { SupabaseBuildingRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseBuildingRepository';
import { SupabasePaymentRepository } from '@/modules/payments/infrastructure/repositories/SupabasePaymentRepository';
import { SupabasePaymentAllocationRepository } from '@/modules/billing/infrastructure/repositories/SupabasePaymentAllocationRepository';
import { SupabaseCreditLedgerRepository } from '@/modules/billing/infrastructure/repositories/SupabaseCreditLedgerRepository';
import { SupabaseUserRepository } from '@/modules/users/infrastructure/repositories/SupabaseUserRepository';
import { exchangeRateService } from '@/infrastructure/exchange-rate';
import { StorageService } from '@/infrastructure/storage';
import {
    UserRole,
    PettyCashCategory,
    PettyCashEntryType,
} from '@/core/domain/enums';
import { requireRole, requireBuildingAccess } from '@/core/presentation/guards';
import { DomainError } from '@/core/errors';
import { PreviewAssessments } from '../application/use-cases/PreviewAssessments';
import { GenerateAssessments } from '../application/use-cases/GenerateAssessments';
import { GetPettyCashTransparency } from '../application/use-cases/GetPettyCashTransparency';
import { ReversePettyCashEntry } from '../application/use-cases/ReversePettyCashEntry';
import { SetTargetFund } from '../application/use-cases/SetTargetFund';
import { CancelExpressAssessment } from '../application/use-cases/CancelExpressAssessment';
import { RegisterPettyCashContribution } from '../application/use-cases/RegisterPettyCashContribution';
import { RegisterPayment } from '@/modules/payments/application/use-cases/RegisterPayment';
import { ApprovePayment } from '@/modules/payments/application/use-cases/ApprovePayment';
import { ProcessInvoiceOverpayment } from '@/modules/billing/application/use-cases/ProcessInvoiceOverpayment';

// ── DI ──────────────────────────────────────────────────────────────────────
const pettyCashRepo = new SupabasePettyCashRepository();
const storageService = new StorageService();
const invoiceRepo = new SupabaseInvoiceRepository();
const unitRepo = new SupabaseUnitRepository();
const buildingRepo = new SupabaseBuildingRepository();
const paymentRepo = new SupabasePaymentRepository();
const allocationRepo = new SupabasePaymentAllocationRepository();
const creditLedgerRepo = new SupabaseCreditLedgerRepository();
const userRepo = new SupabaseUserRepository();

const processOverpayment = new ProcessInvoiceOverpayment(invoiceRepo, creditLedgerRepo);
const registerPaymentUseCase = new RegisterPayment(paymentRepo, allocationRepo, buildingRepo, exchangeRateService);
const approvePaymentUseCase = new ApprovePayment(
    paymentRepo,
    userRepo,
    allocationRepo,
    processOverpayment,
    invoiceRepo,
    pettyCashRepo
);

const setTargetFund = new SetTargetFund(pettyCashRepo);
const cancelExpressAssessment = new CancelExpressAssessment(invoiceRepo, pettyCashRepo);
const getBalance = new GetPettyCashBalance(pettyCashRepo);
const getHistory = new GetPettyCashHistory(pettyCashRepo);
const registerIncome = new RegisterPettyCashIncome(pettyCashRepo, buildingRepo, exchangeRateService);
const registerExpense = new RegisterPettyCashExpense(pettyCashRepo, buildingRepo, exchangeRateService, invoiceRepo);
const previewAssessments = new PreviewAssessments(invoiceRepo, unitRepo, pettyCashRepo);
const generateAssessments = new GenerateAssessments(invoiceRepo, unitRepo, pettyCashRepo);
const getTransparency = new GetPettyCashTransparency(invoiceRepo, unitRepo, pettyCashRepo);
const reverseEntry = new ReversePettyCashEntry(pettyCashRepo);
const registerContribution = new RegisterPettyCashContribution(
    pettyCashRepo,
    invoiceRepo,
    unitRepo,
    registerPaymentUseCase,
    approvePaymentUseCase,
    paymentRepo
);

// ── Schemas ─────────────────────────────────────────────────────────────────

const PettyCashFundSchema = t.Object({
    id: t.String(),
    building_id: t.String(),
    current_balance: t.Number(),
    // "En físico (USD) hay X, en bolívares hay Y" — net per currency held.
    balances_by_currency: t.Optional(t.Array(t.Object({
        currency: t.String(),
        balance: t.Number(),
    }))),
    updated_at: t.Any(),
});

const PettyCashCoverageSchema = t.Object({
    pending_to_assess: t.Number(),
    balance: t.Number(),
    target_fund: t.Number(),
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
    original_currency: t.Optional(t.String()),
    original_amount: t.Optional(t.Nullable(t.Number())),
    exchange_rate: t.Optional(t.Nullable(t.Number())),
    rate_source: t.Optional(t.Nullable(t.String())),
    rate_date: t.Optional(t.Nullable(t.String())),
    category: t.Optional(t.Nullable(t.String())),
    description: t.String(),
    evidence_url: t.Optional(t.Nullable(t.String())),
    reference_type: t.Optional(t.Nullable(t.String())),
    reference_id: t.Optional(t.Nullable(t.String())),
    created_by: t.String(),
    created_at: t.Optional(t.Nullable(t.Any())),
    /**
     * True when another REVERSAL entry points at this entry's id.
     * Populated by GetPettyCashHistory; absent on single-entry responses
     * (income/expense POST, reverse POST) which return the raw entry.
     */
    is_reversed: t.Optional(t.Boolean()),
    /**
     * Optional coverage data included on EXPENSE responses
     * when coverage deps are wired. Absent for INCOME entries.
     */
    coverage: t.Optional(PettyCashCoverageSchema),
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
    /**
     * Target replenishment fund amount. Defaults to 0 when not configured.
     */
    target_fund: t.Optional(t.Number()),
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
    kind: t.Union([t.Literal('GENERAL'), t.Literal('EXPRESS'), t.Literal('CONTRIBUTION')]),
    source_entry_id: t.Nullable(t.String()),
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
    /**
     * Assessment kind. Present only when a real assessment row exists.
     * Absent for legacy/orphan batches.
     */
    kind: t.Optional(t.Union([t.Literal('GENERAL'), t.Literal('EXPRESS'), t.Literal('CONTRIBUTION')])),
    /** For EXPRESS assessments, the expense entry id. Absent for legacy. */
    source_entry_id: t.Optional(t.Nullable(t.String())),
});

const TransparencySchema = t.Object({
    building_id: t.String(),
    period: t.String(),
    assessments: t.Array(AssessmentTransparencySchema),
    total_to_collect: t.Number(),
    total_collected: t.Number(),
    collection_percentage: t.Number(),
});

const ContributionInvoiceSchema = t.Object({
    id: t.String(),
    unit_id: t.Optional(t.Nullable(t.String())),
    building_id: t.Optional(t.Nullable(t.String())),
    amount: t.Number(),
    period: t.String(),
    issue_date: t.Any(),
    due_date: t.Optional(t.Any()),
    status: t.String(),
    type: t.String(),
    tag: t.Optional(t.String()),
    description: t.Optional(t.Nullable(t.String())),
    receipt_number: t.Optional(t.Nullable(t.String())),
    paid_amount: t.Optional(t.Number()),
    assessment_id: t.Optional(t.Nullable(t.String())),
    created_at: t.Optional(t.Any()),
    updated_at: t.Optional(t.Any()),
});

const ContributionCoverageSchema = t.Object({
    pending_to_assess: t.Number(),
    balance: t.Number(),
    target_fund: t.Number(),
});

const ContributionResultSchema = t.Object({
    invoice: ContributionInvoiceSchema,
    fund_balance: t.Number(),
    coverage: ContributionCoverageSchema,
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

function createFundManagementRoutes() {
    return new Elysia()
        .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
        .use(requireBuildingAccess((ctx) => ctx.params.buildingId, 'petty-cash-fund-management'))
        .put('/funds/:buildingId/target-fund', async ({ params, body }) => {
            const targetFund = typeof body.target_fund === 'string'
                ? parseFloat(body.target_fund)
                : body.target_fund;
            return await setTargetFund.execute({
                buildingId: params.buildingId,
                targetFund,
            });
        }, {
            body: t.Object({
                target_fund: t.Union([t.Number(), t.String()], {
                    description: 'Target replenishment fund amount. Must be >= 0. Zero resets to overage-only mode.',
                }),
            }),
            response: t.Object({
                building_id: t.String(),
                target_fund: t.Number(),
            }),
            detail: {
                tags: ['Admin - Petty Cash'],
                summary: 'Set the target replenishment fund for a building',
                description:
                    'Sets the minimum fund balance the board wants to maintain. ' +
                    'pending_to_assess in the preview will include top-up amounts needed ' +
                    'to reach this target. Zero resets to cover-the-overdraft mode. ' +
                    'Cold-start safe: creates the fund row if it does not exist.',
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
                    currency: body.currency,
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
                currency: body.currency,
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
                currency: t.Optional(t.Union([t.Literal('USD'), t.Literal('VES')], {
                    default: 'USD',
                    description: "Currency the money moved in. 'VES' converts to the building's base unit at the day's rate; 'USD' (default) is physical dollars, taken as-is.",
                })),
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
        .post('/funds/:buildingId/contributions', async ({ params, body, profile }) => {
            const buildingId = params.buildingId;
            const amount = typeof body.amount === 'string'
                ? parseFloat(body.amount)
                : body.amount;

            // Upload proof before creating any domain objects.
            if (!body.proof_image) {
                throw new DomainError('proof_image is required for direct contributions', 'MISSING_PROOF', 400);
            }
            const proofUrl = await storageService.uploadPaymentProof(body.proof_image, profile.id);

            return await registerContribution.execute({
                buildingId,
                unitId: body.unit_id,
                amount,
                currency: body.currency,
                proofUrl,
                description: body.description,
                userId: profile.id,
            });
        }, {
            body: t.Object({
                unit_id: t.String({ minLength: 1, description: 'Unit UUID that is making the contribution.' }),
                amount: t.Union([t.Number(), t.String()], {
                    description: 'Contribution amount in the specified currency. Must be > 0.',
                }),
                currency: t.Optional(t.Union([t.Literal('USD'), t.Literal('VES')], {
                    default: 'USD',
                    description: "Currency. 'USD' (default) for physical dollars; 'VES' converts at the building's rate.",
                })),
                description: t.Optional(t.String({
                    description: 'Override the default description. Defaults to "Aporte caja chica — YYYY-MM". Empty string rejected.',
                })),
                proof_image: t.File({ description: 'Required proof image for the contribution payment.' }),
            }),
            type: 'multipart/form-data',
            response: ContributionResultSchema,
            detail: {
                tags: ['Admin - Petty Cash'],
                summary: 'Register a direct contribution to petty cash from a unit',
                description:
                    'Payment-first direct contribution: creates a CONTRIBUTION-kind assessment, one ' +
                    'PETTY_CASH invoice for the unit, registers a proofed payment allocated to it, ' +
                    'and auto-approves so the fund COLLECTION is emitted immediately. ' +
                    'Compensation: on payment failure the invoice is cancelled. ' +
                    'Returns the invoice, post-collection fund_balance, and coverage.',
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
        .post('/funds/:buildingId/assessments/:assessmentId/cancel', async ({ params, body }) => {
            return await cancelExpressAssessment.execute({
                assessmentId: params.assessmentId,
                reason: body.reason,
                buildingId: params.buildingId,
            });
        }, {
            body: t.Object({
                reason: t.String({
                    minLength: 10,
                    maxLength: 500,
                    description: 'Reason for cancelling this EXPRESS assessment (min 10 chars). Appended to each cancelled invoice description.',
                }),
            }),
            response: t.Object({
                assessment_id: t.String(),
                cancelled_invoices: t.Number(),
                total_remainder_returned: t.Number(),
            }),
            detail: {
                tags: ['Admin - Petty Cash'],
                summary: 'Cancel all active invoices of an EXPRESS assessment',
                description:
                    'Cancels all PENDING and PARTIAL invoices linked to an EXPRESS assessment ' +
                    'and appends the reason to each invoice description. PAID invoices are not ' +
                    'affected. Returns the count of cancelled invoices and total remainder returned. ' +
                    'Security: buildingId in path is required so requireBuildingAccess applies.',
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
                unitIds: Array.isArray(body.unit_ids) ? body.unit_ids : undefined,
                kind: body.kind as 'GENERAL' | 'EXPRESS' | undefined,
                source_entry_id: body.source_entry_id,
                unit_amounts: body.unit_amounts as Record<string, number> | undefined,
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
                unit_ids: t.Optional(t.Array(t.String({ minLength: 1 }), {
                    minItems: 1,
                    uniqueItems: true,
                    description: 'Optional list of unit IDs that should receive invoices in this batch. Omit it to target every unit.',
                })),
                kind: t.Optional(t.Union([t.Literal('GENERAL'), t.Literal('EXPRESS')], {
                    description: "Assessment kind. 'GENERAL' (default) — normal proration. 'EXPRESS' — rapid one-shot linked to a specific expense entry.",
                })),
                source_entry_id: t.Optional(t.String({
                    description: 'Required for EXPRESS: the petty_cash_entries.id of the expense that originated this assessment.',
                })),
                unit_amounts: t.Optional(t.Record(t.String(), t.Number(), {
                    description: 'EXPRESS only: per-unit amount override. Keys = unit IDs, values > 0, sum must equal amount.',
                })),
            }),
            response: AssessmentResultSchema,
            detail: {
                tags: ['Admin - Petty Cash'],
                summary: 'Generate a named assessment batch (PENDING invoices per unit)',
                description:
                    'Creates a petty_cash_assessment row + one PENDING invoice per selected unit with ' +
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
    .use(createFundManagementRoutes())
    .use(createWriteRoutes())
    .use(createAssessmentRoutes());
