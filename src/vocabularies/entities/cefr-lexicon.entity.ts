import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Reference wordlist mapping a lemma (optionally per part of speech) to its CEFR
 * difficulty, loaded once from an external source (e.g. the English Vocabulary
 * Profile / CEFR-J) by the ingest script. The enrichment worker reads it to set
 * `cefrLevel` from a deterministic lookup instead of asking Gemma — see
 * CefrEstimatorService.
 *
 * `part_of_speech` is '' (not null) when the level applies to the whole lemma
 * regardless of POS, so the unique key has no NULL holes (Postgres treats NULLs
 * as distinct in a unique index). A POS-specific row wins over the '' row.
 */
@Index('UQ_cefr_lexicon_key', ['language', 'lemma', 'partOfSpeech'], {
  unique: true,
})
@Entity('cefr_lexicon')
export class CefrLexiconEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  // Stored lowercased/trimmed; the estimator normalizes the lookup key to match.
  @Column({ type: 'varchar', length: 128 })
  lemma!: string;

  // '' = applies to every part of speech; otherwise a PartOfSpeech enum value.
  @Column({ name: 'part_of_speech', type: 'varchar', length: 16, default: '' })
  partOfSpeech!: string;

  // CEFR band (A1..C2). Plain varchar rather than the proficiency_level_enum so
  // this reference table stays decoupled from the user/vocabulary enum; the
  // estimator validates it against ProficiencyLevel on read.
  @Column({ name: 'cefr_level', type: 'varchar', length: 2 })
  cefrLevel!: string;

  // Optional corpus frequency rank carried from the source, used later to
  // backfill Vocabulary.frequency_rank. Null when the source has no rank.
  @Column({ name: 'frequency_rank', type: 'int', nullable: true })
  frequencyRank!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
