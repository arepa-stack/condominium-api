import { describe, it, expect, beforeEach } from 'bun:test';
import { GetBuildingPaymentInfo, UpdateBuildingPaymentInfo } from '@/modules/buildings/application/use-cases/BuildingPaymentInfo';
import { IBuildingPaymentInfoRepository, IPaymentQrStorage, PaymentQrFile } from '@/modules/buildings/domain/repository';
import { PaymentInfo } from '@/modules/buildings/domain/entities/PaymentInfo';
import { ForbiddenError, ValidationError } from '@/core/errors';

class MemoryRepo implements IBuildingPaymentInfoRepository {
    rows = new Map<string, PaymentInfo | null>([['b-1', null]]);
    async find(id: string) { return this.rows.get(id) ?? null; }
    async save(id: string, info: PaymentInfo) { this.rows.set(id, info); }
}

class MemoryStorage implements IPaymentQrStorage {
    files = new Set<string>();
    async upload(buildingId: string, file: PaymentQrFile) {
        const path = `payment-qr/${buildingId}/${this.files.size}-${file.name}`;
        this.files.add(path);
        return path;
    }
    async remove(path: string) { this.files.delete(path); }
    async signedUrl(path: string | null) { return path ? `signed://${path}` : null; }
}

const caller = (overrides: Partial<{ appRole: string; boardBuildingIds: string[]; residentBuildingIds: string[] }> = {}) => ({
    userId: 'u-1',
    appRole: 'user',
    boardBuildingIds: [],
    residentBuildingIds: [],
    ...overrides,
});
const board = caller({ boardBuildingIds: ['b-1'] });
const qrFile = (name: string): PaymentQrFile => ({ name, bytes: new Uint8Array([1]), mime: 'image/png' });

const GRANADA = {
    bank_name: 'Bancaribe',
    bank_code: '0114',
    account_holder: 'Edificio Residencias Granada',
    rif: 'J-315383128',
    account_number: '0114-0184-8618-4005-4353',
    pago_movil_phone: '0412-3870654',
    email: 'condominio.granada2026@gmail.com',
};

describe('Building payment info', () => {
    let repo: MemoryRepo;
    let storage: MemoryStorage;
    let get: GetBuildingPaymentInfo;
    let update: UpdateBuildingPaymentInfo;

    beforeEach(() => {
        repo = new MemoryRepo();
        storage = new MemoryStorage();
        get = new GetBuildingPaymentInfo(repo, storage);
        update = new UpdateBuildingPaymentInfo(repo, storage);
    });

    it('returns an unconfigured, all-null view before anything is saved', async () => {
        const view = await get.execute(caller({ residentBuildingIds: ['b-1'] }), 'b-1');
        expect(view.configured).toBe(false);
        expect(view.bank_name).toBeNull();
        expect(view.qr_url).toBeNull();
    });

    it('lets the board save details and a QR that residents then read', async () => {
        await update.execute({ caller: board, buildingId: 'b-1', fields: { ...GRANADA, rif: '  J-315383128 ' }, qr: qrFile('qr.png') });

        const view = await get.execute(caller({ residentBuildingIds: ['b-1'] }), 'b-1');
        expect(view.configured).toBe(true);
        expect(view.rif).toBe('J-315383128');
        expect(view.account_number).toBe('0114-0184-8618-4005-4353');
        expect(view.qr_url).toStartWith('signed://payment-qr/b-1/');
    });

    it('keeps the QR when a later save sends no file, replaces it on a new upload and deletes it on remove_qr', async () => {
        await update.execute({ caller: board, buildingId: 'b-1', fields: GRANADA, qr: qrFile('a.png') });
        const first = repo.rows.get('b-1')!.qr_path!;

        await update.execute({ caller: board, buildingId: 'b-1', fields: GRANADA });
        expect(repo.rows.get('b-1')!.qr_path).toBe(first);

        await update.execute({ caller: board, buildingId: 'b-1', fields: GRANADA, qr: qrFile('b.png') });
        const second = repo.rows.get('b-1')!.qr_path!;
        expect(second).not.toBe(first);
        expect(storage.files.has(first)).toBe(false);

        await update.execute({ caller: board, buildingId: 'b-1', fields: GRANADA, removeQr: true });
        expect(repo.rows.get('b-1')!.qr_path).toBeNull();
        expect(storage.files.size).toBe(0);
    });

    it('clears blank fields', async () => {
        await update.execute({ caller: board, buildingId: 'b-1', fields: GRANADA });
        await update.execute({ caller: board, buildingId: 'b-1', fields: { ...GRANADA, email: '   ', pago_movil_phone: undefined } });
        const saved = repo.rows.get('b-1')!;
        expect(saved.email).toBeNull();
        expect(saved.pago_movil_phone).toBeNull();
    });

    it('rejects malformed account, bank code, phone and email', async () => {
        for (const bad of [
            { account_number: '0114-0184' },
            { bank_code: '114' },
            { pago_movil_phone: '0412-387' },
            { email: 'no-at-sign' },
        ]) {
            await expect(update.execute({ caller: board, buildingId: 'b-1', fields: { ...GRANADA, ...bad } }))
                .rejects.toBeInstanceOf(ValidationError);
        }
        expect(repo.rows.get('b-1')).toBeNull();
    });

    it('forbids residents from editing and outsiders from reading', async () => {
        await expect(update.execute({ caller: caller({ residentBuildingIds: ['b-1'] }), buildingId: 'b-1', fields: GRANADA }))
            .rejects.toBeInstanceOf(ForbiddenError);
        await expect(get.execute(caller({ residentBuildingIds: ['b-2'] }), 'b-1'))
            .rejects.toBeInstanceOf(ForbiddenError);
        await expect(update.execute({ caller: caller({ boardBuildingIds: ['b-2'] }), buildingId: 'b-1', fields: GRANADA }))
            .rejects.toBeInstanceOf(ForbiddenError);
    });

    it('lets admins edit any building', async () => {
        const view = await update.execute({ caller: caller({ appRole: 'admin' }), buildingId: 'b-1', fields: GRANADA });
        expect(view.configured).toBe(true);
    });
});
