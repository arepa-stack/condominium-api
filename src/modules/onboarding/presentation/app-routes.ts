import { Elysia, t } from 'elysia';
import { SupabaseRegistrationRequestRepository } from '../infrastructure/repositories/SupabaseRegistrationRequestRepository';
import { SupabaseUnitInvitationRepository } from '../infrastructure/repositories/SupabaseUnitInvitationRepository';
import { SupabaseBuildingRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseBuildingRepository';
import { SupabaseUnitRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseUnitRepository';
import { SupabaseUserRepository } from '@/modules/users/infrastructure/repositories/SupabaseUserRepository';
import { CreateUnitInvitation } from '../application/use-cases/CreateUnitInvitation';
import { emailService } from '@/infrastructure/email';
import { requireRole } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';
import { DomainError, NotFoundError } from '@/core/errors';

const requestRepo = new SupabaseRegistrationRequestRepository();
const invitationRepo = new SupabaseUnitInvitationRepository();
const buildingRepo = new SupabaseBuildingRepository();
const unitRepo = new SupabaseUnitRepository();
const userRepo = new SupabaseUserRepository();

const createInvitation = new CreateUnitInvitation(invitationRepo, requestRepo, userRepo, unitRepo, buildingRepo, emailService);

const InvitationResponse = t.Object({
    id: t.String(),
    unit_id: t.String(),
    building_id: t.String(),
    inviter_profile_id: t.String(),
    invitee_email: t.String(),
    invitee_name: t.Optional(t.Union([t.String(), t.Null()])),
    token: t.String(),
    status: t.String(),
    expires_at: t.Any(),
    claimed_at: t.Optional(t.Any()),
    created_at: t.Any()
});

export const onboardingAppRoutes = new Elysia({ prefix: '/unit-invitations' })
    .use(requireRole([UserRole.RESIDENT, UserRole.BOARD, UserRole.ADMIN]))
    .post('/', async ({ profile, body }) => {
        const result = await createInvitation.execute({
            inviterProfileId: profile.id,
            inviteeEmail: body.invitee_email,
            inviteeName: body.invitee_name,
        });
        return result.toJSON();
    }, {
        body: t.Object({
            invitee_email: t.String({ format: 'email' }),
            invitee_name: t.Optional(t.String()),
        }),
        response: InvitationResponse,
        detail: {
            tags: ['App - Onboarding'],
            summary: 'Invite someone to your unit',
            description: 'Sends an email invitation to the given address. The invitee fills a form and the Board approves the resulting request.',
            security: [{ BearerAuth: [] }]
        }
    })
    .get('/', async ({ profile }) => {
        const invitations = await invitationRepo.findByInviter(profile.id);
        return invitations.map(i => i.toJSON());
    }, {
        response: t.Array(InvitationResponse),
        detail: {
            tags: ['App - Onboarding'],
            summary: 'List my sent invitations',
            security: [{ BearerAuth: [] }]
        }
    })
    .delete('/:id', async ({ profile, params }) => {
        const invitation = await invitationRepo.findById(params.id);
        if (!invitation) throw new NotFoundError('Invitation not found');
        if (invitation.inviter_profile_id !== profile.id && profile.app_role !== 'admin') {
            throw new DomainError('You are not allowed to cancel this invitation', 'FORBIDDEN', 403);
        }
        if (!invitation.isPending()) {
            throw new DomainError('Only pending invitations can be cancelled', 'INVALID_STATE', 409);
        }
        invitation.cancel();
        await invitationRepo.update(invitation);
        return { success: true };
    }, {
        response: t.Object({ success: t.Boolean() }),
        detail: {
            tags: ['App - Onboarding'],
            summary: 'Cancel a sent invitation',
            security: [{ BearerAuth: [] }]
        }
    });
