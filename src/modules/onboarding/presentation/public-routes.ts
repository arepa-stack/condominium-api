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
            buildingCode: body.building_code,
            unitId: body.unit_id,
            email: body.email,
            firstName: body.first_name,
            lastName: body.last_name,
            documentId: body.document_id,
            phone: body.phone,
        });
        return result.toJSON();
    }, {
        body: t.Object({
            building_code: t.String({ minLength: 1, examples: ['COND-ABCD1234'] }),
            unit_id: t.String({ format: 'uuid' }),
            email: t.String({ format: 'email' }),
            first_name: t.String({ minLength: 1 }),
            last_name: t.String({ minLength: 1 }),
            document_id: t.String({ minLength: 1 }),
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
        const meta = await getInvitationMeta.execute(params.token);
        return {
            inviter_name: meta.inviterName,
            unit_name: meta.unitName,
            building_name: meta.buildingName,
            expires_at: meta.expiresAt,
            is_valid: meta.isValid,
        };
    }, {
        response: t.Object({
            inviter_name: t.String(),
            unit_name: t.String(),
            building_name: t.String(),
            expires_at: t.Any(),
            is_valid: t.Boolean(),
        }),
        detail: {
            tags: ['Onboarding - Public'],
            summary: 'Get invitation metadata by token',
            description: 'Returns public metadata about an invitation (inviter name, unit, building, expiry). Used to pre-fill the accept form.'
        }
    })
    .post('/invitations/:token/accept', async ({ params, body }) => {
        const result = await acceptInvitation.execute({
            token: params.token,
            firstName: body.first_name,
            lastName: body.last_name,
            documentId: body.document_id,
            phone: body.phone,
        });
        return result.toJSON();
    }, {
        body: t.Object({
            first_name: t.String({ minLength: 1 }),
            last_name: t.String({ minLength: 1 }),
            document_id: t.String({ minLength: 1 }),
            phone: t.Optional(t.String()),
        }),
        response: RegistrationRequestResponse,
        detail: {
            tags: ['Onboarding - Public'],
            summary: 'Accept a unit invitation',
            description: 'Claims the invitation token, creates a pending registration request, and notifies the Board.'
        }
    });
