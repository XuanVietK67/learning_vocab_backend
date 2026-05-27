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

@Entity('vocabulary_examples')
export class VocabularyExample {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_vocabulary_examples_sense_id')
  @Column({ name: 'sense_id', type: 'uuid' })
  senseId!: string;

  @ManyToOne(() => VocabularySense, (sense) => sense.examples, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'sense_id' })
  sense!: VocabularySense;

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
