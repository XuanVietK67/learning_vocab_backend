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
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { Visibility } from '@/vocabularies/entities/visibility.enum';

@Index('IDX_decks_lang_cefr', ['language', 'cefrLevel'])
@Index('IDX_decks_owner_id', ['ownerId'])
@Entity('decks')
export class Deck {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({
    name: 'cefr_level',
    type: 'enum',
    enum: ProficiencyLevel,
    enumName: 'proficiency_level_enum',
    nullable: true,
  })
  cefrLevel!: ProficiencyLevel | null;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId!: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'owner_id' })
  owner!: User | null;

  @Column({
    type: 'enum',
    enum: Visibility,
    enumName: 'visibility_enum',
    default: Visibility.SYSTEM,
  })
  visibility!: Visibility;

  @Column({ name: 'vocab_count', type: 'int', default: 0 })
  vocabCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => DeckVocabulary, (dv) => dv.deck)
  deckVocabularies!: DeckVocabulary[];
}
