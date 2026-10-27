import {
    IBuildingPaymentInfoRepository,
    IPaymentQrStorage,
    PaymentQrFile,
} from '../../domain/repository';
import {
    PaymentInfo,
    PaymentInfoField,
    PaymentInfoFields,
    normalizePaymentInfoFields,
} from '../../domain/entities/PaymentInfo';
import {
    InformationCenterCaller as BuildingCaller,
    ensureCanManageBuilding,
    ensureCanReadBuilding,
} from '@/modules/information-center/application/access';

export interface PaymentInfoView extends PaymentInfoFields {
    qr_url: string | null;
    // False until a board member or admin fills at least one field or uploads a QR.
    configured: boolean;
}

export interface UpdatePaymentInfoDTO {
    caller: BuildingCaller;
    buildingId: string;
    fields: Partial<Record<PaymentInfoField, string | null | undefined>>;
    qr?: PaymentQrFile;
    removeQr?: boolean;
}

async function toView(info: PaymentInfo | null, storage: IPaymentQrStorage): Promise<PaymentInfoView> {
    const fields = normalizePaymentInfoFields(info ?? {});
    const qrPath = info?.qr_path ?? null;
    const configured = qrPath !== null || Object.values(fields).some(value => value !== null);
    return { ...fields, qr_url: await storage.signedUrl(qrPath), configured };
}

export class GetBuildingPaymentInfo {
    constructor(private repo: IBuildingPaymentInfoRepository, private storage: IPaymentQrStorage) { }

    async execute(caller: BuildingCaller, buildingId: string): Promise<PaymentInfoView> {
        ensureCanReadBuilding(caller, buildingId);
        return toView(await this.repo.find(buildingId), this.storage);
    }
}

export class UpdateBuildingPaymentInfo {
    constructor(private repo: IBuildingPaymentInfoRepository, private storage: IPaymentQrStorage) { }

    async execute(dto: UpdatePaymentInfoDTO): Promise<PaymentInfoView> {
        ensureCanManageBuilding(dto.caller, dto.buildingId);
        const fields = normalizePaymentInfoFields(dto.fields);
        const current = await this.repo.find(dto.buildingId);
        const oldQr = current?.qr_path ?? null;

        let qrPath = oldQr;
        if (dto.qr) qrPath = await this.storage.upload(dto.buildingId, dto.qr);
        else if (dto.removeQr) qrPath = null;

        const info: PaymentInfo = { ...fields, qr_path: qrPath };
        await this.repo.save(dto.buildingId, info);
        // Old file goes only after the row points elsewhere, so a failed save never leaves a dangling path.
        if (oldQr && oldQr !== qrPath) await this.storage.remove(oldQr);
        return toView(info, this.storage);
    }
}
