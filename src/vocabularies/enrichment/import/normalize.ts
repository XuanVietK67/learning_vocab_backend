const LEMMA_MAX_LENGTH = 128;

export interface NormalizeResult {
  lemmas: string[];
  /** How many raw entries collapsed away as duplicates (case-insensitive). */
  deduped: number;
  /** True when the result was truncated to `cap`. */
  capped: boolean;
}

/**
 * Trim, length-filter, case-insensitively de-duplicate (keeping the first
 * surface form), and cap a raw lemma list. Shared by the extract step and the
 * bulk-enrich endpoint so both apply the same hygiene.
 */
export function normalizeLemmas(raw: string[], cap: number): NormalizeResult {
  const seen = new Set<string>();
  const lemmas: string[] = [];
  let deduped = 0;
  let capped = false;

  for (const entry of raw) {
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > LEMMA_MAX_LENGTH) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      deduped++;
      continue;
    }
    seen.add(key);

    if (lemmas.length >= cap) {
      capped = true;
      break;
    }
    lemmas.push(trimmed);
  }

  return { lemmas, deduped, capped };
}
