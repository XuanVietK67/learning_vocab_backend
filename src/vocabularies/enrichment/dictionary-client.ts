/**
 * Framework-agnostic client for the free Dictionary API (dictionaryapi.dev),
 * shared by the enrichment worker. No NestJS, no DB, no DI — just a fetch
 * wrapper plus the response parser (exported for unit testing).
 *
 * English only. Returns POS groups (one per part of speech the dictionary
 * lists), each carrying the word's IPA, definitions, and synonyms/antonyms.
 * `fetchDictionaryEntry` returns null when the word is not in the dictionary
 * (HTTP 404), so the caller falls back to a Gemma-only enrichment.
 */

export interface DictionarySenseRaw {
  definition: string;
  example?: string;
  synonyms: string[];
  antonyms: string[];
}

export interface DictionaryPosGroup {
  partOfSpeechRaw: string;
  ipa: string | null;
  senses: DictionarySenseRaw[];
}

interface RawDefinition {
  definition?: unknown;
  example?: unknown;
  synonyms?: unknown;
  antonyms?: unknown;
}

interface RawMeaning {
  partOfSpeech?: unknown;
  definitions?: unknown;
  synonyms?: unknown;
  antonyms?: unknown;
}

interface RawEntry {
  phonetic?: unknown;
  phonetics?: unknown;
  meanings?: unknown;
}

const DICTIONARY_BASE_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

/** Pull the first non-empty IPA string out of an entry's phonetic fields. */
function extractIpa(entry: RawEntry): string | null {
  if (typeof entry.phonetic === 'string' && entry.phonetic.trim()) {
    return entry.phonetic.trim();
  }
  if (Array.isArray(entry.phonetics)) {
    for (const p of entry.phonetics) {
      const text = (p as { text?: unknown })?.text;
      if (typeof text === 'string' && text.trim()) return text.trim();
    }
  }
  return null;
}

/**
 * Parse the dictionaryapi.dev response body into POS groups. Meanings are
 * merged by part of speech across entries; the word's first available IPA is
 * applied to every group. Tolerates missing/malformed fields.
 */
export function parseDictionaryResponse(body: unknown): DictionaryPosGroup[] {
  if (!Array.isArray(body)) return [];

  let ipa: string | null = null;
  const groups = new Map<string, DictionaryPosGroup>();

  for (const entryRaw of body) {
    const entry = entryRaw as RawEntry;
    if (ipa === null) ipa = extractIpa(entry);

    if (!Array.isArray(entry.meanings)) continue;
    for (const meaningRaw of entry.meanings) {
      const meaning = meaningRaw as RawMeaning;
      const pos =
        typeof meaning.partOfSpeech === 'string'
          ? meaning.partOfSpeech.trim()
          : '';
      if (!pos || !Array.isArray(meaning.definitions)) continue;

      const meaningSynonyms = asStringArray(meaning.synonyms);
      const meaningAntonyms = asStringArray(meaning.antonyms);

      const senses: DictionarySenseRaw[] = [];
      for (const defRaw of meaning.definitions) {
        const def = defRaw as RawDefinition;
        if (typeof def.definition !== 'string' || !def.definition.trim()) {
          continue;
        }
        const sense: DictionarySenseRaw = {
          definition: def.definition.trim(),
          synonyms: dedupe([
            ...asStringArray(def.synonyms),
            ...meaningSynonyms,
          ]),
          antonyms: dedupe([
            ...asStringArray(def.antonyms),
            ...meaningAntonyms,
          ]),
        };
        if (typeof def.example === 'string' && def.example.trim()) {
          sense.example = def.example.trim();
        }
        senses.push(sense);
      }
      if (senses.length === 0) continue;

      const existing = groups.get(pos);
      if (existing) {
        existing.senses.push(...senses);
      } else {
        groups.set(pos, { partOfSpeechRaw: pos, ipa: null, senses });
      }
    }
  }

  const result = [...groups.values()];
  for (const group of result) group.ipa = ipa;
  return result;
}

