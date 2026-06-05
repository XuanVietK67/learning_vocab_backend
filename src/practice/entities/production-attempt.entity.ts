import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PracticeModality } from '@/practice/entities/practice-modality.enum';
import { ScoringStatus } from '@/practice/entities/scoring-status.enum';
import { ProductionRubric } from '@/practice/rubric.types';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { User } from '@/users/entities/user.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

/**
 * One user attempt at producing a sentence using a target word, scored
 * asynchronously by the Gemma judge. Created `pending` by the API, filled in by
 * the practice-scoring worker.
 */
@Index('IDX_production_attempts_user_created', ['userId', 'createdAt'])
@Index('IDX_production_attempts_status', ['status'])
@Entity('production_attempts')
export class ProductionAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'vocabulary_id', type: 'uuid' })
  vocabularyId!: string;

  @ManyToOne(() => Vocabulary, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vocabulary_id' })
  vocabulary!: Vocabulary;

  @Column({
    type: 'enum',
    enum: PracticeModality,
    enumName: 'practice_modality_enum',
  })
  modality!: PracticeModality;

  @Column({ name: 'submitted_text', type: 'text' })
  submittedText!: string;

  @Column({
    type: 'enum',
    enum: ScoringStatus,
    enumName: 'scoring_status_enum',
    default: ScoringStatus.PENDING,
  })
  status!: ScoringStatus;

  // 0–100 overall; null until scored.
  @Column({ type: 'int', nullable: true })
  score!: number | null;

  // Demonstrated CEFR level of the sentence (NOT the user's certified level);
  // null until scored. Reuses the existing proficiency_level_enum.
  @Column({
    type: 'enum',
    enum: ProficiencyLevel,
    enumName: 'proficiency_level_enum',
    nullable: true,
  })
  cefr!: ProficiencyLevel | null;

  // Full structured judgment; null until scored.
  @Column({ type: 'jsonb', nullable: true })
  rubric!: ProductionRubric | null;

  // Short learner-facing feedback, lifted from the rubric for convenience.
  @Column({ type: 'text', nullable: true })
  feedback!: string | null;

  // Which model produced the score (e.g. gemma-3-27b-it); null until scored.
  @Column({ type: 'varchar', length: 64, nullable: true })
  model!: string | null;

  // Failure reason when status = failed; null otherwise.
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'scored_at', type: 'timestamptz', nullable: true })
  scoredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
