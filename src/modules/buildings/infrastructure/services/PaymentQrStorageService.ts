import { DomainError } from '@/core/errors';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { IPaymentQrStorage, PaymentQrFile } from '../../domain/repository';

const BUCKET = 'building-payment-files';
const MAX_BYTES = 2 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export class PaymentQrStorageService implements IPaymentQrStorage {
    async upload(buildingId: string, file: PaymentQrFile): Promise<string> {
        const ext = EXTENSIONS[file.mime];
        if (!ext) throw new DomainError(`Mime type ${file.mime} not allowed`, 'INVALID_QR_MIME', 400);
        if (file.bytes.length > MAX_BYTES) throw new DomainError('QR image exceeds 2 MB limit', 'QR_TOO_LARGE', 400);

        // Timestamped name: a new upload never collides with the cached old one.
        const path = `payment-qr/${buildingId}/${Date.now()}.${ext}`;
        const { data, error } = await supabase.storage
            .from(BUCKET)
            .upload(path, file.bytes, { contentType: file.mime, cacheControl: '3600', upsert: false });

        if (error) throw new DomainError('Error uploading QR: ' + error.message, 'STORAGE_ERROR', 500);
        return data.path;
    }

    async remove(path: string): Promise<void> {
        const { error } = await supabase.storage.from(BUCKET).remove([path]);
        if (error) throw new DomainError('Error deleting QR: ' + error.message, 'STORAGE_ERROR', 500);
    }

    async signedUrl(path: string | null, ttlSeconds = 3600): Promise<string | null> {
        if (!path) return null;
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
        if (error || !data?.signedUrl) {
            throw new DomainError('Error generating QR URL: ' + (error?.message ?? 'unknown'), 'STORAGE_ERROR', 500);
        }
        return data.signedUrl;
    }
}
