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
import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { User } from '@/users/entities/user.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Index('UQ_user_word_progress_user_vocab', ['userId', 'vocabularyId'], {
  unique: true,
})
@Index('IDX_user_word_progress_user_next_review', ['userId', 'nextReviewAt'])
@Index('IDX_user_word_progress_user_status', ['userId', 'status'])
@Entity('user_word_progress')
export class UserWordProgress {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'vocabulary_id', type: 'uuid' })
  vocabularyId!: string;

  @ManyToOne(() => Vocabulary, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'vocabulary_id' })
  vocabulary!: Vocabulary;

  @Column({
    type: 'enum',
    enum: ProgressStatus,
    enumName: 'progress_status_enum',
    default: ProgressStatus.NEW,
  })
  status!: ProgressStatus;

  @Column({ type: 'int', default: 0 })
  repetitions!: number;

  @Column({
    name: 'ease_factor',
    type: 'numeric',
    precision: 4,
    scale: 2,
    default: 2.5,
    transformer: {
      to: (v: number) => v,
      from: (v: string | number) => (typeof v === 'string' ? parseFloat(v) : v),
    },
  })
  easeFactor!: number;

  @Column({ name: 'interval_days', type: 'int', default: 0 })
  intervalDays!: number;

  @Column({
    name: 'next_review_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  nextReviewAt!: Date;

  @Column({ name: 'last_reviewed_at', type: 'timestamptz', nullable: true })
  lastReviewedAt!: Date | null;

  @Column({ name: 'correct_count', type: 'int', default: 0 })
  correctCount!: number;

  @Column({ name: 'incorrect_count', type: 'int', default: 0 })
  incorrectCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
