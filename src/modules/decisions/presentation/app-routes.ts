/**
 * APK Decision Routes — /api/v1/app/decisions
 *
 * Read-only + resident participation endpoints.
 * Residents can: list decisions, view detail, upload quotes (RECEPTION phase),
 * self-delete their own quotes, cast votes, and view results.
 *
 * Auth: Bearer token validated via supabase.auth.getUser (same as payments app routes).
 * Authorization: unit ownership validated inline where needed.
 */

import { Elysia, t } from 'elysia';
import { UnauthorizedError, ForbiddenError, DomainError } from '@/core/errors';
import { supabase, supabaseAdmin } from '@/infrastructure/supabase';

// ── Repositories ─────────────────────────────────────────────────────────────
import { SupabaseDecisionRepository } from '../infrastructure/repositories/SupabaseDecisionRepository';
import { SupabaseQuoteRepository } from '../infrastructure/repositories/SupabaseQuoteRepository';
import { SupabaseVoteRepository } from '../infrastructure/repositories/SupabaseVoteRepository';
import { DecisionFileStorageService } from '../infrastructure/services/DecisionFileStorageService';

// ── Use Cases ─────────────────────────────────────────────────────────────────
import { GetDecision } from '../application/use-cases/GetDecision';
import { ListDecisions } from '../application/use-cases/ListDecisions';
import { UploadQuote } from '../application/use-cases/UploadQuote';
import { DeleteQuote } from '../application/use-cases/DeleteQuote';
import { CastVote } from '../application/use-cases/CastVote';
import { ListVotes } from '../application/use-cases/ListVotes';
import { GetResults } from '../application/use-cases/GetResults';
import { SupabaseAuditLogRepository } from '../infrastructure/repositories/SupabaseAuditLogRepository';

