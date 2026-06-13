import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DraftInput } from '@/vocabularies/enrichment/enrichment-draft.types';

/**
 * Persistent enrichment cache: the complete model+dictionary output for one
 * word, keyed by what makes the output unique — (language, lemma,
 * translation_language). `content` holds the serialized `DraftInput[]` (every
 * part of speech with its IPA, CEFR, and full sense graph: glosses,
 * definitions, synonyms/antonyms, examples, and translations). On a hit the
 * worker replays this straight into persistence, skipping BOTH the dictionary
 * API and Gemma — so a given word costs the model exactly once, ever, no matter
 * how many users or imports request it.
 *
 * `translation_language` is normalized to '' (not null) when no translation was
 * requested, so the unique key has no NULL holes (Postgres treats NULLs as
 * distinct in a unique index).
 */
@Index(
  'UQ_vocab_enrichment_cache_key',
  ['language', 'lemma', 'translationLanguage'],
  {
    unique: true,
  },
)
@Entity('vocab_enrichment_cache')
export class VocabEnrichmentCache {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({ type: 'varchar', length: 128 })
  lemma!: string;

  // Target language of the cached per-sense translations. '' = the entry was
  // generated without any translation, kept non-null so it can be part of the
  // unique key.
  @Column({
    name: 'translation_language',
    type: 'varchar',
    length: 8,
    default: '',
  })
  translationLanguage!: string;

  // The full DraftInput[] the pipeline produced for this word (POS groups, each
  // with IPA/CEFR and the sense graph). Replayed verbatim on a cache hit.
  @Column({ type: 'jsonb' })
  content!: DraftInput[];

  // Which model produced the cached content (provenance / future invalidation).
  @Column({ type: 'varchar', length: 64 })
  model!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
