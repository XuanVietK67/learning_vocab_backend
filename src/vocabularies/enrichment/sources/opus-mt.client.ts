import { Logger } from '@nestjs/common';

// Shared OPUS-MT (Marian) sidecar client. Both TranslationService (request-time,
// config-driven) and the example-translation backfill script (standalone, env-
// driven) call through here so the request shape and retry policy never diverge.

const logger = new Logger('OpusMtClient');

export interface OpusMtClientOptions {
  // Base URL of the sidecar; '' disables MT (every item resolves to null).
  serviceUrl: string;
  token?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

interface OpusMtResponse {
  translations?: unknown[];
}

/**
 * Translate `texts` source->target via the OPUS-MT sidecar. Returns an array
 * aligned to `texts`, with null per item on any failure. Disabled (all null)
 * when no service URL is set. Retries cold-start/5xx/timeout up to
 * `maxAttempts`; never throws.
 */
export async function translateViaOpusMt(
  options: OpusMtClientOptions,
  sourceLanguage: string,
  targetLanguage: string,
  texts: string[],
): Promise<(string | null)[]> {
  const url = (options.serviceUrl ?? '').replace(/\/+$/, '');
  if (!url || texts.length === 0) return texts.map(() => null);

  const token = options.token ?? '';
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await requestOpusMt(
      url,
      token,
      timeoutMs,
      sourceLanguage,
      targetLanguage,
      texts,
    );
    if (result) return result;
    // null result = cold-start/5xx/timeout; back off (2s, 4s, …) and retry.
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return texts.map(() => null);
}

// One POST attempt. Returns the aligned translations on success, or null to
// signal a retryable failure (the caller decides whether to retry or give up).
async function requestOpusMt(
  url: string,
  token: string,
  timeoutMs: number,
  sourceLanguage: string,
  targetLanguage: string,
  q: string[],
): Promise<(string | null)[] | null> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/translate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: sourceLanguage,
        target: targetLanguage,
        texts: q,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(
        `opus-mt ${res.status} for ${sourceLanguage}->${targetLanguage} (${q.length} item(s))`,
      );
      return null;
    }
    const body = (await res.json()) as OpusMtResponse;
    const translations = body.translations ?? [];
    return q.map((_, i) => {
      const t = translations[i];
      return typeof t === 'string' && t.trim() ? t.trim() : null;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `opus-mt call failed for ${sourceLanguage}->${targetLanguage}: ${msg}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
