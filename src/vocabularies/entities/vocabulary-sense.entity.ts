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
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularyTranslation } from '@/vocabularies/entities/vocabulary-translation.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Index('UQ_vocabulary_senses_vocab_order', ['vocabularyId', 'senseOrder'], {
  unique: true,
})
@Entity('vocabulary_senses')
export class VocabularySense {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_vocabulary_senses_vocabulary_id')
  @Column({ name: 'vocabulary_id', type: 'uuid' })
  vocabularyId!: string;

  @ManyToOne(() => Vocabulary, (vocab) => vocab.senses, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'vocabulary_id' })
  vocabulary!: Vocabulary;

  @Column({ name: 'sense_order', type: 'smallint', default: 1 })
  senseOrder!: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  gloss!: string | null;

  @Column({ type: 'text', nullable: true })
  definition!: string | null;

  @Column({ name: 'image_url', type: 'varchar', length: 512, nullable: true })
  imageUrl!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => VocabularyTranslation, (t) => t.sense)
  translations!: VocabularyTranslation[];

  @OneToMany(() => VocabularyExample, (e) => e.sense)
  examples!: VocabularyExample[];
}
