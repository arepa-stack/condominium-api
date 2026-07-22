import { Elysia, t } from 'elysia';
import { UserRole } from '@/core/domain/enums';
import { requireRole } from '@/core/presentation/guards';
import { DomainError } from '@/core/errors';

// ── Repositories ─────────────────────────────────────────────────────────────
import { SupabaseDecisionRepository } from '../infrastructure/repositories/SupabaseDecisionRepository';
import { SupabaseQuoteRepository } from '../infrastructure/repositories/SupabaseQuoteRepository';
import { SupabaseVoteRepository } from '../infrastructure/repositories/SupabaseVoteRepository';
import { SupabaseAuditLogRepository } from '../infrastructure/repositories/SupabaseAuditLogRepository';
import { DecisionFileStorageService } from '../infrastructure/services/DecisionFileStorageService';

// ── Charge adapters ──────────────────────────────────────────────────────────
import { InvoiceChargeAdapter } from '../infrastructure/adapters/InvoiceChargeAdapter';
import { AssessmentChargeAdapter } from '../infrastructure/adapters/AssessmentChargeAdapter';
import { SupabaseInvoiceRepository } from '@/modules/billing/infrastructure/repositories/SupabaseInvoiceRepository';
import { SupabaseUnitRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseUnitRepository';
import { SupabasePettyCashRepository } from '@/modules/petty-cash/infrastructure/repositories/SupabasePettyCashRepository';
import { GenerateAssessments } from '@/modules/petty-cash/application/use-cases/GenerateAssessments';

// ── Use Cases ─────────────────────────────────────────────────────────────────
import { CreateDecision } from '../application/use-cases/CreateDecision';
import { CreateDirectDecision } from '../application/use-cases/CreateDirectDecision';
import { GetDecision } from '../application/use-cases/GetDecision';
import { ListDecisions } from '../application/use-cases/ListDecisions';
import { FinalizeDecision } from '../application/use-cases/FinalizeDecision';
import { AwardSoleQuote } from '../application/use-cases/AwardSoleQuote';
import { ExtendDeadlines } from '../application/use-cases/ExtendDeadlines';
import { CancelDecision } from '../application/use-cases/CancelDecision';
import { ResolveTiebreak } from '../application/use-cases/ResolveTiebreak';
import { GenerateCharge } from '../application/use-cases/GenerateCharge';
import { UploadQuote } from '../application/use-cases/UploadQuote';
import { ListQuotes } from '../application/use-cases/ListQuotes';
import { DeleteQuote } from '../application/use-cases/DeleteQuote';
import { CastVote } from '../application/use-cases/CastVote';
import { ListVotes } from '../application/use-cases/ListVotes';
import { GetResults } from '../application/use-cases/GetResults';
import { GetAuditLog } from '../application/use-cases/GetAuditLog';
import { supabaseAdmin } from '@/infrastructure/supabase';

// ── TypeBox schemas ───────────────────────────────────────────────────────────
import {
  DecisionSchema,
  QuoteSchema,
  VoteSchema,
  TallyResponseSchema,
  PaginatedDecisionSchema,
  PaginatedQuoteSchema,
  PaginatedVoteSchema,
  PaginatedAuditEntrySchema,
  CreateDecisionBody,
  ExtendDeadlinesBody,
  CancelDecisionBody,
  ResolveTiebreakBody,
  GenerateChargeBody,
  CastVoteBody,
  DeleteQuoteBody,
  FinalizeDecisionBody,
  AwardSoleQuoteBody,
  CreateDirectDecisionBody,
} from './schemas';

// ── Serializers ──────────────────────────────────────────────────────────────
import {
  serializeDecision,
  serializeDecisions,
  serializeQuote,
  serializeQuotes,
} from './serializers';

// ── DI ───────────────────────────────────────────────────────────────────────
const decisionRepo = new SupabaseDecisionRepository();
const quoteRepo = new SupabaseQuoteRepository();
const voteRepo = new SupabaseVoteRepository();
const auditRepo = new SupabaseAuditLogRepository();
const storageService = new DecisionFileStorageService();

// Charge adapter dependencies
const invoiceRepo = new SupabaseInvoiceRepository();
const unitRepo = new SupabaseUnitRepository();
const pettyCashRepo = new SupabasePettyCashRepository();
const generateAssessments = new GenerateAssessments(invoiceRepo, unitRepo, pettyCashRepo);

const invoiceChargeAdapter = new InvoiceChargeAdapter(invoiceRepo);
const assessmentChargeAdapter = new AssessmentChargeAdapter(generateAssessments);

/** Count of active units in a building — injected into GetResults */
const totalApartments = async (buildingId: string): Promise<number> => {
  const { count } = await supabaseAdmin
    .from('units')
    .select('*', { count: 'exact', head: true })
    .eq('building_id', buildingId);
  return count ?? 0;
};

const createDecision = new CreateDecision(decisionRepo, auditRepo);
const createDirectDecision = new CreateDirectDecision(decisionRepo, quoteRepo, auditRepo);
const getDecision = new GetDecision(decisionRepo, quoteRepo, voteRepo, totalApartments);
const listDecisions = new ListDecisions(decisionRepo);
const finalizeDecision = new FinalizeDecision(decisionRepo, quoteRepo, voteRepo, auditRepo);
const awardSoleQuote = new AwardSoleQuote(decisionRepo, quoteRepo, auditRepo);
const extendDeadlines = new ExtendDeadlines(decisionRepo, auditRepo);
const cancelDecision = new CancelDecision(decisionRepo, auditRepo);
const resolveTiebreak = new ResolveTiebreak(decisionRepo, quoteRepo, auditRepo);
const generateCharge = new GenerateCharge(decisionRepo, quoteRepo, auditRepo, invoiceChargeAdapter, assessmentChargeAdapter);
const uploadQuote = new UploadQuote(decisionRepo, quoteRepo);
const listQuotes = new ListQuotes(quoteRepo);
const deleteQuote = new DeleteQuote(decisionRepo, quoteRepo, auditRepo);
const castVote = new CastVote(decisionRepo, quoteRepo, voteRepo);
const listVotes = new ListVotes(voteRepo);
const getResults = new GetResults(decisionRepo, quoteRepo, voteRepo, totalApartments);
const getAuditLog = new GetAuditLog(auditRepo);

// ── Route factory (prevents Swagger duplicate operation IDs) ──────────────────
export function createDecisionRoutes(tag: string) {
  return new Elysia()
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))

    // ── POST /decisions/direct ───────────────────────────────────────────────
    .post('/decisions/direct', async ({ profile, body }) => {
      const quoteId = crypto.randomUUID();
      const decisionId = crypto.randomUUID();
      const file = body.file as File | undefined;
      let filePath: string | undefined;
      if (file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const uploaded = await storageService.uploadQuoteFile(
          decisionId,
          quoteId,
          { name: file.name, bytes, mime: file.type },
        );
        filePath = uploaded.file_path;
      }

      const result = await createDirectDecision.execute({
        decisionId,
        quoteId,
        buildingId: body.building_id,
        actorUserId: profile.id,
        title: body.title,
        description: typeof body.description === 'string' ? body.description : undefined,
        providerName: body.provider_name,
        amount: typeof body.amount === 'string' ? parseFloat(body.amount) : body.amount,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        fileUrl: filePath,
        reason: body.reason,
      });

      return {
        decision: await serializeDecision(result.decision, storageService),
        quote: await serializeQuote(result.quote, storageService),
      };
    }, {
      body: CreateDirectDecisionBody,
      type: 'multipart/form-data',
      response: t.Object({ decision: DecisionSchema, quote: QuoteSchema }),
      detail: {
        tags: [tag],
        summary: 'Create a directly awarded decision with its sole quote',
        description:
          'Creates the decision, stores the sole provider quote, records the justification, and resolves it without reception or voting steps.',
        security: [{ BearerAuth: [] }],
      },
    })

    // ── POST /decisions ──────────────────────────────────────────────────────
    .post('/decisions', async ({ profile, body }) => {
      const d = await createDecision.execute({
        building_id: body.building_id,
        actor_user_id: profile.id,
        title: body.title,
        description: body.description,
        reception_deadline: new Date(body.reception_deadline),
        voting_deadline: new Date(body.voting_deadline),
        tiebreak_duration_hours: body.tiebreak_duration_hours,
      });
      return serializeDecision(d, storageService);
    }, {
      body: CreateDecisionBody,
      response: DecisionSchema,
      detail: { tags: [tag], summary: 'Create a decision', security: [{ BearerAuth: [] }] },
    })

    // ── POST /decisions/:id/photo ────────────────────────────────────────────
    .post('/decisions/:id/photo', async ({ params, body }) => {
      const d = await decisionRepo.findById(params.id);
      if (!d) throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);

      const file = body.photo as File;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { file_path } = await storageService.uploadIssuePhoto(params.id, {
        name: file.name,
        bytes,
        mime: file.type,
      });

      // Persist the storage path; it gets signed on each read per spec §7.8.
      (d as any).props = { ...(d as any).props, photo_url: file_path };
      await decisionRepo.update(d);

      const signedUrl = await storageService.getSignedUrl(file_path);
      return { photo_url: signedUrl };
    }, {
      body: t.Object({ photo: t.File() }),
      type: 'multipart/form-data',
      response: t.Object({ photo_url: t.String() }),
      detail: { tags: [tag], summary: 'Upload decision photo', security: [{ BearerAuth: [] }] },
    })

    // ── GET /decisions ────────────────────────────────────────────────────────
    .get('/decisions', async ({ profile, query }) => {
      const result = await listDecisions.execute({
        building_id: query.building_id ?? (
          profile.app_role !== 'admin' && profile.boardBuildingIds.length
            ? profile.boardBuildingIds[0]
            : undefined
        ),
        statuses: query.status,
        search: query.search,
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit,
      });
      const data = await serializeDecisions(result.data, storageService);
      return { data, metadata: result.metadata };
    }, {
      query: t.Object({
        building_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
        search: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      response: PaginatedDecisionSchema,
      detail: { tags: [tag], summary: 'List decisions', security: [{ BearerAuth: [] }] },
    })

    // ── GET /decisions/:id ────────────────────────────────────────────────────
    .get('/decisions/:id', async ({ profile, params }) => {
      const result = await getDecision.execute(params.id, { caller_user_id: profile.id });
      if (!result) throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);
      const [decision, quotes] = await Promise.all([
        serializeDecision(result.decision, storageService),
        serializeQuotes(result.quotes, storageService),
      ]);
      return {
        decision,
        quotes,
        tally: result.tally,
        my_vote: result.my_vote?.toJSON() ?? null,
      };
    }, {
      response: t.Any(),
      detail: { tags: [tag], summary: 'Get decision detail', security: [{ BearerAuth: [] }] },
    })

    // ── PATCH /decisions/:id/deadlines ────────────────────────────────────────
    .patch('/decisions/:id/deadlines', async ({ profile, params, body }) => {
      const d = await extendDeadlines.execute({
        decision_id: params.id,
        reception_deadline: body.reception_deadline ? new Date(body.reception_deadline) : undefined,
        voting_deadline: body.voting_deadline ? new Date(body.voting_deadline) : undefined,
        reason: body.reason,
        actor_user_id: profile.id,
      });
      return serializeDecision(d, storageService);
    }, {
      body: ExtendDeadlinesBody,
      response: DecisionSchema,
      detail: { tags: [tag], summary: 'Extend deadlines', security: [{ BearerAuth: [] }] },
    })

    // ── POST /decisions/:id/cancel ────────────────────────────────────────────
    .post('/decisions/:id/cancel', async ({ profile, params, body }) => {
      const d = await cancelDecision.execute({
        decision_id: params.id,
        reason: body.reason,
        actor_user_id: profile.id,
      });
      return serializeDecision(d, storageService);
    }, {
      body: CancelDecisionBody,
      response: DecisionSchema,
      detail: { tags: [tag], summary: 'Cancel a decision', security: [{ BearerAuth: [] }] },
    })

    // ── POST /decisions/:id/finalize ──────────────────────────────────────────
    .post('/decisions/:id/finalize', async ({ profile, params, body }) => {
      const d = await finalizeDecision.execute({
        decision_id: params.id,
        actor_user_id: profile.id,
        force: body?.force,
        reason: body?.reason,
      });
      return serializeDecision(d, storageService);
    }, {
      body: FinalizeDecisionBody,
      response: DecisionSchema,
      detail: {
        tags: [tag],
        summary: 'Advance or resolve a decision',
        description:
          'Empty body runs the normal flow. Pass `{ force: true, reason: "..." }` to bypass the reception_deadline check for RECEPTION → VOTING (admin/board override — reason is captured in the audit log).',
        security: [{ BearerAuth: [] }],
      },
    })

    // ── POST /decisions/:id/award-sole-quote ─────────────────────────────────
    .post('/decisions/:id/award-sole-quote', async ({ profile, params, body }) => {
      const decision = await awardSoleQuote.execute({
        decisionId: params.id,
        actorUserId: profile.id,
        reason: body.reason,
      });
      return serializeDecision(decision, storageService);
    }, {
      body: AwardSoleQuoteBody,
      response: DecisionSchema,
      detail: {
        tags: [tag],
        summary: 'Award the only active quote without voting',
        description:
          'Resolves a decision directly from RECEPTION when exactly one active quote exists. The selected provider and reason are recorded in the audit log.',
        security: [{ BearerAuth: [] }],
      },
    })

    // ── POST /decisions/:id/resolve-tiebreak ──────────────────────────────────
    .post('/decisions/:id/resolve-tiebreak', async ({ profile, params, body }) => {
      const d = await resolveTiebreak.execute({
        decision_id: params.id,
        winner_quote_id: body.winner_quote_id,
        actor_user_id: profile.id,
      });
      return serializeDecision(d, storageService);
    }, {
      body: ResolveTiebreakBody,
      response: DecisionSchema,
      detail: { tags: [tag], summary: 'Manually resolve a tiebreak', security: [{ BearerAuth: [] }] },
    })

    // ── POST /decisions/:id/generate-charge ───────────────────────────────────
    .post('/decisions/:id/generate-charge', async ({ profile, params, body }) => {
      return generateCharge.execute({
        decision_id: params.id,
        type: body.type,
        actor_user_id: profile.id,
        description_override: body.description_override,
        amount_override: body.amount_override,
      });
    }, {
      body: GenerateChargeBody,
      response: t.Any(),
      detail: { tags: [tag], summary: 'Generate charge (invoice or assessment)', security: [{ BearerAuth: [] }] },
    })

    // ── POST /decisions/:id/quotes ────────────────────────────────────────────
    .post('/decisions/:id/quotes', async ({ profile, params, body }) => {
      const file = body.file as File;
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Upload to storage first with a pre-generated ID
      const quoteId = crypto.randomUUID();
      const { file_path } = await storageService.uploadQuoteFile(params.id, quoteId, {
        name: file.name,
        bytes,
        mime: file.type,
      });

      const q = await uploadQuote.execute({
        decision_id: params.id,
        uploader_user_id: profile.id,
        provider_name: typeof body.provider_name === 'string' ? body.provider_name : '',
        amount: typeof body.amount === 'string' ? parseFloat(body.amount) : body.amount,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        file_url: file_path,
      });
      return serializeQuote(q, storageService);
    }, {
      body: t.Object({
        file: t.File(),
        provider_name: t.String({ minLength: 2, maxLength: 200 }),
        amount: t.Union([t.Number(), t.String()]),
        notes: t.Optional(t.String()),
      }),
      type: 'multipart/form-data',
      response: QuoteSchema,
      detail: { tags: [tag], summary: 'Upload a quote', security: [{ BearerAuth: [] }] },
    })

    // ── GET /decisions/:id/quotes ─────────────────────────────────────────────
    .get('/decisions/:id/quotes', async ({ params, query }) => {
      const includeDeleted = query.include_deleted === 'true';
      const result = await listQuotes.executePaginated({
        decision_id: params.id,
        include_deleted: includeDeleted,
        page: query.page,
        limit: query.limit,
      });
      const data = await serializeQuotes(result.data, storageService);
      return { data, metadata: result.metadata };
    }, {
      query: t.Object({
        include_deleted: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      response: PaginatedQuoteSchema,
      detail: { tags: [tag], summary: 'List quotes', security: [{ BearerAuth: [] }] },
    })

    // ── DELETE /decisions/:id/quotes/:quoteId ─────────────────────────────────
    .delete('/decisions/:id/quotes/:quoteId', async ({ profile, params, body }) => {
      const q = await deleteQuote.execute({
        decision_id: params.id,
        quote_id: params.quoteId,
        actor_user_id: profile.id,
        actor_role: profile.app_role === 'admin' ? 'admin' : 'board',
        reason: body?.reason,
      });
      return serializeQuote(q, storageService);
    }, {
      body: t.Optional(DeleteQuoteBody),
      response: QuoteSchema,
      detail: { tags: [tag], summary: 'Soft-delete a quote', security: [{ BearerAuth: [] }] },
    })

    // ── POST /decisions/:id/votes ─────────────────────────────────────────────
    .post('/decisions/:id/votes', async ({ profile, params, body }) => {
      const v = await castVote.execute({
        decision_id: params.id,
        apartment_id: body.apartment_id,
        quote_id: body.quote_id,
        voter_user_id: profile.id,
      });
      return v.toJSON();
    }, {
      body: CastVoteBody,
      response: VoteSchema,
      detail: { tags: [tag], summary: 'Cast a vote', security: [{ BearerAuth: [] }] },
    })

    // ── GET /decisions/:id/votes ──────────────────────────────────────────────
    .get('/decisions/:id/votes', async ({ params, query }) => {
      const round = query.round ? parseInt(query.round) : undefined;
      const result = await listVotes.executePaginated({
        decision_id: params.id,
        round,
        page: query.page,
        limit: query.limit,
      });
      return {
        data: result.data.map((v) => v.toJSON()),
        metadata: result.metadata,
      };
    }, {
      query: t.Object({
        round: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      response: PaginatedVoteSchema,
      detail: { tags: [tag], summary: 'List votes', security: [{ BearerAuth: [] }] },
    })

    // ── GET /decisions/:id/results ────────────────────────────────────────────
    .get('/decisions/:id/results', async ({ params, query }) => {
      const round = query.round ? parseInt(query.round) : undefined;
      return getResults.execute(params.id, round);
    }, {
      query: t.Object({ round: t.Optional(t.String()) }),
      response: TallyResponseSchema,
      detail: { tags: [tag], summary: 'Get voting results/tally', security: [{ BearerAuth: [] }] },
    })

    // ── GET /decisions/:id/audit-log ──────────────────────────────────────────
    .get('/decisions/:id/audit-log', async ({ params, query }) => {
      const result = await getAuditLog.executePaginated({
        decision_id: params.id,
        page: query.page,
        limit: query.limit,
      });
      return {
        data: result.data.map((e) => e.toJSON()),
        metadata: result.metadata,
      };
    }, {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      response: PaginatedAuditEntrySchema,
      detail: { tags: [tag], summary: 'Get audit log', security: [{ BearerAuth: [] }] },
    });
}

// ── Exported admin plugin ────────────────────────────────────────────────────
export const decisionRoutes = new Elysia({ prefix: '/decisions' })
  .use(createDecisionRoutes('Admin - Decisions'));
