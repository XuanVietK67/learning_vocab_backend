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
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Index(
  'UQ_vocabulary_translations_vocab_lang_translation',
  ['vocabularyId', 'language', 'translation'],
  { unique: true },
)
@Entity('vocabulary_translations')
export class VocabularyTranslation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'vocabulary_id', type: 'uuid' })
  vocabularyId!: string;

  @ManyToOne(() => Vocabulary, (vocab) => vocab.translations, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'vocabulary_id' })
  vocabulary!: Vocabulary;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({ type: 'varchar', length: 255 })
  translation!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
