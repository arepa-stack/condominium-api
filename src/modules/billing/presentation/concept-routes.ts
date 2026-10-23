import { Elysia, t } from 'elysia';
import { requireBuildingAccess, requireRole } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';
import { SupabaseChargeConceptRepository } from '../infrastructure/repositories/SupabaseChargeConceptRepository';
import { SupabaseBuildingRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseBuildingRepository';
import { SupabaseDecisionRepository } from '@/modules/decisions/infrastructure/repositories/SupabaseDecisionRepository';
import { CreateChargeConcept } from '../application/use-cases/CreateChargeConcept';
import { ListChargeConcepts } from '../application/use-cases/ListChargeConcepts';
import { UpdateChargeConcept } from '../application/use-cases/UpdateChargeConcept';
import { ChargeConceptKind, ChargeConceptStatus, ChargeDistribution } from '../domain/entities/ChargeConcept';

const conceptRepository = new SupabaseChargeConceptRepository();
const decisionRepository = new SupabaseDecisionRepository();
const createChargeConcept = new CreateChargeConcept(conceptRepository, new SupabaseBuildingRepository(), decisionRepository);
const listChargeConcepts = new ListChargeConcepts(conceptRepository);
const updateChargeConcept = new UpdateChargeConcept(conceptRepository, decisionRepository);

const KindSchema = t.Union([t.Literal('ORDINARY'), t.Literal('EXTRAORDINARY')]);
const DistributionSchema = t.Union([t.Literal('ALIQUOT'), t.Literal('EQUAL'), t.Literal('FIXED')]);
const StatusSchema = t.Union([t.Literal('ACTIVE'), t.Literal('CLOSED')]);
const NullableAmount = t.Union([t.Number({ exclusiveMinimum: 0 }), t.Null()]);

const ChargeConceptSchema = t.Object({
    id: t.String(),
    building_id: t.String(),
    name: t.String(),
    kind: KindSchema,
    base_amount: t.Union([t.Number(), t.Null()]),
    distribution: DistributionSchema,
    decision_id: t.Union([t.String(), t.Null()]),
    status: StatusSchema,
    created_at: t.Optional(t.Any()),
    updated_at: t.Optional(t.Any()),
});

const TAG = 'Admin - Billing Concepts';

export const chargeConceptRoutes = new Elysia({ prefix: '/billing/buildings/:buildingId/concepts' })
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
    .use(requireBuildingAccess((ctx) => ctx.params.buildingId, 'charge-concepts-access'))
    .get('/', async ({ params, query }) => {
        const concepts = await listChargeConcepts.execute(params.buildingId, {
            status: query.status as ChargeConceptStatus | undefined,
        });
        return concepts.map(c => c.toJSON());
    }, {
        query: t.Object({ status: t.Optional(StatusSchema) }),
        response: t.Array(ChargeConceptSchema),
        detail: { tags: [TAG], summary: 'List charge concepts of a building' },
    })
    .post('/', async ({ params, body, set }) => {
        const concept = await createChargeConcept.execute({
            building_id: params.buildingId,
            name: body.name,
            kind: body.kind as ChargeConceptKind,
            base_amount: body.base_amount,
            distribution: body.distribution as ChargeDistribution | undefined,
            decision_id: body.decision_id,
        });
        set.status = 201;
        return concept.toJSON();
    }, {
        body: t.Object({
            name: t.String({ minLength: 1, maxLength: 120 }),
            kind: KindSchema,
            base_amount: t.Optional(NullableAmount),
            distribution: t.Optional(DistributionSchema),
            decision_id: t.Optional(t.Union([t.String({ format: 'uuid' }), t.Null()])),
        }),
        response: { 201: ChargeConceptSchema },
        detail: { tags: [TAG], summary: 'Create a charge concept' },
    })
    .patch('/:conceptId', async ({ params, body }) => {
        const concept = await updateChargeConcept.execute(params.buildingId, params.conceptId, {
            name: body.name,
            base_amount: body.base_amount,
            distribution: body.distribution as ChargeDistribution | undefined,
            decision_id: body.decision_id,
            status: body.status as ChargeConceptStatus | undefined,
        });
        return concept.toJSON();
    }, {
        body: t.Object({
            name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
            base_amount: t.Optional(NullableAmount),
            distribution: t.Optional(DistributionSchema),
            decision_id: t.Optional(t.Union([t.String({ format: 'uuid' }), t.Null()])),
            status: t.Optional(StatusSchema),
        }),
        response: ChargeConceptSchema,
        detail: { tags: [TAG], summary: 'Update or close a charge concept (kind cannot change)' },
    });
