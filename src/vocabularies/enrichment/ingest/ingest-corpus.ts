import 'dotenv/config';
import 'tsconfig-paths/register';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import dataSource from '@/database/data-source';
import { tsSearchConfig } from '@/vocabularies/enrichment/sources/example-retrieval.service';

/**
 * One-off loader for the corpus_sentence table from a Tatoeba sentences export.
 *
 *   npx ts-node src/vocabularies/enrichment/ingest/ingest-corpus.ts sentences.csv
 *
 * Input is Tatoeba's native tab-separated `sentences.csv`:
 *   <id> <TAB> <iso-639-3 lang> <TAB> <text>
 * Languages not in LANG3_TO_2 are skipped (we only keep codes the app uses).
 * search_vector is built per-language with the matching Postgres FTS config so
 * inflected forms match the lemma at query time; gdex_score is a cheap "good
 * dictionary example" heuristic the retrieval orders by. Re-running appends, so
 * TRUNCATE corpus_sentence first for a clean reload.
 */
const SOURCE = 'tatoeba';
const CHUNK = 500;

// ISO 639-3 (Tatoeba) -> ISO 639-1 (app). Extend as more languages are added.
const LANG3_TO_2: Record<string, string> = {
  eng: 'en',
  spa: 'es',
  fra: 'fr',
  deu: 'de',
  por: 'pt',
  ita: 'it',
  nld: 'nl',
  rus: 'ru',
  swe: 'sv',
  dan: 'da',
  fin: 'fi',
  ron: 'ro',
  hun: 'hu',
  tur: 'tr',
  vie: 'vi',
};

// GDEX-style score in [0, 1]: reward a 5-20 word, self-contained, clean
// sentence; penalize digits/URLs, many capitalized words (proper nouns), and
// missing end punctuation. Higher sorts first in retrieval.
function gdexScore(text: string, words: string[]): number {
  const n = words.length;
  let score = 1;
  if (n < 5 || n > 20) score -= 0.5;
  else if (n > 15) score -= 0.2;
  if (/https?:\/\//i.test(text)) score -= 0.5;
  if (/\d/.test(text)) score -= 0.2;
  const caps = words.filter((w) => /^[A-Z]/.test(w)).length;
  if (caps > 2) score -= 0.2;
  if (!/[.!?]["')]?$/.test(text.trim())) score -= 0.1;
  return Math.max(0, score);
}

interface Row {
  language: string;
  text: string;
  wordCount: number;
  gdexScore: number;
  config: string;
}

async function flush(rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const placeholders: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const r of rows) {
    // text is passed twice: once for the column, once for to_tsvector.
    placeholders.push(
      `($${i}, $${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, to_tsvector($${i + 5}::regconfig, $${i + 6}))`,
    );
    params.push(
      r.language,
      r.text,
      r.wordCount,
      r.gdexScore,
      SOURCE,
      r.config,
      r.text,
    );
    i += 7;
  }
  await dataSource.query(
    `INSERT INTO corpus_sentence
       (language, text, word_count, gdex_score, source, search_vector)
     VALUES ${placeholders.join(', ')}`,
    params,
  );
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error(
      'usage: ts-node src/vocabularies/enrichment/ingest/ingest-corpus.ts <sentences.csv>',
    );
    process.exitCode = 1;
    return;
  }

  await dataSource.initialize();
  const rl = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });

  let batch: Row[] = [];
  let inserted = 0;
  let skipped = 0;
  try {
    for await (const line of rl) {
      const cols = line.split('\t');
      const language = LANG3_TO_2[(cols[1] ?? '').trim()];
      const text = (cols[2] ?? '').trim();
      if (!language || !text) {
        skipped++;
        continue;
      }
      const words = text.split(/\s+/);
      batch.push({
        language,
        text,
        wordCount: words.length,
        gdexScore: gdexScore(text, words),
        config: tsSearchConfig(language),
      });
      if (batch.length >= CHUNK) {
        await flush(batch);
        inserted += batch.length;
        batch = [];
      }
    }
    await flush(batch);
    inserted += batch.length;
    console.log(`corpus_sentence: inserted ${inserted}, skipped ${skipped}`);
  } finally {
    await dataSource.destroy();
  }
}

void main();