/**
 * Fetch + parse the dictionary entry for an English lemma. Returns null when the
 * word is not found (404). Throws on other non-2xx (429/5xx — the worker turns
 * that into a retry) or network/timeout errors.
 */
export async function fetchDictionaryEntry(
  lemma: string,
  timeoutMs = 10_000,
): Promise<DictionaryPosGroup[] | null> {
  const url = `${DICTIONARY_BASE_URL}/${encodeURIComponent(lemma.trim())}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`dictionary ${res.status}: ${detail.slice(0, 200)}`);
  }

  const body = (await res.json()) as unknown;
  const groups = parseDictionaryResponse(body);
  return groups.length > 0 ? groups : null;
}

// ---- multi-word IPA composition ----
//
// The dictionary only has single headwords, so a phrase like "income
// disparities" 404s as a whole and the worker falls back to Gemma (which has no
// reliable IPA). We can still reconstruct an IPA for the phrase by looking up
// each word on its own and joining the per-word transcriptions.

/** Strip the surrounding /…/ or […] delimiters from an IPA string. */
export function stripIpaDelimiters(ipa: string): string {
  return ipa
    .trim()
    .replace(/^[/[]+/, '')
    .replace(/[/\]]+$/, '')
    .trim();
}

/**
 * Candidate singular/base forms to retry when a token 404s as-is (the dictionary
 * usually only has the singular). Tried in order; the first that resolves wins.
 * e.g. "disparities" -> "disparity", "boxes" -> "box", "cats" -> "cat".
 */
export function singularFallbacks(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  if (w.endsWith('ies') && w.length > 3) out.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('es') && w.length > 2) out.push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 1) {
    out.push(w.slice(0, -1));
  }
  return [...new Set(out)].filter((c) => c && c !== w);
}

/**
 * Join per-word IPA fragments into one phrase transcription, e.g.
 * ["/ˈɪnkʌm/", "/dɪˈspærɪti/"] -> "/ˈɪnkʌm dɪˈspærɪti/". Returns null if ANY
 * word is missing, so the caller can fall back to a different IPA source rather
 * than store a partial transcription.
 */
export function composeIpa(perWordIpa: (string | null)[]): string | null {
  if (perWordIpa.length === 0) return null;
  const parts: string[] = [];
  for (const ipa of perWordIpa) {
    if (!ipa) return null;
    const inner = stripIpaDelimiters(ipa);
    if (!inner) return null;
    parts.push(inner);
  }
  return `/${parts.join(' ')}/`;
}

/**
 * Fetch the IPA for a single word. Returns null when the word isn't in the
 * dictionary (404) or carries no phonetic. Throws on other non-2xx / network
 * errors, mirroring fetchDictionaryEntry so the worker can retry.
 */
export async function fetchWordIpa(
  word: string,
  timeoutMs = 10_000,
): Promise<string | null> {
  const url = `${DICTIONARY_BASE_URL}/${encodeURIComponent(word.trim())}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`dictionary ${res.status}: ${detail.slice(0, 200)}`);
  }

  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) return null;
  for (const entryRaw of body) {
    const ipa = extractIpa(entryRaw as RawEntry);
    if (ipa) return ipa;
  }
  return null;
}

/**
 * Compose an IPA transcription for a multi-word English lemma from per-word
 * dictionary lookups (with a plural→singular retry per word). Returns null for
 * single-word lemmas (those already went through fetchDictionaryEntry) or when
 * any word can't be resolved — the caller then falls back to Gemma's IPA.
 */
export async function composeIpaFromWords(
  lemma: string,
  timeoutMs = 10_000,
): Promise<string | null> {
  const tokens = lemma.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const perWord: (string | null)[] = [];
  for (const token of tokens) {
    let ipa = await fetchWordIpa(token, timeoutMs);
    if (!ipa) {
      for (const candidate of singularFallbacks(token)) {
        ipa = await fetchWordIpa(candidate, timeoutMs);
        if (ipa) break;
      }
    }
    perWord.push(ipa);
  }
  return composeIpa(perWord);
}
