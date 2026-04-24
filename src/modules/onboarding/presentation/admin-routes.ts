import { Elysia, t } from 'elysia';
import { SupabaseRegistrationRequestRepository } from '../infrastructure/repositories/SupabaseRegistrationRequestRepository';
import { SupabaseBuildingRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseBuildingRepository';
import { SupabaseUnitRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseUnitRepository';
import { SupabaseAuthRepository } from '@/modules/auth/infrastructure/repositories/SupabaseAuthRepository';
import { SupabaseUserRepository } from '@/modules/users/infrastructure/repositories/SupabaseUserRepository';
import { ApproveRegistrationRequest } from '../application/use-cases/ApproveRegistrationRequest';
import { RejectRegistrationRequest } from '../application/use-cases/RejectRegistrationRequest';
import { ListRegistrationRequests } from '../application/use-cases/ListRegistrationRequests';
import { emailService } from '@/infrastructure/email';
import { requireRole } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';

const requestRepo = new SupabaseRegistrationRequestRepository();
const buildingRepo = new SupabaseBuildingRepository();
const unitRepo = new SupabaseUnitRepository();
const authRepo = new SupabaseAuthRepository();
const userRepo = new SupabaseUserRepository();

const approveRequest = new ApproveRegistrationRequest(requestRepo, buildingRepo, unitRepo, authRepo, userRepo, emailService);
const rejectRequest = new RejectRegistrationRequest(requestRepo, buildingRepo, emailService);
const listRequests = new ListRegistrationRequests(requestRepo);

const RegistrationRequestResponse = t.Object({
    id: t.String(),
    building_id: t.String(),
    unit_id: t.String(),
    email: t.String(),
    first_name: t.String(),
    last_name: t.String(),
    document_id: t.String(),
    phone: t.Optional(t.Union([t.String(), t.Null()])),
    source: t.Union([t.Literal('qr'), t.Literal('invitation')]),
    status: t.String(),
    invited_by_profile_id: t.Optional(t.Union([t.String(), t.Null()])),
    invitation_id: t.Optional(t.Union([t.String(), t.Null()])),
    reviewed_by_profile_id: t.Optional(t.Union([t.String(), t.Null()])),
    reviewed_at: t.Optional(t.Any()),
    rejection_reason: t.Optional(t.Union([t.String(), t.Null()])),
    created_at: t.Any()
});

export const onboardingAdminRoutes = new Elysia({ prefix: '/registration-requests' })
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
    .get('/', async ({ profile, query }) => {
        const results = await listRequests.execute({
            requesterAppRole: profile.app_role,
            requesterBoardBuildingIds: profile.boardBuildingIds,
            buildingId: query.building_id,
            status: query.status as any,
        });
        return results.map(r => r.toJSON());
    }, {
        query: t.Object({
            building_id: t.Optional(t.String()),
            status: t.Optional(t.Union([
                t.Literal('pending'),
                t.Literal('approved'),
                t.Literal('rejected')
            ])),
        }),
        response: t.Array(RegistrationRequestResponse),
        detail: {
            tags: ['Admin - Onboarding'],
            summary: 'List registration requests (Admin/Board)',
            security: [{ BearerAuth: [] }]
        }
    })
    .post('/:id/approve', async ({ profile, params }) => {
        await approveRequest.execute({
            requestId: params.id,
            reviewerId: profile.id,
            reviewerBoardBuildingIds: profile.boardBuildingIds,
            reviewerAppRole: profile.app_role,
        });
        return { success: true };
    }, {
        response: t.Object({ success: t.Boolean() }),
        detail: {
            tags: ['Admin - Onboarding'],
            summary: 'Approve a registration request',
            description: 'Creates the resident profile, assigns the unit, and sends credentials by email.',
            security: [{ BearerAuth: [] }]
        }
    })
    .post('/:id/reject', async ({ profile, params, body }) => {
        await rejectRequest.execute({
            requestId: params.id,
            reviewerId: profile.id,
            reviewerBoardBuildingIds: profile.boardBuildingIds,
            reviewerAppRole: profile.app_role,
            reason: body.reason,
        });
        return { success: true };
    }, {
        body: t.Object({
            reason: t.Optional(t.String()),
        }),
        response: t.Object({ success: t.Boolean() }),
        detail: {
            tags: ['Admin - Onboarding'],
            summary: 'Reject a registration request',
            security: [{ BearerAuth: [] }]
        }
    });
