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
import { User } from '@/users/entities/user.entity';
import { VocabEnrichmentJobStatus } from '@/vocabularies/entities/vocab-enrichment-job-status.enum';

/**
 * One quick-create request: an admin supplied only a lemma (+ language), and a
 * background worker enriches it (dictionary + Gemma) into one or more draft
 * vocabularies. Created `pending` by the API, filled in by the enrichment
 * worker. `resultVocabularyIds` holds the draft vocab rows the job produced.
 */
@Index('IDX_vocab_enrichment_jobs_status', ['status'])
@Index('IDX_vocab_enrichment_jobs_lang_lemma', ['language', 'lemma'])
@Index('IDX_vocab_enrichment_jobs_batch_id', ['batchId'])
@Entity('vocab_enrichment_jobs')
export class VocabEnrichmentJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({ type: 'varchar', length: 128 })
  lemma!: string;

  // Groups the per-lemma jobs created by one bulk quick-create submission.
  // Null for single-lemma quick-create jobs.
  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId!: string | null;

  @Column({
    type: 'enum',
    enum: VocabEnrichmentJobStatus,
    enumName: 'vocab_enrichment_job_status_enum',
    default: VocabEnrichmentJobStatus.PENDING,
  })
  status!: VocabEnrichmentJobStatus;

  // Draft vocabularies created by this job (one per resolved part of speech).
  // Defaulted to '{}' so the column is never null and consumers get an array.
  @Column({
    name: 'result_vocabulary_ids',
    type: 'uuid',
    array: true,
    default: () => "'{}'",
  })
  resultVocabularyIds!: string[];

  // Failure reason when status = failed; null otherwise.
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'requested_by_user_id' })
  requestedBy!: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
