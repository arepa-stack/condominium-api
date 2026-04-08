import { Elysia, t } from 'elysia';
import { SupabasePettyCashRepository } from '../infrastructure/repositories/SupabasePettyCashRepository';
import { GetPettyCashBalance } from '../application/use-cases/GetPettyCashBalance';
import { GetPettyCashHistory } from '../application/use-cases/GetPettyCashHistory';
import { RegisterPettyCashIncome } from '../application/use-cases/RegisterPettyCashIncome';
import { RegisterPettyCashExpense } from '../application/use-cases/RegisterPettyCashExpense';
import { SupabaseInvoiceRepository } from '@/modules/billing/infrastructure/repositories/SupabaseInvoiceRepository';
import { SupabaseUnitRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseUnitRepository';
import { StorageService } from '@/infrastructure/storage';
import { UserRole, PettyCashTransactionType, PettyCashCategory } from '@/core/domain/enums';
import { requireRole, requireBuildingAccess } from '@/core/presentation/guards';
import { PreviewAssessments } from '../application/use-cases/PreviewAssessments';
import { GenerateAssessments } from '../application/use-cases/GenerateAssessments';

// Initialize repo and use cases
const pettyCashRepo = new SupabasePettyCashRepository();
const storageService = new StorageService();
const invoiceRepo = new SupabaseInvoiceRepository();
const unitRepo = new SupabaseUnitRepository();

const getBalance = new GetPettyCashBalance(pettyCashRepo);
const getHistory = new GetPettyCashHistory(pettyCashRepo);
const registerIncome = new RegisterPettyCashIncome(pettyCashRepo);
const registerExpense = new RegisterPettyCashExpense(pettyCashRepo, invoiceRepo);
const previewAssessments = new PreviewAssessments(invoiceRepo, unitRepo, pettyCashRepo);
const generateAssessments = new GenerateAssessments(invoiceRepo, unitRepo, pettyCashRepo);

// ── Schemas ─────────────────────────────────────────────────────────────────

const PettyCashFundSchema = t.Object({
    id: t.String(),
    building_id: t.String(),
    current_balance: t.Number(),
    currency: t.String(),
    updated_at: t.Any()
});

const PettyCashTransactionSchema = t.Object({
    id: t.String(),
    fund_id: t.String(),
    type: t.String(),
    amount: t.Number(),
    description: t.String(),
    category: t.String(),
    created_by: t.String(),
    evidence_url: t.Optional(t.Nullable(t.String())),
    created_at: t.Optional(t.Nullable(t.Any()))
});

const AssessmentUnitSchema = t.Object({
    id: t.String(),
    name: t.String(),
    amount: t.Number()
});

const AssessmentPreviewSchema = t.Object({
    building_id: t.String(),
    total_expenses: t.Number(),
    total_income: t.Number(),
    fund_balance: t.Number(),
    total_overage: t.Number(),
    already_assessed: t.Number(),
    pending_to_assess: t.Number(),
    units: t.Array(AssessmentUnitSchema)
});

const AssessmentInvoiceSchema = t.Object({
    unit_id: t.String(),
    unit_name: t.String(),
    amount: t.Number(),
    invoice_id: t.String()
});

const AssessmentResultSchema = t.Object({
    building_id: t.String(),
    total_assessed: t.Number(),
    invoices_created: t.Number(),
    invoices: t.Array(AssessmentInvoiceSchema)
});

// ── Route factories (fresh instance each call — prevents Swagger duplicates) ─

function createReadRoutes(tag: string) {
    return new Elysia()
        .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
        .use(requireBuildingAccess((ctx) => ctx.params.buildingId, 'petty-cash-read-access'))
        .get('/funds/:buildingId', async ({ params }) => {
            return await getBalance.execute(params.buildingId);
        }, {
            response: PettyCashFundSchema,
            detail: {
                tags: [tag],
                summary: 'Get fund balance for a building'
            }
        })
        .get('/funds/:buildingId/transactions', async ({ params, query }) => {
            return await getHistory.execute(params.buildingId, {
                type: query.type as PettyCashTransactionType,
                category: query.category as PettyCashCategory,
                page: query.page ? Number(query.page) : 1,
                limit: query.limit ? Number(query.limit) : 10
            });
        }, {
            query: t.Object({
                type: t.Optional(t.String()),
                category: t.Optional(t.String()),
                page: t.Optional(t.Numeric()),
                limit: t.Optional(t.Numeric())
            }),
            response: t.Array(PettyCashTransactionSchema),
            detail: {
                tags: [tag],
                summary: 'List transactions for a building fund'
            }
        });
}

function createWriteRoutes() {
    return new Elysia()
        .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
        .use(requireBuildingAccess((ctx) => ctx.params.buildingId, 'petty-cash-write-access'))
        .post('/funds/:buildingId/transactions', async ({ params, body, profile }) => {
            const buildingId = params.buildingId;
            const amount = typeof body.amount === 'string' ? parseFloat(body.amount) : body.amount;

            if (body.type === PettyCashTransactionType.INCOME) {
                return await registerIncome.execute({
                    buildingId,
                    amount,
                    description: body.description,
                    userId: profile.id
                });
            }

            // EXPENSE
            let evidenceUrl: string | undefined;
            if (body.evidence_image) {
                evidenceUrl = await storageService.uploadProof(body.evidence_image, profile.id);
            }

            return await registerExpense.execute({
                buildingId,
                amount,
                description: body.description,
                category: (body.category ?? PettyCashCategory.OTHER) as PettyCashCategory,
                userId: profile.id,
                evidenceUrl
            });
        }, {
            body: t.Object({
                type: t.Union([
                    t.Literal(PettyCashTransactionType.INCOME),
                    t.Literal(PettyCashTransactionType.EXPENSE)
                ]),
                amount: t.Union([t.Number(), t.String()]),
                description: t.String(),
                category: t.Optional(t.String()),
                evidence_image: t.Optional(t.File())
            }),
            type: 'multipart/form-data',
            response: PettyCashTransactionSchema,
            detail: {
                tags: ['Admin - Petty Cash'],
                summary: 'Create a transaction (income or expense)',
                description: 'Type INCOME creates a fund replenishment. Type EXPENSE creates a fund deduction and generates a PETTY_CASH invoice. Category and evidence_image only apply to EXPENSE.'
            }
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
                summary: 'Preview overage assessment for units',
                description: 'Shows how the accumulated petty cash overage would be split across building units. No invoices are created.'
            }
        })
        .post('/funds/:buildingId/assessments', async ({ params }) => {
            return await generateAssessments.execute(params.buildingId);
        }, {
            response: AssessmentResultSchema,
            detail: {
                tags: ['Admin - Petty Cash'],
                summary: 'Generate overage assessment invoices',
                description: 'Creates PENDING invoices for each unit in the building, splitting the accumulated petty cash overage equally. Returns 400 if no pending overage exists.'
            }
        });
}

// ── Exports ─────────────────────────────────────────────────────────────────

// App routes (APK — read only)
export const pettyCashAppRoutes = new Elysia({ prefix: '/petty-cash' })
    .use(createReadRoutes('App - Petty Cash'));

// Admin routes (Web Admin — read + write + assessments)
export const pettyCashRoutes = new Elysia({ prefix: '/petty-cash' })
    .use(createReadRoutes('Admin - Petty Cash'))
    .use(createWriteRoutes())
    .use(createAssessmentRoutes());
