import { PracticeModality } from '@/practice/entities/practice-modality.enum';
import { ScoringStatus } from '@/practice/entities/scoring-status.enum';
import { ProductionRubric } from '@/practice/rubric.types';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

/** 202 response to a submit: the attempt is queued, poll for the result. */
export class AttemptAcceptedDto {
  attemptId!: string;
  status!: ScoringStatus; // always `pending` here
}

/** Full attempt projection returned by the poll endpoint. Scoring fields are
 * null until `status` is `scored`. */
export class AttemptResultDto {
  id!: string;
  vocabularyId!: string;
  modality!: PracticeModality;
  text!: string;
  status!: ScoringStatus;
  score!: number | null; // 0–100 overall
  cefr!: ProficiencyLevel | null; // demonstrated level of THIS sentence
  rubric!: ProductionRubric | null;
  feedback!: string | null;
  error!: string | null; // set when status = failed
  createdAt!: string; // ISO
  scoredAt!: string | null; // ISO, set when scored
}
