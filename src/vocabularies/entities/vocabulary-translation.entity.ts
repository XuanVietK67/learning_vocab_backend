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
import { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';

@Index(
  'UQ_vocabulary_translations_sense_lang_translation',
  ['senseId', 'language', 'translation'],
  { unique: true },
)
@Entity('vocabulary_translations')
export class VocabularyTranslation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'sense_id', type: 'uuid' })
  senseId!: string;

  @ManyToOne(() => VocabularySense, (sense) => sense.translations, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'sense_id' })
  sense!: VocabularySense;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({ type: 'varchar', length: 255 })
  translation!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  // Provenance of this translation: 'manual' | 'mt:<engine>' | 'cambridge' | ...
  @Column({ type: 'varchar', length: 32, nullable: true })
  source!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
