/**
 * Shared Gemma (Google AI Studio generateContent) HTTP layer for the enrichment
 * worker and the practice-scoring judge. Framework-agnostic — no NestJS, no DI.
 *
 * Key rotation: the free tier is rate-limited per project, so callers can supply
 * several API keys (each from a different project/account). One call tries keys
 * in turn, advancing to the next ONLY on a transient/per-key status (429
 * RESOURCE_EXHAUSTED, 503 UNAVAILABLE). Any other non-2xx (4xx config/auth, etc.)
 * fails fast — another key won't fix it. If every key is throttled the last error
 * bubbles up so the caller's BullMQ backoff retries the whole job later.
 *
 * Note: 503 "high demand" is model-wide capacity, not per-key quota, so rotation
 * helps it only marginally; it mainly raises the 429 ceiling. The BullMQ backoff
 * is the real defence against a sustained 503.
 */

export interface GemmaRequestOptions {
  // One or more API keys; tried in turn on 429/503. Must be non-empty.
  apiKeys: string[];
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

// HTTP statuses worth retrying on a different key: per-key rate limit and the
// transient "model overloaded" response.
const ROTATABLE_STATUSES = new Set([429, 503]);

// Round-robin the starting key across calls so we don't always burn key[0]
// first (which would be the one to hit its quota soonest). Process-local.
let nextStartIndex = 0;

/**
 * POST a generateContent request and return the concatenated candidate text,
 * rotating across `opts.apiKeys` on 429/503. Throws on empty response, on a
 * non-rotatable non-2xx, or once every key is exhausted.
 */
export async function generateContent(
  opts: GemmaRequestOptions,
  body: unknown,
): Promise<string> {
  const keys = opts.apiKeys.filter((k) => k.trim().length > 0);
  if (keys.length === 0) {
    throw new Error('gemma: no API keys configured');
  }

  const start = nextStartIndex++ % keys.length;
  let lastErr: Error | undefined;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length];
    const url = `${opts.baseUrl}/models/${opts.model}:generateContent?key=${key}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const data = (await res.json()) as GenerateContentResponse;
      const text = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim();
      if (!text) throw new Error('gemma returned an empty response');
      return text;
    }

    const detail = await res.text().catch(() => '');
    lastErr = new Error(`gemma ${res.status}: ${detail.slice(0, 200)}`);
    // Only another key can help a per-key/overload status; everything else
    // (bad request, auth, not-found) would fail identically on every key.
    if (!ROTATABLE_STATUSES.has(res.status)) throw lastErr;
  }

  throw lastErr ?? new Error('gemma: all API keys exhausted');
}
