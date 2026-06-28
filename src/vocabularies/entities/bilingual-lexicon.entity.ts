import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Word/sense-level bilingual translations, loaded from an open lexicon (PanLex,
 * Wiktionary translation tables, …) by the ingest script. The enrichment worker
 * looks a lemma up here instead of asking Gemma to translate it. This table also
 * doubles as the OPUS-MT cache: a sidecar translation is written back with
 * source='opus-mt', so each (lemma, language-pair) is translated at most once.
 *
 * `part_of_speech` is '' (not null) when the translation applies to the whole
 * lemma regardless of POS — which is how MT results are stored, since a bare
 * word carries no POS. A POS-specific row wins over the '' row at lookup time.
 */
@Index(
  'UQ_bilingual_lexicon_key',
  ['sourceLanguage', 'targetLanguage', 'lemma', 'partOfSpeech'],
  { unique: true },
)
@Entity('bilingual_lexicon')
export class BilingualLexiconEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'source_language', type: 'varchar', length: 8 })
  sourceLanguage!: string;

  @Column({ name: 'target_language', type: 'varchar', length: 8 })
  targetLanguage!: string;

  @Column({ type: 'varchar', length: 128 })
  lemma!: string;

  @Column({ name: 'part_of_speech', type: 'varchar', length: 16, default: '' })
  partOfSpeech!: string;

  @Column({ type: 'varchar', length: 255 })
  translation!: string;

  // Provenance: 'dictionary' / 'wiktionary' / 'opus-mt' / …
  @Column({ type: 'varchar', length: 32 })
  source!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
