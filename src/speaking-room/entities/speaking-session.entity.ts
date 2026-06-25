import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { User } from '@/users/entities/user.entity';
import { Scenario } from '@/speaking-room/entities/scenario.entity';
import { SpeakingReportStatus } from '@/speaking-room/entities/speaking-report-status.enum';
import { SpeakingSessionStatus } from '@/speaking-room/entities/speaking-session-status.enum';
import { SpeakingTurn } from '@/speaking-room/entities/speaking-turn.entity';
import type {
  ScenarioSnapshot,
  SessionReport,
} from '@/speaking-room/speaking-room.types';

/**
 * One learner's live practice run of a Phase 1 scenario. Per-user data (CEFR
 * level + chosen target words) is snapshotted at start so the conversation stays
 * stable even if the user's profile or the scenario is edited mid-session
 * (scenarios bump `version` on edit — see ScenariosService.saveBumpingVersion).
 */
@Index('IDX_speaking_sessions_user_created', ['userId', 'createdAt'])
@Index('IDX_speaking_sessions_scenario', ['scenarioId'])
@Entity('speaking_sessions')
export class SpeakingSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'scenario_id', type: 'uuid' })
  scenarioId!: string;

  @ManyToOne(() => Scenario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scenario_id' })
  scenario!: Scenario;

  // The scenario version this session started on (for reference/analytics).
  @Column({ name: 'scenario_version', type: 'integer' })
  scenarioVersion!: number;

  // Frozen copy of the scenario's textual fields used by the live prompt, so an
  // admin edit mid-session never changes this conversation's spec.
  @Column({ name: 'scenario_snapshot', type: 'jsonb' })
  scenarioSnapshot!: ScenarioSnapshot;

  // CEFR level used to pitch the AI's language, snapshotted from the user's
  // profile (falling back to the scenario's level). NULL = no level pinned.
  @Column({
    name: 'cefr_level',
    type: 'enum',
    enum: ProficiencyLevel,
    enumName: 'proficiency_level_enum',
    nullable: true,
  })
  cefrLevel!: ProficiencyLevel | null;

  // The vocabulary IDs the learner chose to practise (validated at start).
  @Column({
    name: 'selected_vocabulary_ids',
    type: 'uuid',
    array: true,
    default: '{}',
  })
  selectedVocabularyIds!: string[];

  // Lemma snapshot of the chosen words, resolved once at start so every turn's
  // prompt is cheap and stable even if a word is later edited/deleted.
  @Column({ name: 'selected_words', type: 'text', array: true, default: '{}' })
  selectedWords!: string[];

  @Column({
    type: 'enum',
    enum: SpeakingSessionStatus,
    enumName: 'speaking_session_status_enum',
    default: SpeakingSessionStatus.ACTIVE,
  })
  status!: SpeakingSessionStatus;

  // End-of-session feedback. report stays null until the session is ended.
  @Column({
    name: 'report_status',
    type: 'enum',
    enum: SpeakingReportStatus,
    enumName: 'speaking_report_status_enum',
    default: SpeakingReportStatus.PENDING,
  })
  reportStatus!: SpeakingReportStatus;

  @Column({ type: 'jsonb', nullable: true })
  report!: SessionReport | null;

  // Which model produced the report (e.g. llama-3.3-70b-versatile); null until ready.
  @Column({ name: 'report_model', type: 'varchar', length: 64, nullable: true })
  reportModel!: string | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => SpeakingTurn, (turn) => turn.session)
  turns!: SpeakingTurn[];
}
