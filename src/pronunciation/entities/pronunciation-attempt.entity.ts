import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// PostgreSQL `numeric` is returned as a string by the driver; this transformer
// keeps the score columns as numbers on the entity (and tolerates null).
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null ? null : parseFloat(value),
};

// Per-phoneme breakdown captured verbatim from Azure's assessment so a future
// review UI / progress aggregation can drill into specific sounds.
export interface AssessedWord {
  word: string;
  accuracyScore: number | null;
  phonemes: { phoneme: string; accuracyScore: number | null }[];
}

@Entity('pronunciation_attempts')
export class PronunciationAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_pronunciation_attempts_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  // Nullable + unused in Phase 1; reserved for associating an attempt with a
  // specific vocabulary once pronunciation feeds into progress/SRS.
  @Index('IDX_pronunciation_attempts_vocab_id')
  @Column({ name: 'vocab_id', type: 'uuid', nullable: true })
  vocabId!: string | null;

  @Column({ name: 'reference_text', type: 'text' })
  referenceText!: string;

  @Column({ name: 'recognized_text', type: 'text', nullable: true })
  recognizedText!: string | null;

  // Resolved Azure locale the attempt was graded against (e.g. en-US, en-GB).
  @Column({ type: 'varchar', length: 16 })
  locale!: string;

  @Column({
    name: 'overall_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    transformer: numericTransformer,
  })
  overallScore!: number;

  @Column({
    name: 'accuracy_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  accuracyScore!: number | null;

  @Column({
    name: 'fluency_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  fluencyScore!: number | null;

  @Column({
    name: 'completeness_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  completenessScore!: number | null;

  @Column({
    name: 'prosody_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  prosodyScore!: number | null;

  @Column({ type: 'boolean' })
  passed!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  phonemes!: AssessedWord[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
