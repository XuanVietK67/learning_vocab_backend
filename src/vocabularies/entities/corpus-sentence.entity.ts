import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One real sentence from an external corpus (e.g. Tatoeba), loaded once by the
 * ingest script. The enrichment worker retrieves these as example sentences for
 * a lemma via Postgres full-text search instead of asking Gemma to invent them
 * — see ExampleRetrievalService and docs/plans/quick_create_without_gemma.md.
 *
 * `search_vector` (a tsvector built with the language's text-search config so an
 * inflected form matches the lemma) is created and indexed by the migration and
 * populated by the ingest script via raw SQL; it is intentionally NOT mapped as
 * an entity column. `gdex_score` is a precomputed "good dictionary example"
 * score the retrieval orders by, so the cleanest sentences surface first.
 */
@Index('IDX_corpus_sentence_rank', ['language', 'gdexScore'])
@Entity('corpus_sentence')
export class CorpusSentence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ name: 'word_count', type: 'int' })
  wordCount!: number;

  // Precomputed GDEX-style quality score (higher = better example); the
  // retrieval orders by it so short, clean, self-contained sentences win.
  @Column({ name: 'gdex_score', type: 'real' })
  gdexScore!: number;

  // Provenance of the sentence (e.g. 'tatoeba'); distinct from the persisted
  // example's pipeline source tag ('corpus').
  @Column({ type: 'varchar', length: 32 })
  source!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
