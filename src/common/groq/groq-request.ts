/**
 * Shared Groq (OpenAI-compatible chat completions) HTTP layer. Framework-
 * agnostic — no NestJS, no DI. Mirrors common/gemma/gemma-request.ts.
 *
 * Key rotation: the free tier is rate-limited per account, so callers can supply
 * several API keys (each from a different account). One call tries keys in turn,
 * advancing to the next ONLY on a transient/per-key status (429 rate limit, 503
 * service unavailable). Any other non-2xx (4xx config/auth, etc.) fails fast —
 * another key won't fix it. If every key is throttled the last error bubbles up.
 */

export interface GroqRequestOptions {
  // One or more API keys; tried in turn on 429/503. Must be non-empty.
  apiKeys: string[];
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  // When true, ask Groq to constrain output to a valid JSON object. The prompt
  // must mention "json" somewhere or Groq rejects the request.
  jsonMode?: boolean;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

// HTTP statuses worth retrying on a different key: per-key rate limit and the
// transient "service overloaded" response.
const ROTATABLE_STATUSES = new Set([429, 503]);

// Round-robin the starting key across calls so we don't always burn key[0]
// first (which would hit its quota soonest). Process-local.
let nextStartIndex = 0;

/**
 * POST a chat-completion request and return the assistant message content,
 * rotating across `opts.apiKeys` on 429/503. Throws on empty response, on a
 * non-rotatable non-2xx, or once every key is exhausted.
 */
export async function chatCompletion(
  opts: GroqRequestOptions,
  params: ChatCompletionParams,
): Promise<string> {
  const keys = opts.apiKeys.filter((k) => k.trim().length > 0);
  if (keys.length === 0) {
    throw new Error('groq: no API keys configured');
  }

  const body = {
    model: opts.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.7,
    max_tokens: params.maxTokens ?? 1024,
    ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const start = nextStartIndex++ % keys.length;
  let lastErr: Error | undefined;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const data = (await res.json()) as ChatCompletionResponse;
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('groq returned an empty response');
      return text;
    }

    const detail = await res.text().catch(() => '');
    lastErr = new Error(`groq ${res.status}: ${detail.slice(0, 200)}`);
    // Only another key can help a per-key/overload status; everything else
    // (bad request, auth, not-found) would fail identically on every key.
    if (!ROTATABLE_STATUSES.has(res.status)) throw lastErr;
  }

  throw lastErr ?? new Error('groq: all API keys exhausted');
}
