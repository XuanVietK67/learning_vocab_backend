import { IsEnum, IsString, IsUUID, Length } from 'class-validator';
import { PracticeModality } from '@/practice/entities/practice-modality.enum';

export class SubmitAttemptDto {
  @IsUUID('4')
  vocabularyId!: string;

  // The user's sentence — typed, or a client-side speech-to-text transcript.
  // One sentence; capped to keep token cost (and the shared free quota) bounded.
  @IsString()
  @Length(1, 280)
  text!: string;

  // Records how the text was produced; scoring is identical for both.
  @IsEnum(PracticeModality)
  modality!: PracticeModality;
}
