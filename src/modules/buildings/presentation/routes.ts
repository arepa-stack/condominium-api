import { Elysia, t } from 'elysia';
import { SupabaseBuildingRepository } from '../infrastructure/repositories/SupabaseBuildingRepository';
import { SupabaseUnitRepository } from '../infrastructure/repositories/SupabaseUnitRepository';
import { SupabaseUserRepository } from '@/modules/users/infrastructure/repositories/SupabaseUserRepository';
import { CreateBuilding } from '../application/use-cases/CreateBuilding';
import { GetBuildings } from '../application/use-cases/GetBuildings';
import { GetBuildingById } from '../application/use-cases/GetBuildingById';
import { GetBuildingByCode } from '../application/use-cases/GetBuildingByCode';
import { UpdateBuilding } from '../application/use-cases/UpdateBuilding';
import { DeleteBuilding } from '../application/use-cases/DeleteBuilding';
import { CreateUnit } from '../application/use-cases/CreateUnit';
import { BatchCreateUnits } from '../application/use-cases/BatchCreateUnits';
import { GetUnitsByBuilding } from '../application/use-cases/GetUnitsByBuilding';
import { GetUnitById } from '../application/use-cases/GetUnitById';
import { DeleteUnit } from '../application/use-cases/DeleteUnit';
import { DeleteUnitsByBuilding } from '../application/use-cases/DeleteUnitsByBuilding';
import { supabase } from '@/infrastructure/supabase';
import { UnauthorizedError } from '@/core/errors';

// Initialize repositories
const buildingRepo = new SupabaseBuildingRepository();
const unitRepo = new SupabaseUnitRepository();
const userRepo = new SupabaseUserRepository();

// Initialize use cases
const createBuilding = new CreateBuilding(buildingRepo, userRepo);
const getBuildings = new GetBuildings(buildingRepo);
const getBuildingById = new GetBuildingById(buildingRepo);
const getBuildingByCode = new GetBuildingByCode(buildingRepo, unitRepo);
const updateBuilding = new UpdateBuilding(buildingRepo, userRepo);
const deleteBuilding = new DeleteBuilding(buildingRepo, userRepo);
const createUnit = new CreateUnit(unitRepo, buildingRepo);
const batchCreateUnits = new BatchCreateUnits(unitRepo, buildingRepo);
const getUnitsByBuilding = new GetUnitsByBuilding(unitRepo);
const getUnitById = new GetUnitById(unitRepo);
const deleteUnit = new DeleteUnit(unitRepo, userRepo);
const deleteUnitsByBuilding = new DeleteUnitsByBuilding(unitRepo, buildingRepo, userRepo);

const BuildingSchema = t.Object({
    id: t.String(),
    name: t.String(),
    address: t.String(),
    building_code: t.Optional(t.String()),
    max_residents_per_unit: t.Optional(t.Number()),
    default_rate_source: t.Optional(t.String()),
    created_at: t.Optional(t.Any()),
    updated_at: t.Optional(t.Any())
});

const UnitSchema = t.Object({
    id: t.String(),
    building_id: t.String(),
    name: t.String(),
    floor: t.Nullable(t.String()),
    aliquot: t.Nullable(t.Number()),
    created_at: t.Optional(t.Any()),
    updated_at: t.Optional(t.Any())
});

const BatchUnitsResponse = t.Object({
    count: t.Number(),
    units: t.Array(UnitSchema)
});

const PaginationMetadataSchema = t.Object({
    total: t.Number(),
    page: t.Number(),
    limit: t.Number(),
    total_pages: t.Number(),
    has_next_page: t.Boolean(),
    has_prev_page: t.Boolean()
});

const PaginatedBuildingSchema = t.Object({
    data: t.Array(BuildingSchema),
    metadata: PaginationMetadataSchema
});

const PaginatedUnitSchema = t.Object({
    data: t.Array(UnitSchema),
    metadata: PaginationMetadataSchema
});

const DeleteUnitsByBuildingResponse = t.Object({
    deletedCount: t.Number()
});

// Public routes — no auth required (used for registration flow)
export const buildingPublicRoutes = new Elysia({ prefix: '/buildings' })
    .get('/by-code/:code', async ({ params }) => {
        const { building } = await getBuildingByCode.execute(params.code);
        return building.toJSON();
    }, {
        detail: {
            tags: ['Buildings'],
            summary: 'Get building by QR code (public)',
            description: 'Lookup a building using its permanent QR code. Used in the resident self-registration flow.'
        }
    })
    .get('/by-code/:code/units', async ({ params }) => {
        const { units } = await getBuildingByCode.execute(params.code);
        return units.map(u => u.toJSON());
    }, {
        detail: {
            tags: ['Buildings'],
            summary: 'List units for a building by QR code (public)',
            description: 'Returns the list of units for a building identified by its QR code. Used to populate the registration form.'
        }
    })
    .get('/', async () => {
        const buildings = await getBuildings.execute();
        return buildings.map(b => b.toJSON());
    }, {
        response: t.Array(BuildingSchema),
        detail: {
            tags: ['Buildings'],
            summary: 'List all available buildings'
        }
    })
    .get('/:id', async ({ params }) => {
        const building = await getBuildingById.execute(params.id);
        return building.toJSON();
    }, {
        response: BuildingSchema,
        detail: {
            tags: ['Buildings'],
            summary: 'Get building by ID'
        }
    })
    .get('/:id/units', async ({ params }) => {
        const units = await getUnitsByBuilding.execute(params.id);
        return units.map(u => u.toJSON());
    }, {
        response: t.Array(UnitSchema),
        detail: {
            tags: ['Units'],
            summary: 'List units for a building'
        }
    })
    .get('/units/:id', async ({ params }) => {
        const unit = await getUnitById.execute(params.id);
        return unit.toJSON();
    }, {
        response: UnitSchema,
        detail: {
            tags: ['Units'],
            summary: 'Get unit by ID'
        }
    });

