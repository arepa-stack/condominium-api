import { t } from 'elysia';

// ------------------------------------------------------------------ primitives

const NullableString = t.Union([t.String(), t.Null()]);

const ProfileRefSchema = t.Object({
  id: t.String(),
  name: t.String(),
});

const NullableProfileRef = t.Union([ProfileRefSchema, t.Null()]);

// ------------------------------------------------------------------ Decision

export const DecisionSchema = t.Object({
  id: t.String(),
  building_id: t.String(),
  created_by: NullableProfileRef,
  title: t.String(),
  description: NullableString,
  photo_url: NullableString,
  status: t.Union([
    t.Literal('RECEPTION'),
    t.Literal('VOTING'),
    t.Literal('TIEBREAK_PENDING'),
    t.Literal('RESOLVED'),
    t.Literal('CANCELLED'),
  ]),
  current_round: t.Number(),
  reception_deadline: t.String(),
  voting_deadline: t.String(),
  tiebreak_duration_hours: t.Number(),
  winner_quote_id: NullableString,
  resulting_type: t.Union([t.Literal('INVOICE'), t.Literal('ASSESSMENT'), t.Null()]),
  resulting_id: NullableString,
  finalized_at: NullableString,
  cancelled_at: NullableString,
  cancel_reason: NullableString,
  created_at: t.String(),
  updated_at: t.String(),
  quote_count: t.Number(),
  is_deadline_passed: t.Boolean(),
});

// ------------------------------------------------------------------ Quote

export const QuoteSchema = t.Object({
  id: t.String(),
  decision_id: t.String(),
  uploader: NullableProfileRef,
  uploader_unit_id: NullableString,
  provider_name: t.String(),
  amount: t.Number(),
  notes: NullableString,
  file_url: t.String(),
  deleted_at: NullableString,
  deleted_by: NullableProfileRef,
  deletion_reason: NullableString,
  created_at: t.String(),
  updated_at: t.String(),
});

// ------------------------------------------------------------------ Vote

export const VoteSchema = t.Object({
  id: t.String(),
  decision_id: t.String(),
  round: t.Number(),
  apartment_id: t.String(),
  quote_id: t.String(),
  voted_by: NullableProfileRef,
  created_at: t.String(),
});

// ------------------------------------------------------------------ AuditLog

export const AuditEntrySchema = t.Object({
  id: t.String(),
  decision_id: t.String(),
  event: t.Union([
    t.Literal('CREATED'),
    t.Literal('DEADLINE_EXTENDED'),
    t.Literal('CANCELLED'),
    t.Literal('QUOTE_DELETED'),
    t.Literal('FINALIZED'),
    t.Literal('TIEBREAK_OPENED'),
    t.Literal('WINNER_SET_MANUAL'),
    t.Literal('CHARGE_GENERATED'),
    t.Literal('PHASE_ADVANCED'),
  ]),
  actor: NullableProfileRef,
  payload: t.Optional(t.Union([t.Any(), t.Null()])),
  created_at: t.String(),
});

// ------------------------------------------------------------------ Tally / Results

export const TallyEntrySchema = t.Object({
  quote_id: t.String(),
  provider_name: t.String(),
  amount: t.Number(),
  votes: t.Number(),
  pct: t.Number(),
});

export const TallyResponseSchema = t.Object({
  round: t.Number(),
  status: t.String(),
  total_apartments: t.Number(),
  total_votes: t.Number(),
  participation_pct: t.Number(),
  tallies: t.Array(TallyEntrySchema),
  winner_quote_id: NullableString,
  is_tied: t.Boolean(),
});

// ------------------------------------------------------------------ Pagination

export const PaginationMetadataSchema = t.Object({
  total: t.Number(),
  page: t.Number(),
  limit: t.Number(),
  total_pages: t.Number(),
});

export const PaginatedDecisionSchema = t.Object({
  items: t.Array(DecisionSchema),
  metadata: PaginationMetadataSchema,
});

// ------------------------------------------------------------------ Request bodies

export const CreateDecisionBody = t.Object({
  building_id: t.String(),
  title: t.String({ minLength: 5, maxLength: 200 }),
  description: t.Optional(t.String()),
  reception_deadline: t.String(),
  voting_deadline: t.String(),
  tiebreak_duration_hours: t.Optional(t.Number({ minimum: 1, maximum: 720 })),
});

export const ExtendDeadlinesBody = t.Object({
  reception_deadline: t.Optional(t.String()),
  voting_deadline: t.Optional(t.String()),
  reason: t.String({ minLength: 1 }),
});

export const CancelDecisionBody = t.Object({
  reason: t.String({ minLength: 1 }),
});

/**
 * Body for POST /decisions/:id/finalize. All fields optional — empty body is
 * valid (normal finalize flow). `force: true` requires a non-empty `reason`
 * and bypasses the reception_deadline check for RECEPTION → VOTING.
 */
export const FinalizeDecisionBody = t.Optional(
  t.Object({
    force: t.Optional(t.Boolean()),
    reason: t.Optional(t.String({ minLength: 1 })),
  }),
);

export const ResolveTiebreakBody = t.Object({
  winner_quote_id: t.String(),
});

export const GenerateChargeBody = t.Object({
  type: t.Union([t.Literal('INVOICE'), t.Literal('ASSESSMENT')]),
  description_override: t.Optional(t.String()),
  amount_override: t.Optional(t.Number({ minimum: 0.01 })),
});

export const UploadQuoteBody = t.Object({
  provider_name: t.String({ minLength: 2, maxLength: 200 }),
  amount: t.Number({ minimum: 0.01 }),
  notes: t.Optional(t.String()),
});

export const DeleteQuoteBody = t.Object({
  reason: t.Optional(t.String()),
});

export const CastVoteBody = t.Object({
  apartment_id: t.String(),
  quote_id: t.String(),
});
