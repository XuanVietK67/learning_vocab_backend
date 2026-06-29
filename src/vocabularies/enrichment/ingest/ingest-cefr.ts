import 'dotenv/config';
import 'tsconfig-paths/register';
import { readFileSync } from 'node:fs';
import dataSource from '@/database/data-source';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { mapPartOfSpeech } from '@/vocabularies/enrichment/pos-map';
import { CefrLexiconEntry } from '@/vocabularies/entities/cefr-lexicon.entity';

/**
 * One-off loader for the cefr_lexicon reference table from an English Vocabulary
 * Profile-style export.
 *
 *   npx ts-node src/vocabularies/enrichment/ingest/ingest-cefr.ts <file.csv> [lang]
 *
 * Input is a semicolon-delimited file WITH a header row, columns:
 *   headword ; pos ; CEFR ; ...(ignored)...
 * `lang` defaults to 'en' (the EVP list is English). The POS is mapped onto our
 * PartOfSpeech vocabulary; words whose POS we don't model (determiner, number,
 * …) are stored generic ('' = applies to any POS) so the lemma still gets a
 * CEFR. The header and any row with a missing headword or invalid CEFR band are
 * skipped, and duplicate (lang, lemma, pos) keys are de-duped in memory.
 * Existing rows are left untouched (insert-or-ignore) — TRUNCATE to reload.
 */
const VALID_CEFR = new Set<string>(Object.values(ProficiencyLevel));
const CHUNK = 500;

// Strip a leading UTF-8 BOM (U+FEFF) the export may carry on its first line.
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error(
      'usage: ts-node src/vocabularies/enrichment/ingest/ingest-cefr.ts <file.csv> [lang]',
    );
    process.exitCode = 1;
    return;
  }
  const language = process.argv[3] ?? 'en';

  const entities: Partial<CefrLexiconEntry>[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const content = stripBom(readFileSync(file, 'utf8'));
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(';');
    const lemma = (cols[0] ?? '').trim().toLowerCase();
    const rawPos = (cols[1] ?? '').trim();
    const cefrLevel = (cols[2] ?? '').trim().toUpperCase();
    // Skips the header ('CEFR') and any malformed row.
    if (!lemma || !VALID_CEFR.has(cefrLevel)) {
      skipped++;
      continue;
    }
    const partOfSpeech = mapPartOfSpeech(rawPos) ?? '';
    const key = `${lemma} ${partOfSpeech}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    entities.push({
      language,
      lemma,
      partOfSpeech,
      cefrLevel,
      frequencyRank: null,
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
