import { DomainError } from '@/core/errors';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';

const BUCKET = 'information-center-files';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
]);

export interface UploadInformationCenterFileInput {
    name: string;
    bytes: Uint8Array;
    mime: string;
}

export class InformationCenterFileStorageService {
    async uploadAttachment(
        buildingId: string,
        ownerType: 'announcements' | 'rules',
        ownerId: string,
        file: UploadInformationCenterFileInput
    ): Promise<{ file_path: string }> {
        this.validate(file);
        const safeName = this.sanitizeName(file.name);
        const path = `${ownerType}/${buildingId}/${ownerId}/${safeName}`;

        const { data, error } = await supabase.storage
            .from(BUCKET)
            .upload(path, file.bytes, {
                contentType: file.mime,
                cacheControl: '600',
                upsert: false,
            });

        if (error) {
            throw new DomainError('Error uploading file: ' + error.message, 'STORAGE_ERROR', 500);
        }

        return { file_path: data.path };
    }

    async getSignedUrl(filePath: string | null, ttlSeconds = 900): Promise<string | null> {
        if (!filePath) return null;

        const { data, error } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(filePath, ttlSeconds);

        if (error || !data?.signedUrl) {
            throw new DomainError(
                'Error generating signed URL: ' + (error?.message ?? 'unknown'),
                'STORAGE_ERROR',
                500
            );
        }

        return data.signedUrl;
    }

    private sanitizeName(name: string): string {
        return name
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/\.{2,}/g, '_')
            .substring(0, 128);
    }

    private validate(file: UploadInformationCenterFileInput): void {
        if (!ALLOWED_MIMES.has(file.mime)) {
            throw new DomainError(`Mime type ${file.mime} not allowed`, 'INVALID_ATTACHMENT_MIME', 400);
        }
        if (file.bytes.length > MAX_BYTES) {
            throw new DomainError('File exceeds 5 MB limit', 'ATTACHMENT_TOO_LARGE', 400);
        }
    }
}
