import 'dotenv/config';
import 'tsconfig-paths/register';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import dataSource from '@/database/data-source';
import { DictionarySenseRaw } from '@/vocabularies/enrichment/dictionary-client';
import { DictionaryEntry } from '@/vocabularies/entities/dictionary-entry.entity';

/**
 * One-off loader for dictionary_entry from a wiktextract / kaikki.org JSON-lines
 * export (one JSON object per line).
 *
 *   npx ts-node src/vocabularies/enrichment/ingest/ingest-dictionary.ts kaikki.jsonl
 *
 * Reads each entry's word / lang_code / pos / sounds[].ipa / senses[].glosses
 * and stores them in the DictionaryPosGroup shape the worker consumes. Lines
 * without a word/lang/pos or any usable gloss are skipped. Existing rows are
 * left untouched (insert-or-ignore on the unique key) — TRUNCATE to reload.
 */
const CHUNK = 500;
const SENSE_LIMIT = 5;
const DEFINITION_MAX = 2000;

interface RawSound {
  ipa?: unknown;
}
interface RawSense {
  glosses?: unknown;
  examples?: unknown;
}
interface RawEntry {
  word?: unknown;
  lang_code?: unknown;
  pos?: unknown;
  sounds?: unknown;
  senses?: unknown;
}

function firstIpa(sounds: unknown): string | null {
  if (!Array.isArray(sounds)) return null;
  for (const s of sounds as RawSound[]) {
    if (typeof s?.ipa === 'string' && s.ipa.trim())
      return s.ipa.trim().slice(0, 128);
  }
  return null;
}

function parseSenses(raw: unknown): DictionarySenseRaw[] {
  if (!Array.isArray(raw)) return [];
  const out: DictionarySenseRaw[] = [];
  for (const s of (raw as RawSense[]).slice(0, SENSE_LIMIT)) {
    const definition = Array.isArray(s?.glosses)
      ? s.glosses
          .filter((g) => typeof g === 'string')
          .join('; ')
          .trim()
      : '';
    if (!definition) continue;
    const sense: DictionarySenseRaw = {
      definition: definition.slice(0, DEFINITION_MAX),
      synonyms: [],
      antonyms: [],
    };
    const ex = Array.isArray(s?.examples)
      ? (s.examples as { text?: unknown }[]).find(
          (e) => typeof e?.text === 'string' && e.text.trim(),
        )
      : undefined;
    if (ex && typeof ex.text === 'string') sense.example = ex.text.trim();
    out.push(sense);
  }
  return out;
}

async function flush(rows: Partial<DictionaryEntry>[]): Promise<void> {
  if (rows.length === 0) return;
  await dataSource
    .getRepository(DictionaryEntry)
    .createQueryBuilder()
    .insert()
    .into(DictionaryEntry)
    .values(rows)
    .orIgnore()
    .execute();
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error(
      'usage: ts-node src/vocabularies/enrichment/ingest/ingest-dictionary.ts <kaikki.jsonl>',
    );
    process.exitCode = 1;
    return;
  }

  await dataSource.initialize();
  const rl = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });

  let batch: Partial<DictionaryEntry>[] = [];
  let inserted = 0;
  let skipped = 0;
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj: RawEntry;
      try {
        obj = JSON.parse(line) as RawEntry;
      } catch {
        skipped++;
        continue;
      }
      const language =
        typeof obj.lang_code === 'string' ? obj.lang_code.trim() : '';
      const lemma =
        typeof obj.word === 'string' ? obj.word.trim().toLowerCase() : '';
      const partOfSpeech =
        typeof obj.pos === 'string' ? obj.pos.trim().toLowerCase() : '';
      const senses = parseSenses(obj.senses);
      if (!language || !lemma || !partOfSpeech || senses.length === 0) {
        skipped++;
        continue;
      }
      batch.push({
        language,
        lemma: lemma.slice(0, 128),
        partOfSpeech: partOfSpeech.slice(0, 16),
        ipa: firstIpa(obj.sounds),
        senses,
      });
      if (batch.length >= CHUNK) {
        await flush(batch);
        inserted += batch.length;
        batch = [];
      }
    }
    await flush(batch);
    inserted += batch.length;
    console.log(
      `dictionary_entry: inserted up to ${inserted}, skipped ${skipped}`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void main();
