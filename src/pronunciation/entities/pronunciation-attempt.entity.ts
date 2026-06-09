import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '@/users/entities/user.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import type {
  AudioQuality,
  PhonemeScore,
} from '@/pronunciation/pronunciation.types';

@Index('IDX_pron_attempts_user_created', ['userId', 'createdAt'])
@Index('IDX_pron_attempts_user_vocab', ['userId', 'vocabularyId'])
@Entity('pronunciation_attempts')
export class PronunciationAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // Null when the learner scored a free-text word rather than a catalog entry.
  @Column({ name: 'vocabulary_id', type: 'uuid', nullable: true })
  vocabularyId!: string | null;

  @ManyToOne(() => Vocabulary, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'vocabulary_id' })
  vocabulary!: Vocabulary | null;

  // Denormalized — always the word that was actually scored.
  @Column({ type: 'varchar', length: 128 })
  word!: string;

  @Column({ name: 'overall_score', type: 'smallint' })
  overallScore!: number;

  @Column({ name: 'phoneme_scores', type: 'jsonb' })
  phonemeScores!: PhonemeScore[];

  @Column({ name: 'audio_quality', type: 'jsonb', nullable: true })
  audioQuality!: AudioQuality | null;

  @Column({ name: 'model_version', type: 'varchar', length: 64 })
  modelVersion!: string;

  // Reserved for when learner audio is retained (Cloudinary) — unused in v1.
  @Column({ name: 'audio_url', type: 'varchar', length: 512, nullable: true })
  audioUrl!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
