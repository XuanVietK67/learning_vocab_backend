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

// Append-only log of graded review events — one row per review. Powers the
// activity heatmap, the (exact) study streak, and the new-words leaderboard.
@Index('IDX_learning_activity_user_reviewed', ['userId', 'reviewedAt'])
@Entity('learning_activity')
export class LearningActivity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // Nullable on purpose: deleting a word must not erase the historical
  // day-count, so the FK is set to null instead of cascading the row away.
  @Column({ name: 'vocabulary_id', type: 'uuid', nullable: true })
  vocabularyId!: string | null;

  @ManyToOne(() => Vocabulary, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'vocabulary_id' })
  vocabulary!: Vocabulary | null;

  // The actual event time (the `now` used when grading). Day-bucketing key.
  @Column({ name: 'reviewed_at', type: 'timestamptz' })
  reviewedAt!: Date;

  @Column({ type: 'smallint' })
  quality!: number;

  @Column({ name: 'is_correct', type: 'boolean' })
  isCorrect!: boolean;

  // True when this was the word's first-ever graded review. Drives the
  // heatmap's `newWords` metric and the "new words this week" board.
  @Column({ name: 'was_new', type: 'boolean' })
  wasNew!: boolean;

  // True when this review transitioned the card's status into `mastered`.
  @Column({ name: 'became_mastered', type: 'boolean' })
  becameMastered!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
