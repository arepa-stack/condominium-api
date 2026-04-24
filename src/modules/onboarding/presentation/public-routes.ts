import { Elysia, t } from 'elysia';
import { SupabaseRegistrationRequestRepository } from '../infrastructure/repositories/SupabaseRegistrationRequestRepository';
import { SupabaseUnitInvitationRepository } from '../infrastructure/repositories/SupabaseUnitInvitationRepository';
import { SupabaseBuildingRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseBuildingRepository';
import { SupabaseUnitRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseUnitRepository';
import { SupabaseUserRepository } from '@/modules/users/infrastructure/repositories/SupabaseUserRepository';
import { SubmitRegistrationRequest } from '../application/use-cases/SubmitRegistrationRequest';
import { AcceptUnitInvitation } from '../application/use-cases/AcceptUnitInvitation';
import { GetInvitationMetadata } from '../application/use-cases/GetInvitationMetadata';
import { emailService } from '@/infrastructure/email';

const requestRepo = new SupabaseRegistrationRequestRepository();
const invitationRepo = new SupabaseUnitInvitationRepository();
const buildingRepo = new SupabaseBuildingRepository();
const unitRepo = new SupabaseUnitRepository();
const userRepo = new SupabaseUserRepository();

const submitRequest = new SubmitRegistrationRequest(requestRepo, buildingRepo, unitRepo, emailService);
const acceptInvitation = new AcceptUnitInvitation(invitationRepo, requestRepo, unitRepo, buildingRepo, emailService);
const getInvitationMeta = new GetInvitationMetadata(invitationRepo, unitRepo, buildingRepo, userRepo);

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
    created_at: t.Any()
});

export const onboardingPublicRoutes = new Elysia()
    .post('/registration-requests', async ({ body }) => {
        const result = await submitRequest.execute({
            buildingCode: body.buildingCode,
            unitId: body.unitId,
            email: body.email,
            firstName: body.firstName,
            lastName: body.lastName,
            documentId: body.documentId,
            phone: body.phone,
        });
        return result.toJSON();
    }, {
        body: t.Object({
            buildingCode: t.String({ minLength: 1, examples: ['COND-ABCD1234'] }),
            unitId: t.String({ format: 'uuid' }),
            email: t.String({ format: 'email' }),
            firstName: t.String({ minLength: 1 }),
            lastName: t.String({ minLength: 1 }),
            documentId: t.String({ minLength: 1 }),
            phone: t.Optional(t.String()),
        }),
        response: RegistrationRequestResponse,
        detail: {
            tags: ['Onboarding - Public'],
            summary: 'Submit a registration request (via QR)',
            description: 'Public endpoint used when a resident scans the building QR code and fills in the form. The Board is notified by email.'
        }
    })
    .get('/invitations/:token', async ({ params }) => {
        return await getInvitationMeta.execute(params.token);
    }, {
        detail: {
            tags: ['Onboarding - Public'],
            summary: 'Get invitation metadata by token',
            description: 'Returns public metadata about an invitation (inviter name, unit, building, expiry). Used to pre-fill the accept form.'
        }
    })
    .post('/invitations/:token/accept', async ({ params, body }) => {
        const result = await acceptInvitation.execute({
            token: params.token,
            firstName: body.firstName,
            lastName: body.lastName,
            documentId: body.documentId,
            phone: body.phone,
        });
        return result.toJSON();
    }, {
        body: t.Object({
            firstName: t.String({ minLength: 1 }),
            lastName: t.String({ minLength: 1 }),
            documentId: t.String({ minLength: 1 }),
            phone: t.Optional(t.String()),
        }),
        response: RegistrationRequestResponse,
        detail: {
            tags: ['Onboarding - Public'],
            summary: 'Accept a unit invitation',
            description: 'Claims the invitation token, creates a pending registration request, and notifies the Board.'
        }
    });
