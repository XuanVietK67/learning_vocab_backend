import 'dotenv/config';
import 'tsconfig-paths/register';
import { readFileSync } from 'node:fs';
import dataSource from '@/database/data-source';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { CefrLexiconEntry } from '@/vocabularies/entities/cefr-lexicon.entity';

/**
 * One-off loader for the cefr_lexicon reference table.
 *
 *   npx ts-node src/vocabularies/enrichment/ingest/ingest-cefr.ts <file.tsv>
 *
 * Input is a headerless, tab-separated file with columns:
 *   language <TAB> lemma <TAB> part_of_speech <TAB> cefr <TAB> frequency_rank
 * `part_of_speech` and `frequency_rank` may be empty ('' = applies to every
 * POS / unknown rank). Rows with a missing language/lemma or an invalid CEFR
 * band are skipped. Existing rows are left untouched (insert-or-ignore on the
 * unique key) — TRUNCATE the table first to do a clean reload.
 */
const VALID_CEFR = new Set<string>(Object.values(ProficiencyLevel));
const CHUNK = 500;

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error(
      'usage: ts-node src/vocabularies/enrichment/ingest/ingest-cefr.ts <file.tsv>',
    );
    process.exitCode = 1;
    return;
  }

  const entities: Partial<CefrLexiconEntry>[] = [];
  let skipped = 0;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const language = (cols[0] ?? '').trim();
    const lemma = (cols[1] ?? '').trim().toLowerCase();
    const partOfSpeech = (cols[2] ?? '').trim().toLowerCase();
    const cefrLevel = (cols[3] ?? '').trim().toUpperCase();
    const freqRaw = (cols[4] ?? '').trim();
    if (!language || !lemma || !VALID_CEFR.has(cefrLevel)) {
      skipped++;
      continue;
    }
    const freq = freqRaw ? parseInt(freqRaw, 10) : NaN;
    entities.push({
      language,
      lemma,
      partOfSpeech,
      cefrLevel,
      frequencyRank: Number.isFinite(freq) ? freq : null,
    });
  }

  await dataSource.initialize();
  try {
    const repo = dataSource.getRepository(CefrLexiconEntry);
    for (let i = 0; i < entities.length; i += CHUNK) {
      await repo
        .createQueryBuilder()
        .insert()
        .into(CefrLexiconEntry)
        .values(entities.slice(i, i + CHUNK))
        .orIgnore()
        .execute();
    }
    console.log(
      `cefr_lexicon: inserted up to ${entities.length} row(s), skipped ${skipped}`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void main();
