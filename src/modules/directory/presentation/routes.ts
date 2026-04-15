import { Elysia, t } from 'elysia';
import { requireRole, requireBuildingAccess } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';
import { NotFoundError } from '@/core/errors';
import { SupabaseBoardMemberRepository } from '../infrastructure/repositories/SupabaseBoardMemberRepository';
import { SupabaseResidentialWorkerRepository } from '../infrastructure/repositories/SupabaseResidentialWorkerRepository';
import { CreateBoardMember } from '../application/use-cases/CreateBoardMember';
import { UpdateBoardMember } from '../application/use-cases/UpdateBoardMember';
import { DeleteBoardMember } from '../application/use-cases/DeleteBoardMember';
import { GetBoardMembersByBuilding } from '../application/use-cases/GetBoardMembersByBuilding';
import { CreateResidentialWorker } from '../application/use-cases/CreateResidentialWorker';
import { UpdateResidentialWorker } from '../application/use-cases/UpdateResidentialWorker';
import { DeleteResidentialWorker } from '../application/use-cases/DeleteResidentialWorker';
import { GetResidentialWorkersByBuilding } from '../application/use-cases/GetResidentialWorkersByBuilding';
import { SupabaseUserRepository } from '@/modules/users/infrastructure/repositories/SupabaseUserRepository';

const boardMemberRepo = new SupabaseBoardMemberRepository();
const workerRepo = new SupabaseResidentialWorkerRepository();
const directoryUserRepo = new SupabaseUserRepository();

const createBoardMember = new CreateBoardMember(boardMemberRepo, directoryUserRepo);
const updateBoardMember = new UpdateBoardMember(boardMemberRepo);
const deleteBoardMember = new DeleteBoardMember(boardMemberRepo);
const getBoardMembersByBuilding = new GetBoardMembersByBuilding(boardMemberRepo);

const createResidentialWorker = new CreateResidentialWorker(workerRepo);
const updateResidentialWorker = new UpdateResidentialWorker(workerRepo);
const deleteResidentialWorker = new DeleteResidentialWorker(workerRepo);
const getResidentialWorkersByBuilding = new GetResidentialWorkersByBuilding(workerRepo);

const BoardMemberSchema = t.Object({
    id: t.String(),
    building_id: t.String(),
    first_name: t.String(),
    last_name: t.String(),
    role: t.String(),
    phone: t.Union([t.String(), t.Null()]),
    email: t.Union([t.String(), t.Null()]),
    apartment_number: t.Union([t.String(), t.Null()]),
    photo_url: t.Union([t.String(), t.Null()]),
    is_active: t.Boolean(),
    is_current_board: t.Boolean(),
    profile_id: t.Optional(t.Union([t.String(), t.Null()])),
    created_at: t.Optional(t.Any()),
    updated_at: t.Optional(t.Any()),
});

const ResidentialWorkerSchema = t.Object({
    id: t.String(),
    building_id: t.String(),
    first_name: t.String(),
    last_name: t.String(),
    role: t.String(),
    phone: t.Union([t.String(), t.Null()]),
    photo_url: t.Union([t.String(), t.Null()]),
    work_schedule: t.Union([t.String(), t.Null()]),
    is_active: t.Boolean(),
    created_at: t.Optional(t.Any()),
    updated_at: t.Optional(t.Any()),
});

async function assertBoardMemberInBuilding(buildingId: string, memberId: string) {
    const existing = await boardMemberRepo.findById(memberId);
    if (!existing || existing.building_id !== buildingId) {
        throw new NotFoundError('Board member not found');
    }
    return existing;
}

async function assertWorkerInBuilding(buildingId: string, workerId: string) {
    const existing = await workerRepo.findById(workerId);
    if (!existing || existing.building_id !== buildingId) {
        throw new NotFoundError('Residential worker not found');
    }
    return existing;
}

/**
 * Admin: CRUD del directorio por edificio (requiere rol admin/board y pertenencia al edificio).
 * Prefijo final: /api/v1/admin/directory/...
 */
