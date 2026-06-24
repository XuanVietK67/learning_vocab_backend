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
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { User } from '@/users/entities/user.entity';
import { ScenarioStatus } from '@/speaking-room/entities/scenario-status.enum';

// A reusable, admin-authored speaking-room spec. Created once, practiced by
// many learners (Phase 2). The only expensive field is `introVideoUrl`, which
// is rendered once and reused; in Phase 1 it is authored manually / left null.
//
// `cefrLevel` reuses the existing proficiency_level_enum: a NULL value means
// the scenario targets "any" level.
@Index('IDX_scenarios_topic', ['topic'])
@Index('IDX_scenarios_status', ['status'])
@Index('IDX_scenarios_cefr_level', ['cefrLevel'])
@Entity('scenarios')
export class Scenario {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  // Free-form recommendation tag, e.g. `food`, `travel`, `work`.
  @Column({ type: 'varchar', length: 64 })
  topic!: string;

  @Column({
    name: 'cefr_level',
    type: 'enum',
    enum: ProficiencyLevel,
    enumName: 'proficiency_level_enum',
    nullable: true,
  })
  cefrLevel!: ProficiencyLevel | null;

  @Column({ type: 'text' })
  setting!: string;

  @Column({ name: 'ai_role', type: 'varchar', length: 120 })
  aiRole!: string;

  @Column({ name: 'user_role', type: 'varchar', length: 120 })
  userRole!: string;

  @Column({ type: 'text' })
  goal!: string;

  @Column({ name: 'opening_line', type: 'text' })
  openingLine!: string;

  @Column({ name: 'seed_phrases', type: 'text', array: true, default: '{}' })
  seedPhrases!: string[];

  @Column({ name: 'est_turns', type: 'smallint', nullable: true })
  estTurns!: number | null;

  // Intro-video fields are inert in Phase 1: the spec is reusable without a
  // video. They exist so the async HyperFrames render (Phase 1b/2) can attach a
  // URL without a schema change.
  @Column({ name: 'intro_video_script', type: 'text', nullable: true })
  introVideoScript!: string | null;

  @Column({
    name: 'intro_video_url',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  introVideoUrl!: string | null;

  @Column({
    type: 'enum',
    enum: ScenarioStatus,
    enumName: 'scenario_status_enum',
    default: ScenarioStatus.DRAFT,
  })
  status!: ScenarioStatus;

  // Bumped on every edit to a published scenario so Phase 2 in-flight sessions
  // can keep the spec they started with.
  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator!: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
