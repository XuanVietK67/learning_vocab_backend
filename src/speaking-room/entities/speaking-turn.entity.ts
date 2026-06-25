import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SpeakingSession } from '@/speaking-room/entities/speaking-session.entity';
import { SpeakingTurnRole } from '@/speaking-room/entities/speaking-turn-role.enum';
import { Correction } from '@/speaking-room/speaking-room.types';

/**
 * One utterance in a session transcript. AI and user turns are interleaved in
 * `turnIndex` order. For AI turns, `text` is the spoken reply and `corrections`
 * may hold the on-screen feedback for the immediately preceding user turn; for
 * user turns, `text` is the typed message (later: STT transcript).
 */
@Index('IDX_speaking_turns_session_index', ['sessionId', 'turnIndex'])
@Entity('speaking_turns')
export class SpeakingTurn {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => SpeakingSession, (session) => session.turns, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'session_id' })
  session!: SpeakingSession;

  // 0-based position in the conversation; the AI opening line is index 0.
  @Column({ name: 'turn_index', type: 'integer' })
  turnIndex!: number;

  @Column({
    type: 'enum',
    enum: SpeakingTurnRole,
    enumName: 'speaking_turn_role_enum',
  })
  role!: SpeakingTurnRole;

  @Column({ type: 'text' })
  text!: string;

  // On-screen corrections attached to an AI turn (for the prior user turn);
  // null when there are none or for user turns.
  @Column({ type: 'jsonb', nullable: true })
  corrections!: Correction[] | null;

  // Target words the AI wove into this turn; empty for user turns.
  @Column({
    name: 'used_target_words',
    type: 'text',
    array: true,
    default: '{}',
  })
  usedTargetWords!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