export const directoryAdminRoutes = new Elysia({ prefix: '/directory' })
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
    .use(requireBuildingAccess((ctx) => ctx.params.buildingId, 'directory-admin-building'))
    .get('/buildings/:buildingId/board-members', async ({ params }) => {
        const list = await getBoardMembersByBuilding.execute({
            buildingId: params.buildingId,
            publicView: false,
        });
        return list.map((m) => m.toJSON());
    }, {
        response: t.Array(BoardMemberSchema),
        detail: {
            tags: ['Admin - Directory'],
            summary: 'List board members for a building (includes inactive)',
            security: [{ BearerAuth: [] }],
        },
    })
    .post('/buildings/:buildingId/board-members', async ({ params, body }) => {
        const created = await createBoardMember.execute({
            building_id: params.buildingId,
            first_name: body.first_name,
            last_name: body.last_name,
            role: body.role,
            phone: body.phone,
            email: body.email,
            apartment_number: body.apartment_number,
            photo_url: body.photo_url,
            is_current_board: body.is_current_board,
            profile_id: body.profile_id,
        });
        return created.toJSON();
    }, {
        body: t.Object({
            first_name: t.Optional(t.String({ minLength: 1 })),
            last_name: t.Optional(t.String({ minLength: 1 })),
            role: t.String({ minLength: 1 }),
            phone: t.Optional(t.Union([t.String(), t.Null()])),
            email: t.Optional(t.Union([t.String(), t.Null()])),
            apartment_number: t.Optional(t.Union([t.String(), t.Null()])),
            photo_url: t.Optional(t.Union([t.String(), t.Null()])),
            is_current_board: t.Optional(t.Boolean()),
            profile_id: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        response: BoardMemberSchema,
        detail: {
            tags: ['Admin - Directory'],
            summary: 'Create board member',
            security: [{ BearerAuth: [] }],
        },
    })
    .patch('/buildings/:buildingId/board-members/:memberId', async ({ params, body }) => {
        await assertBoardMemberInBuilding(params.buildingId, params.memberId);
        const updated = await updateBoardMember.execute({
            id: params.memberId,
            first_name: body.first_name,
            last_name: body.last_name,
            role: body.role,
            phone: body.phone,
            email: body.email,
            apartment_number: body.apartment_number,
            photo_url: body.photo_url,
            is_active: body.is_active,
            is_current_board: body.is_current_board,
            profile_id: body.profile_id,
        });
        return updated.toJSON();
    }, {
        body: t.Object({
            first_name: t.Optional(t.String({ minLength: 1 })),
            last_name: t.Optional(t.String({ minLength: 1 })),
            role: t.Optional(t.String({ minLength: 1 })),
            phone: t.Optional(t.Union([t.String(), t.Null()])),
            email: t.Optional(t.Union([t.String(), t.Null()])),
            apartment_number: t.Optional(t.Union([t.String(), t.Null()])),
            photo_url: t.Optional(t.Union([t.String(), t.Null()])),
            is_active: t.Optional(t.Boolean()),
            is_current_board: t.Optional(t.Boolean()),
            profile_id: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        response: BoardMemberSchema,
        detail: {
            tags: ['Admin - Directory'],
            summary: 'Update board member',
            security: [{ BearerAuth: [] }],
        },
    })
    .delete('/buildings/:buildingId/board-members/:memberId', async ({ params }) => {
        await assertBoardMemberInBuilding(params.buildingId, params.memberId);
        const updated = await deleteBoardMember.execute(params.memberId);
        return updated.toJSON();
    }, {
        response: BoardMemberSchema,
        detail: {
            tags: ['Admin - Directory'],
            summary: 'Deactivate board member (soft delete)',
            security: [{ BearerAuth: [] }],
        },
    })
    .get('/buildings/:buildingId/workers', async ({ params }) => {
        const list = await getResidentialWorkersByBuilding.execute({
            buildingId: params.buildingId,
            publicView: false,
        });
        return list.map((w) => w.toJSON());
    }, {
        response: t.Array(ResidentialWorkerSchema),
        detail: {
            tags: ['Admin - Directory'],
            summary: 'List residential workers for a building (includes inactive)',
            security: [{ BearerAuth: [] }],
        },
    })
    .post('/buildings/:buildingId/workers', async ({ params, body }) => {
        const created = await createResidentialWorker.execute({
            building_id: params.buildingId,
            first_name: body.first_name,
            last_name: body.last_name,
            role: body.role,
            phone: body.phone,
            photo_url: body.photo_url,
            work_schedule: body.work_schedule,
        });
        return created.toJSON();
    }, {
        body: t.Object({
            first_name: t.String({ minLength: 1 }),
            last_name: t.String({ minLength: 1 }),
            role: t.String({ minLength: 1 }),
            phone: t.Optional(t.Union([t.String(), t.Null()])),
            photo_url: t.Optional(t.Union([t.String(), t.Null()])),
            work_schedule: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        response: ResidentialWorkerSchema,
        detail: {
            tags: ['Admin - Directory'],
            summary: 'Create residential worker',
            security: [{ BearerAuth: [] }],
        },
    })
    .patch('/buildings/:buildingId/workers/:workerId', async ({ params, body }) => {
        await assertWorkerInBuilding(params.buildingId, params.workerId);
        const updated = await updateResidentialWorker.execute({
            id: params.workerId,
            first_name: body.first_name,
            last_name: body.last_name,
            role: body.role,
            phone: body.phone,
            photo_url: body.photo_url,
            work_schedule: body.work_schedule,
            is_active: body.is_active,
        });
        return updated.toJSON();
    }, {
        body: t.Object({
            first_name: t.Optional(t.String({ minLength: 1 })),
            last_name: t.Optional(t.String({ minLength: 1 })),
            role: t.Optional(t.String({ minLength: 1 })),
            phone: t.Optional(t.Union([t.String(), t.Null()])),
            photo_url: t.Optional(t.Union([t.String(), t.Null()])),
            work_schedule: t.Optional(t.Union([t.String(), t.Null()])),
            is_active: t.Optional(t.Boolean()),
        }),
        response: ResidentialWorkerSchema,
        detail: {
            tags: ['Admin - Directory'],
            summary: 'Update residential worker',
            security: [{ BearerAuth: [] }],
        },
    })
    .delete('/buildings/:buildingId/workers/:workerId', async ({ params }) => {
        await assertWorkerInBuilding(params.buildingId, params.workerId);
        const updated = await deleteResidentialWorker.execute(params.workerId);
        return updated.toJSON();
    }, {
        response: ResidentialWorkerSchema,
        detail: {
            tags: ['Admin - Directory'],
            summary: 'Deactivate residential worker (soft delete)',
            security: [{ BearerAuth: [] }],
        },
    });
