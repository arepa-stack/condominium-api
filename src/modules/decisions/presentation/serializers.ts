/**
 * Decision module DTO serializers.
 *
 * The domain `toJSON()` output carries storage paths for `photo_url` and
 * `file_url`. The bucket is private, so clients cannot fetch those paths
 * directly. This module re-signs them at the presentation boundary per
 * spec §7.8 — short TTL, re-signed per GET.
 */

import type { Decision } from '@/modules/decisions/domain/entities/Decision';
import type { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import type { DecisionFileStorageService } from '@/modules/decisions/infrastructure/services/DecisionFileStorageService';

/**
 * Serialize a Decision for the wire. Replaces the stored photo_url path
 * with a fresh signed URL when present.
 */
export async function serializeDecision(
  decision: Decision,
  storage: DecisionFileStorageService,
) {
  const json = decision.toJSON();
  if (json.photo_url) {
    json.photo_url = await storage.getSignedUrl(json.photo_url);
  }
  return json;
}

/** Serialize many decisions in parallel. */
export function serializeDecisions(
  decisions: Decision[],
  storage: DecisionFileStorageService,
) {
  return Promise.all(decisions.map((d) => serializeDecision(d, storage)));
}

/**
 * Serialize a Quote for the wire. Replaces the stored file_url path
 * with a fresh signed URL.
 */
export async function serializeQuote(
  quote: DecisionQuote,
  storage: DecisionFileStorageService,
) {
  const json = quote.toJSON();
  if (json.file_url) {
    json.file_url = await storage.getSignedUrl(json.file_url);
  }
  return json;
}

/** Serialize many quotes in parallel. */
export function serializeQuotes(
  quotes: DecisionQuote[],
  storage: DecisionFileStorageService,
) {
  return Promise.all(quotes.map((q) => serializeQuote(q, storage)));
}
