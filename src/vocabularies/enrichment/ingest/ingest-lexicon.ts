import 'dotenv/config';
import 'tsconfig-paths/register';
import { readFileSync } from 'node:fs';
import dataSource from '@/database/data-source';
import { BilingualLexiconEntry } from '@/vocabularies/entities/bilingual-lexicon.entity';

/**
 * One-off loader for the bilingual_lexicon table.
 *
 *   npx ts-node src/vocabularies/enrichment/ingest/ingest-lexicon.ts pairs.tsv
 *
 * Input is a headerless, tab-separated file with columns:
 *   source_language <TAB> target_language <TAB> lemma <TAB> part_of_speech <TAB> translation
 * `part_of_speech` may be empty ('' = applies to every POS). Rows missing a
 * language/lemma/translation are skipped. Existing rows are left untouched
 * (insert-or-ignore on the unique key) — TRUNCATE to do a clean reload.
 */
const CHUNK = 500;

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error(
      'usage: ts-node src/vocabularies/enrichment/ingest/ingest-lexicon.ts <pairs.tsv>',
    );
    process.exitCode = 1;
    return;
  }

  const entities: Partial<BilingualLexiconEntry>[] = [];
  let skipped = 0;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const sourceLanguage = (cols[0] ?? '').trim();
    const targetLanguage = (cols[1] ?? '').trim();
    const lemma = (cols[2] ?? '').trim().toLowerCase();
    const partOfSpeech = (cols[3] ?? '').trim().toLowerCase();
    const translation = (cols[4] ?? '').trim().slice(0, 255);
    if (!sourceLanguage || !targetLanguage || !lemma || !translation) {
      skipped++;
      continue;
    }
    entities.push({
      sourceLanguage,
      targetLanguage,
      lemma,
      partOfSpeech,
      translation,
      source: 'dictionary',
    });
  }

  await dataSource.initialize();
  try {
    const repo = dataSource.getRepository(BilingualLexiconEntry);
    for (let i = 0; i < entities.length; i += CHUNK) {
      await repo
        .createQueryBuilder()
        .insert()
        .into(BilingualLexiconEntry)
        .values(entities.slice(i, i + CHUNK))
        .orIgnore()
        .execute();
    }
    console.log(
      `bilingual_lexicon: inserted up to ${entities.length} row(s), skipped ${skipped}`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void main();
