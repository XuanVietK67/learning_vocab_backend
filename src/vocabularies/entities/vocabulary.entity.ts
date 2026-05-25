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
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
import { VocabularyTranslation } from '@/vocabularies/entities/vocabulary-translation.entity';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';

@Index('IDX_vocabularies_lang_cefr_freq', [
  'language',
  'cefrLevel',
  'frequencyRank',
])
@Index('IDX_vocabularies_created_by_lang', ['createdByUserId', 'language'])
@Entity('vocabularies')
export class Vocabulary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({ type: 'varchar', length: 128 })
  lemma!: string;

  @Column({
    name: 'part_of_speech',
    type: 'enum',
    enum: PartOfSpeech,
    enumName: 'part_of_speech_enum',
  })
  partOfSpeech!: PartOfSpeech;

  @Column({ type: 'varchar', length: 128, nullable: true })
  ipa!: string | null;

  @Column({
    name: 'cefr_level',
    type: 'enum',
    enum: ProficiencyLevel,
    enumName: 'proficiency_level_enum',
    nullable: true,
  })
  cefrLevel!: ProficiencyLevel | null;

  @Column({ name: 'frequency_rank', type: 'int', nullable: true })
  frequencyRank!: number | null;

  @Column({ name: 'audio_url', type: 'varchar', length: 512, nullable: true })
  audioUrl!: string | null;

  @Column({ name: 'image_url', type: 'varchar', length: 512, nullable: true })
  imageUrl!: string | null;

  @Column({
    type: 'enum',
    enum: VocabularySource,
    enumName: 'vocabulary_source_enum',
    default: VocabularySource.SYSTEM,
  })
  source!: VocabularySource;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy!: User | null;

  @Column({
    type: 'enum',
    enum: Visibility,
    enumName: 'visibility_enum',
    default: Visibility.SYSTEM,
  })
  visibility!: Visibility;

  @Column({ name: 'is_approved', type: 'boolean', default: false })
  isApproved!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => VocabularyTranslation, (t) => t.vocabulary)
  translations!: VocabularyTranslation[];

  @OneToMany(() => VocabularyExample, (e) => e.vocabulary)
  examples!: VocabularyExample[];
}
