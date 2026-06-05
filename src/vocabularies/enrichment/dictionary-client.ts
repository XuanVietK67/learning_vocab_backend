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
