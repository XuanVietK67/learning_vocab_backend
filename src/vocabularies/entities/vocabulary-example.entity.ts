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

@Entity('vocabulary_examples')
export class VocabularyExample {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_vocabulary_examples_vocabulary_id')
  @Column({ name: 'vocabulary_id', type: 'uuid' })
  vocabularyId!: string;

  @ManyToOne(() => Vocabulary, (vocab) => vocab.examples, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'vocabulary_id' })
  vocabulary!: Vocabulary;

  @Column({ type: 'text' })
  sentence!: string;

  @Column({ type: 'text', nullable: true })
  translation!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  source!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