// ── TypeBox schemas ───────────────────────────────────────────────────────────
import {
  QuoteSchema,
  VoteSchema,
  TallyResponseSchema,
  PaginatedDecisionSchema,
  CastVoteBody,
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

/** Count active units in a building — injected into GetDecision + GetResults */
const totalApartments = async (buildingId: string): Promise<number> => {
  const { count } = await supabaseAdmin
    .from('units')
    .select('*', { count: 'exact', head: true })
    .eq('building_id', buildingId);
  return count ?? 0;
};

const getDecision = new GetDecision(decisionRepo, quoteRepo, voteRepo, totalApartments);
const listDecisions = new ListDecisions(decisionRepo);
const uploadQuote = new UploadQuote(decisionRepo, quoteRepo);
const deleteQuote = new DeleteQuote(decisionRepo, quoteRepo, auditRepo);
const castVote = new CastVote(decisionRepo, quoteRepo, voteRepo);
const listVotes = new ListVotes(voteRepo);

const getResults = new GetResults(decisionRepo, quoteRepo, voteRepo, totalApartments);

// ── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Resolves the caller's Supabase user ID from Bearer token + their unit list.
 * Returns `{ userId, unitIds, buildingIds }` for downstream ownership checks.
 */
async function resolveResident(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) throw new UnauthorizedError('Authentication required');

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new UnauthorizedError('Invalid or expired token');

  const [unitsRes, boardRes] = await Promise.all([
    supabaseAdmin
      .from('profile_units')
      .select('unit_id, is_primary, units(building_id)')
      .eq('profile_id', user.id),
    supabaseAdmin
      .from('building_members')
      .select('building_id, role')
      .eq('profile_id', user.id),
  ]);

  const units = (unitsRes.data ?? []) as any[];
  const boardMembers = (boardRes.data ?? []) as any[];

  const unitBuildingIds = units
    .map(u => {
      const joined = u.units;
      if (!joined) return null;
      return Array.isArray(joined) ? joined[0]?.building_id : joined.building_id;
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const boardBuildingIds = boardMembers
    .filter(bm => bm.role === 'board')
    .map(bm => bm.building_id as string);

  return {
    userId: user.id,
    unitIds: units.map(u => u.unit_id as string),
    buildingIds: [...new Set([...unitBuildingIds, ...boardBuildingIds])],
  };
}

// ── Route factory (prevents Swagger duplicate operation IDs) ─────────────────
export function createDecisionAppRoutes(tag: string) {
  return new Elysia()
    .derive(async ({ request }) => {
      const resident = await resolveResident(request);
      return { resident };
    })

    // ── GET /decisions ──────────────────────────────────────────────────────
    // RLS on the `decisions` table restricts rows to the resident's building(s).
    // We additionally scope the query to their known building IDs client-side
    // so we get an early, predictable empty result if the user has no units.
    .get('/decisions', async ({ resident, query }) => {
      const page = query.page ? parseInt(query.page) : 1;
      const limit = query.limit ? parseInt(query.limit) : 20;

      if (!resident.buildingIds.length) {
        return { items: [], metadata: { total: 0, page, limit, total_pages: 0 } };
      }

      // Scope to the first building (residents typically belong to one building)
      const result = await listDecisions.execute({
        building_id: query.building_id && resident.buildingIds.includes(query.building_id)
          ? query.building_id
          : resident.buildingIds[0],
        statuses: query.status,
        search: query.search,
        page,
        limit,
      });

      const items = await serializeDecisions(result.data, storageService);
      return {
        items,
        metadata: {
          total: result.metadata.total,
          page: result.metadata.page,
          limit: result.metadata.limit,
          total_pages: result.metadata.total_pages,
        },
      };
    }, {
      query: t.Object({
        building_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
        search: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      response: PaginatedDecisionSchema,
      detail: { tags: [tag], summary: 'List decisions (resident view)', security: [{ BearerAuth: [] }] },
    })

    // ── GET /decisions/:id ──────────────────────────────────────────────────
    .get('/decisions/:id', async ({ resident, params }) => {
      const result = await getDecision.execute(params.id, { caller_user_id: resident.userId });
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

    // ── POST /decisions/:id/quotes ──────────────────────────────────────────
    // Residents upload quotes during RECEPTION phase.
    // uploader_unit_id must belong to the caller.
    .post('/decisions/:id/quotes', async ({ resident, params, body }) => {
      const unitId = typeof body.unit_id === 'string' ? body.unit_id : null;
      if (unitId && !resident.unitIds.includes(unitId)) {
        throw new ForbiddenError('unit_id does not belong to your account');
      }

      const file = body.file as File;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { file_path } = await storageService.uploadQuoteFile(params.id, crypto.randomUUID(), {
        name: file.name,
        bytes,
        mime: file.type,
      });

      const q = await uploadQuote.execute({
        decision_id: params.id,
        uploader_user_id: resident.userId,
        uploader_unit_id: unitId,
        provider_name: typeof body.provider_name === 'string' ? body.provider_name : '',
        amount: typeof body.amount === 'string' ? parseFloat(body.amount) : body.amount,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        file_url: file_path,
      });
      return serializeQuote(q, storageService);
    }, {
      body: t.Object({
        file: t.File(),
        unit_id: t.Optional(t.String({ description: 'Your unit ID — validated against your account' })),
        provider_name: t.String({ minLength: 2, maxLength: 200 }),
        amount: t.Union([t.Number(), t.String()]),
        notes: t.Optional(t.String()),
      }),
      type: 'multipart/form-data',
      response: t.Any(),
      detail: { tags: [tag], summary: 'Upload a quote (resident)', security: [{ BearerAuth: [] }] },
    })

    // ── DELETE /decisions/:id/quotes/:quoteId ────────────────────────────────
    // Residents may only delete their own quotes while decision is in RECEPTION.
    .delete('/decisions/:id/quotes/:quoteId', async ({ resident, params }) => {
      const quote = await quoteRepo.findById(params.quoteId);
      if (!quote) throw new DomainError('quote not found', 'QUOTE_NOT_FOUND', 404);
      if (quote.uploader_user_id !== resident.userId) {
        throw new ForbiddenError('you can only delete your own quotes');
      }

      const q = await deleteQuote.execute({
        decision_id: params.id,
        quote_id: params.quoteId,
        actor_user_id: resident.userId,
        actor_role: 'resident',
        reason: 'Deleted by uploader',
      });
      return serializeQuote(q, storageService);
    }, {
      response: QuoteSchema,
      detail: {
        tags: [tag],
        summary: 'Delete own quote (resident)',
        description: 'Only the uploader can delete their quote, and only during RECEPTION phase.',
        security: [{ BearerAuth: [] }],
      },
    })

    // ── POST /decisions/:id/votes ────────────────────────────────────────────
    // Residents vote for a quote. apartment_id must belong to the caller.
    .post('/decisions/:id/votes', async ({ resident, params, body }) => {
      if (!resident.unitIds.includes(body.apartment_id)) {
        throw new ForbiddenError('apartment_id does not belong to your account');
      }
      const v = await castVote.execute({
        decision_id: params.id,
        apartment_id: body.apartment_id,
        quote_id: body.quote_id,
        voter_user_id: resident.userId,
      });
      return v.toJSON();
    }, {
      body: CastVoteBody,
      response: VoteSchema,
      detail: {
        tags: [tag],
        summary: 'Cast a vote (resident)',
        description: 'One vote per apartment per round. apartment_id must belong to the authenticated user.',
        security: [{ BearerAuth: [] }],
      },
    })

    // ── GET /decisions/:id/votes ─────────────────────────────────────────────
    .get('/decisions/:id/votes', async ({ params, query }) => {
      const round = query.round ? parseInt(query.round) : undefined;
      const votes = await listVotes.execute(params.id, round);
      return votes.map((v: any) => v.toJSON());
    }, {
      query: t.Object({ round: t.Optional(t.String()) }),
      response: t.Array(VoteSchema),
      detail: { tags: [tag], summary: 'List votes', security: [{ BearerAuth: [] }] },
    })

    // ── GET /decisions/:id/results ───────────────────────────────────────────
    .get('/decisions/:id/results', async ({ params, query }) => {
      const round = query.round ? parseInt(query.round) : undefined;
      return getResults.execute(params.id, round);
    }, {
      query: t.Object({ round: t.Optional(t.String()) }),
      response: TallyResponseSchema,
      detail: { tags: [tag], summary: 'Get voting results/tally', security: [{ BearerAuth: [] }] },
    });
}

// ── Exported app plugin ───────────────────────────────────────────────────────
export const decisionAppRoutes = new Elysia({ prefix: '/decisions' })
  .use(createDecisionAppRoutes('App - Decisions'));
