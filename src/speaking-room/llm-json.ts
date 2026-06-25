// Defensive helpers for turning loosely-formatted LLM text into typed objects.
// Shared by the live-turn and session-report cores. Mirrors the private helpers
// in scenario-draft.ts; extracted here so both Phase 2 cores reuse one copy.

/**
 * Pull the JSON object out of model text: strip ```/```json fences, then fall
 * back to the first '{' … last '}' span if there is surrounding prose.
 */
export function extractJsonObject(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  if (text.startsWith('{') && text.endsWith('}')) return text;
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1);
  return text;
}

/** Parse model text into an object, throwing a clear error on malformed JSON. */
export function parseJsonObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new Error('model did not return valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('model JSON was not an object');
  }
  return parsed as Record<string, unknown>;
}

/** Require a non-empty trimmed string field, else throw naming the field. */
export function requireString(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new Error(`model output is missing required field: ${field}`);
  return s;
}

/** Trimmed string or '' — never throws. */
export function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A cleaned-up array of non-empty strings, capped, from an unknown value. */
export function stringArray(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, cap);
}
