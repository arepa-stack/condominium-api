import { Elysia, t } from 'elysia';
import { requireRole } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';
import { ValidationError } from '@/core/errors';
import { assertDirectoryReadAccess } from './directory-access';
import { SupabaseBoardMemberRepository } from '../infrastructure/repositories/SupabaseBoardMemberRepository';
import { SupabaseResidentialWorkerRepository } from '../infrastructure/repositories/SupabaseResidentialWorkerRepository';
import { GetBoardMembersByBuilding } from '../application/use-cases/GetBoardMembersByBuilding';
import { GetResidentialWorkersByBuilding } from '../application/use-cases/GetResidentialWorkersByBuilding';

const boardMemberRepo = new SupabaseBoardMemberRepository();
const workerRepo = new SupabaseResidentialWorkerRepository();
const getBoardMembersByBuilding = new GetBoardMembersByBuilding(boardMemberRepo);
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

/**
 * App: lectura del directorio (junta vigente + personal activo).
 * Prefijo final: /api/v1/app/directory/...
 */
export const directoryAppRoutes = new Elysia({ prefix: '/directory' })
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD, UserRole.RESIDENT]))
    .get('/board-members', async ({ query, profile }) => {
        const buildingId = query.building_id;
        if (!buildingId || typeof buildingId !== 'string') {
            throw new ValidationError('building_id query parameter is required');
        }
        await assertDirectoryReadAccess(profile, buildingId);
        const list = await getBoardMembersByBuilding.execute({
            buildingId,
            publicView: true,
        });
        return list.map((m) => m.toJSON());
    }, {
        query: t.Object({
            building_id: t.String({ minLength: 1 }),
        }),
        response: t.Array(BoardMemberSchema),
        detail: {
            tags: ['App - Directory'],
            summary: 'List current active board members for a building',
            security: [{ BearerAuth: [] }],
        },
    })
    .get('/workers', async ({ query, profile }) => {
        const buildingId = query.building_id;
        if (!buildingId || typeof buildingId !== 'string') {
            throw new ValidationError('building_id query parameter is required');
        }
        await assertDirectoryReadAccess(profile, buildingId);
        const list = await getResidentialWorkersByBuilding.execute({
            buildingId,
            publicView: true,
        });
        return list.map((w) => w.toJSON());
    }, {
        query: t.Object({
            building_id: t.String({ minLength: 1 }),
        }),
        response: t.Array(ResidentialWorkerSchema),
        detail: {
            tags: ['App - Directory'],
            summary: 'List active residential workers for a building',
            security: [{ BearerAuth: [] }],
        },
    });
