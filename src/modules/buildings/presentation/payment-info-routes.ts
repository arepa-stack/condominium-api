import { Elysia, t } from 'elysia';
import { UserRole } from '@/core/domain/enums';
import { requireRole, AuthProfile } from '@/core/presentation/guards';
import { SupabaseInformationCenterRepository } from '@/modules/information-center/infrastructure/repositories/SupabaseInformationCenterRepository';
import { InformationCenterCaller } from '@/modules/information-center/application/access';
import { SupabaseBuildingPaymentInfoRepository } from '../infrastructure/repositories/SupabaseBuildingPaymentInfoRepository';
import { PaymentQrStorageService } from '../infrastructure/services/PaymentQrStorageService';
import { GetBuildingPaymentInfo, UpdateBuildingPaymentInfo } from '../application/use-cases/BuildingPaymentInfo';

const repo = new SupabaseBuildingPaymentInfoRepository();
const storage = new PaymentQrStorageService();
const membershipRepo = new SupabaseInformationCenterRepository();
const getPaymentInfo = new GetBuildingPaymentInfo(repo, storage);
const updatePaymentInfo = new UpdateBuildingPaymentInfo(repo, storage);

const NullableString = t.Union([t.String(), t.Null()]);

const PaymentInfoSchema = t.Object({
    bank_name: NullableString,
    bank_code: NullableString,
    account_holder: NullableString,
    rif: NullableString,
    account_number: NullableString,
    pago_movil_phone: NullableString,
    email: NullableString,
    qr_url: NullableString,
    configured: t.Boolean(),
});

const UpdatePaymentInfoBody = t.Object({
    bank_name: t.Optional(t.String()),
    bank_code: t.Optional(t.String()),
    account_holder: t.Optional(t.String()),
    rif: t.Optional(t.String()),
    account_number: t.Optional(t.String()),
    pago_movil_phone: t.Optional(t.String()),
    email: t.Optional(t.String()),
    qr: t.Optional(t.File()),
    remove_qr: t.Optional(t.BooleanString()),
});

async function buildCaller(profile: AuthProfile): Promise<InformationCenterCaller> {
    return {
        userId: profile.id,
        appRole: profile.app_role,
        boardBuildingIds: profile.boardBuildingIds,
        residentBuildingIds: await membershipRepo.findResidentBuildingIds(profile.id),
    };
}

const getRoute = (tag: string) => ({
    params: t.Object({ id: t.String({ format: 'uuid' }) }),
    response: PaymentInfoSchema,
    detail: { tags: [tag], summary: "Get the building's payment details (bank account, Pago Móvil, QR)", security: [{ BearerAuth: [] }] },
});

// Residents read the details on "Pagar ahora"; board members of the building and admins too.
export const buildingPaymentInfoAppRoutes = new Elysia({ prefix: '/buildings' })
    .use(requireRole([UserRole.RESIDENT, UserRole.BOARD, UserRole.ADMIN]))
    .get('/:id/payment-info', async ({ profile, params }) => {
        return getPaymentInfo.execute(await buildCaller(profile), params.id);
    }, getRoute('App - Buildings'));

export const buildingPaymentInfoAdminRoutes = new Elysia({ prefix: '/buildings' })
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
    .get('/:id/payment-info', async ({ profile, params }) => {
        return getPaymentInfo.execute(await buildCaller(profile), params.id);
    }, getRoute('Admin - Buildings'))
    .put('/:id/payment-info', async ({ profile, params, body }) => {
        const { qr, remove_qr, ...fields } = body;
        return updatePaymentInfo.execute({
            caller: await buildCaller(profile),
            buildingId: params.id,
            fields,
            qr: qr ? { name: qr.name, bytes: new Uint8Array(await qr.arrayBuffer()), mime: qr.type } : undefined,
            removeQr: remove_qr,
        });
    }, {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: UpdatePaymentInfoBody,
        type: 'multipart/form-data',
        response: PaymentInfoSchema,
        detail: {
            tags: ['Admin - Buildings'],
            summary: "Replace the building's payment details. Omitted or blank fields are cleared; `qr` replaces the image, `remove_qr=true` deletes it.",
            security: [{ BearerAuth: [] }],
        },
    });
