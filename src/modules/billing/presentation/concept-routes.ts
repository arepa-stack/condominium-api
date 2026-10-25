import { Elysia, t } from 'elysia';
import { requireBuildingAccess, requireRole } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';
import { SupabaseChargeConceptRepository } from '../infrastructure/repositories/SupabaseChargeConceptRepository';
import { SupabaseBuildingRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseBuildingRepository';
import { SupabaseDecisionRepository } from '@/modules/decisions/infrastructure/repositories/SupabaseDecisionRepository';
import { CreateChargeConcept } from '../application/use-cases/CreateChargeConcept';
import { ListChargeConcepts } from '../application/use-cases/ListChargeConcepts';
import { UpdateChargeConcept } from '../application/use-cases/UpdateChargeConcept';
import { BillConcept } from '../application/use-cases/BillConcept';
import { ChargeConceptGuard } from '../application/services/ChargeConceptGuard';
import { SupabaseInvoiceRepository } from '../infrastructure/repositories/SupabaseInvoiceRepository';
import { SupabaseUnitRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseUnitRepository';
import { ChargeConceptKind, ChargeConceptStatus, ChargeDistribution } from '../domain/entities/ChargeConcept';

const conceptRepository = new SupabaseChargeConceptRepository();
const decisionRepository = new SupabaseDecisionRepository();
const createChargeConcept = new CreateChargeConcept(conceptRepository, new SupabaseBuildingRepository(), decisionRepository);
const listChargeConcepts = new ListChargeConcepts(conceptRepository);
const updateChargeConcept = new UpdateChargeConcept(conceptRepository, decisionRepository);
const unitRepository = new SupabaseUnitRepository();
const billConcept = new BillConcept(
    new SupabaseInvoiceRepository(),
    unitRepository,
    new ChargeConceptGuard(conceptRepository, unitRepository)
);

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

// Validated here so a malformed id is a 422, not a database error.
const BuildingParams = t.Object({ buildingId: t.String({ format: 'uuid' }) });
const ConceptParams = t.Object({ buildingId: t.String({ format: 'uuid' }), conceptId: t.String({ format: 'uuid' }) });

export const chargeConceptRoutes = new Elysia({ prefix: '/billing/buildings/:buildingId/concepts' })
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
    .use(requireBuildingAccess((ctx) => ctx.params.buildingId, 'charge-concepts-access'))
    .get('/', async ({ params, query }) => {
        const concepts = await listChargeConcepts.execute(params.buildingId, {
            status: query.status as ChargeConceptStatus | undefined,
        });
        return concepts.map(c => c.toJSON());
    }, {
        params: BuildingParams,
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
        params: BuildingParams,
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
        params: ConceptParams,
        body: t.Object({
            name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
            base_amount: t.Optional(NullableAmount),
            distribution: t.Optional(DistributionSchema),
            decision_id: t.Optional(t.Union([t.String({ format: 'uuid' }), t.Null()])),
            status: t.Optional(StatusSchema),
        }),
        response: ChargeConceptSchema,
        detail: { tags: [TAG], summary: 'Update or close a charge concept (kind cannot change)' },
    })
    .post('/:conceptId/invoices', async ({ params, body, set }) => {
        const result = await billConcept.execute({
            buildingId: params.buildingId,
            conceptId: params.conceptId,
            period: body.period,
            amount: body.amount,
            description: body.description,
            dueDate: body.due_date ? new Date(body.due_date) : undefined,
        });
        set.status = 201;
        return {
            concept_id: params.conceptId,
            period: body.period,
            count: result.invoices.length,
            total: result.total,
            invoices: result.invoices.map(inv => ({ id: inv.id, unit_id: inv.unit_id ?? null, amount: inv.amount })),
        };
    }, {
        params: ConceptParams,
        body: t.Object({
            period: t.String({ examples: ['2026-10'] }),
            amount: t.Optional(t.Number({ exclusiveMinimum: 0 })),
            description: t.Optional(t.String({ maxLength: 500 })),
            due_date: t.Optional(t.String({ format: 'date' })),
        }),
        response: {
            201: t.Object({
                concept_id: t.String(),
                period: t.String(),
                count: t.Number(),
                total: t.Number(),
                invoices: t.Array(t.Object({ id: t.String(), unit_id: t.Union([t.String(), t.Null()]), amount: t.Number() })),
            }),
        },
        detail: {
            tags: [TAG],
            summary: 'Bill a concept to every unit of the building for a period',
            description: 'amount defaults to the concept base amount: total to split for ALIQUOT/EQUAL, per-unit amount for FIXED. ALIQUOT rounds each unit to the cent; EQUAL adds up exactly. 409 if the concept was already billed for the period.',
        },
    });
