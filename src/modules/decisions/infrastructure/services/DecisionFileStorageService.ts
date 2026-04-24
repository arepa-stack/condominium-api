import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

const BUCKET = 'issue-files';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface UploadFileInput {
  /** Raw filename from the multipart upload — will be sanitized */
  name: string;
  bytes: Uint8Array;
  mime: string;
}

export class DecisionFileStorageService {
  // ------------------------------------------------------------------ private helpers

  private sanitizeName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9._-]/g, '_')  // replace unsafe chars
      .replace(/\.{2,}/g, '_')             // no path traversal (..)
      .substring(0, 128);                   // max length
  }

  private validate(file: UploadFileInput): void {
    if (!ALLOWED_MIMES.has(file.mime)) {
      throw new DomainError(
        `Mime type ${file.mime} not allowed`,
        'QUOTE_INVALID_MIME',
        400,
      );
    }
    if (file.bytes.length > MAX_BYTES) {
      throw new DomainError(
        `File exceeds 5 MB limit (${file.bytes.length} bytes)`,
        'QUOTE_FILE_TOO_LARGE',
        400,
      );
    }
  }

  private async upload(path: string, file: UploadFileInput): Promise<string> {
    this.validate(file);

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file.bytes, {
        contentType: file.mime,
        cacheControl: '600',
        upsert: false,
      });

    if (error) {
      throw new DomainError(
        'Error uploading file: ' + error.message,
        'STORAGE_ERROR',
        500,
      );
    }

    return data.path;
  }

  // ------------------------------------------------------------------ public API

  /**
   * Uploads a quote attachment.
   * Path: decisions/{decisionId}/quotes/{quoteId}/{sanitized_name}
   */
  async uploadQuoteFile(
    decisionId: string,
    quoteId: string,
    file: UploadFileInput,
  ): Promise<{ file_path: string }> {
    const safeName = this.sanitizeName(file.name);
    const path = `decisions/${decisionId}/quotes/${quoteId}/${safeName}`;
    const file_path = await this.upload(path, file);
    return { file_path };
  }

  /**
   * Uploads the main photo for a decision.
   * Path: decisions/{decisionId}/issue/{sanitized_name}
   */
  async uploadIssuePhoto(
    decisionId: string,
    file: UploadFileInput,
  ): Promise<{ file_path: string }> {
    const safeName = this.sanitizeName(file.name);
    const path = `decisions/${decisionId}/issue/${safeName}`;
    const file_path = await this.upload(path, file);
    return { file_path };
  }

  /**
   * Returns a short-lived signed URL for reading a private file.
   * TTL default: 900 seconds (15 min) — re-sign on every GET per spec §7.8.
   */
  async getSignedUrl(file_path: string, ttlSeconds = 900): Promise<string> {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(file_path, ttlSeconds);

    if (error || !data?.signedUrl) {
      throw new DomainError(
        'Error generating signed URL: ' + (error?.message ?? 'unknown'),
        'STORAGE_ERROR',
        500,
      );
    }

    return data.signedUrl;
  }

  /**
   * Deletes a file from storage. Used on cleanup of orphaned pending files.
   */
  async delete(file_path: string): Promise<void> {
    const { error } = await supabase.storage
      .from(BUCKET)
      .remove([file_path]);

    if (error) {
      throw new DomainError(
        'Error deleting file: ' + error.message,
        'STORAGE_ERROR',
        500,
      );
    }
  }
}
