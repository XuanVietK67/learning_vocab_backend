import { ENGLISH_STOPWORDS } from '@/vocabularies/enrichment/import/stopwords';

/**
 * Turn raw extracted text into candidate lemmas. Pure (no IO) — the file
 * parsers feed their text here, and it's unit-tested directly on strings.
 *
 * Two modes:
 *  - 'list'  : the source is already a word list (one term per line/cell, or
 *              comma-separated). Split on line breaks and commas, keep each
 *              entry as-is (multi-word phrases preserved). Minimal filtering.
 *  - 'prose' : the source is running text. Tokenise into single alphabetic
 *              words, lowercase, drop stopwords and 1-character tokens. Fuzzy
 *              by nature — the admin curates the result.
 */
export type ExtractMode = 'list' | 'prose';

export interface TokenizeResult {
  lemmas: string[];
  removedStopwords: number;
}

export function tokenize(text: string, mode: ExtractMode): TokenizeResult {
  return mode === 'prose' ? tokenizeProse(text) : tokenizeList(text);
}

function tokenizeList(text: string): TokenizeResult {
  const lemmas = text
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return { lemmas, removedStopwords: 0 };
}

function tokenizeProse(text: string): TokenizeResult {
  // Keep letters and intra-word apostrophes/hyphens; split on everything else.
  const tokens = text
    .toLowerCase()
    .split(/[^a-zà-öø-ÿ'’-]+/i)
    .map((t) => t.replace(/^[''-]+|[''-]+$/g, '').trim())
    .filter((t) => t.length > 1);

  const lemmas: string[] = [];
  let removedStopwords = 0;
  for (const token of tokens) {
    if (ENGLISH_STOPWORDS.has(token)) {
      removedStopwords++;
      continue;
    }
    lemmas.push(token);
  }
  return { lemmas, removedStopwords };
}