// Admin routes — auth required, Board+Admin only
export const buildingAdminRoutes = new Elysia({ prefix: '/buildings' })
    .derive(async ({ request }) => {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new UnauthorizedError('Authentication required');
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) throw new UnauthorizedError('Invalid token');
        return { user };
    })
    .get('/', async ({ query }) => {
        const result = await getBuildings.executePaginated({
            page: query.page,
            limit: query.limit,
        });
        return {
            data: result.data.map(b => b.toJSON()),
            metadata: result.metadata,
        };
    }, {
        query: t.Object({
            page: t.Optional(t.Numeric()),
            limit: t.Optional(t.Union([t.Numeric(), t.Literal('all')])),
        }),
        response: PaginatedBuildingSchema,
        detail: {
            tags: ['Admin - Buildings'],
            summary: 'List all buildings (Admin/Board, paginated)',
            security: [{ BearerAuth: [] }]
        }
    })
    .get('/:id/units', async ({ params, query }) => {
        const result = await getUnitsByBuilding.executePaginated(params.id, {
            page: query.page,
            limit: query.limit,
        });
        return {
            data: result.data.map(u => u.toJSON()),
            metadata: result.metadata,
        };
    }, {
        query: t.Object({
            page: t.Optional(t.Numeric()),
            limit: t.Optional(t.Union([t.Numeric(), t.Literal('all')])),
        }),
        response: PaginatedUnitSchema,
        detail: {
            tags: ['Admin - Buildings'],
            summary: 'List units for a building (Admin/Board, paginated)',
            security: [{ BearerAuth: [] }]
        }
    })
    .post('/', async ({ body, user }) => {
        return await createBuilding.execute({
            name: body.name,
            address: body.address,
            creatorId: user.id
        });
    }, {
        body: t.Object({
            name: t.String({ minLength: 1 }),
            address: t.String({ minLength: 1 }),
        }),
        response: BuildingSchema,
        detail: {
            tags: ['Admin - Buildings'],
            summary: 'Create a new building (Admin only)',
            security: [{ BearerAuth: [] }]
        }
    })
    .patch('/:id', async ({ params, body, user }) => {
        return await updateBuilding.execute({
            id: params.id,
            updaterId: user.id,
            name: body.name,
            address: body.address,
            default_rate_source: body.default_rate_source
        });
    }, {
        body: t.Object({
            name: t.Optional(t.String({ minLength: 1 })),
            address: t.Optional(t.String({ minLength: 1 })),
            default_rate_source: t.Optional(t.Union([
                t.Literal('euro_oficial'),
                t.Literal('dolar_oficial'),
                t.Literal('dolar_paralelo'),
            ])),
        }),
        response: BuildingSchema,
        detail: {
            tags: ['Admin - Buildings'],
            summary: 'Update a building (Admin only)',
            security: [{ BearerAuth: [] }]
        }
    })
    .post('/:id/units', async ({ params, body }) => {
        return await createUnit.execute({
            building_id: params.id,
            name: body.name,
            floor: body.floor,
            aliquot: body.aliquot
        });
    }, {
        body: t.Object({
            name: t.String({ minLength: 1 }),
            floor: t.Optional(t.String()),
            aliquot: t.Optional(t.Number())
        }),
        response: UnitSchema,
        detail: {
            tags: ['Admin - Buildings'],
            summary: 'Create a single unit (Admin only)',
            security: [{ BearerAuth: [] }]
        }
    })
    .post('/:id/units/batch', async ({ params, body }) => {
        const units = await batchCreateUnits.execute({
            building_id: params.id,
            floors: body.floors,
            unitsPerFloor: body.unitsPerFloor
        });
        return {
            count: units.length,
            units
        };
    }, {
        body: t.Object({
            floors: t.Array(t.String()),
            unitsPerFloor: t.Array(t.String())
        }),
        response: BatchUnitsResponse,
        detail: {
            tags: ['Admin - Buildings'],
            summary: 'Batch create units (Admin only)',
            security: [{ BearerAuth: [] }]
        }
    })
    .delete('/:id/units/:unitId', async ({ params, user }) => {
        await deleteUnit.execute({
            buildingId: params.id,
            unitId: params.unitId,
            deleterId: user.id
        });
        return { success: true };
    }, {
        response: t.Object({ success: t.Boolean() }),
        detail: {
            tags: ['Admin - Buildings'],
            summary: 'Delete one unit (Admin only)',
            security: [{ BearerAuth: [] }]
        }
    })
    .delete('/:id/units', async ({ params, query, user }) => {
        return await deleteUnitsByBuilding.execute({
            buildingId: params.id,
            deleterId: user.id,
            excludeIds: query.excludeIds
                ? query.excludeIds.split(',').map(v => v.trim()).filter(Boolean)
                : []
        });
    }, {
        query: t.Object({
            excludeIds: t.Optional(t.String()),
        }),
        response: DeleteUnitsByBuildingResponse,
        detail: {
            tags: ['Admin - Buildings'],
            summary: 'Delete units in a building (Admin only)',
            security: [{ BearerAuth: [] }]
        }
    });

// Legacy combined export (kept for backward compat if needed)
export const buildingRoutes = new Elysia({ prefix: '/buildings' })
    .use(buildingPublicRoutes)
    .use(buildingAdminRoutes);
