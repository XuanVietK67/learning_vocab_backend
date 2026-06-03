import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { QuestionType } from '@/learn/enums/question-type.enum';

export class SubmitAnswerDto {
  @IsUUID('4')
  vocabularyId!: string;

  @IsEnum(QuestionType)
  type!: QuestionType;

  @IsUUID('4')
  exampleId!: string;

  // Position of the question within the word's lesson ladder (echoed from the
  // item; both are signed). The server reschedules only on the final step
  // (stepIndex === stepCount - 1); earlier steps grade for feedback only.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stepIndex!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  stepCount!: number;

  // Free-form string for typing/build/MCQ-index-as-string. For FLASHCARD it is
  // the self-rating ("forgot" | "hard" | "good" | "easy"). The grader
  // interprets this per-type. We accept a generous length cap for build.
  @IsString()
  @Length(0, 1000)
  userAnswer!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  latencyMs!: number;

  @IsString()
  @Length(1, 128)
  nonce!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  issuedAtMs!: number;

  @IsString()
  @Length(1, 256)
  signature!: string;

  // Must echo back the translationLang used when the session was created
  // (server signs it into the HMAC for MEANING_IN_CONTEXT / SENSE_DISAMBIGUATION).
  @IsOptional()
  @IsString()
  @Length(2, 8)
  translationLang?: string;

  // Optional client-correlation id from the session response (not signed,
  // not verified — purely for client-side debugging).
  @IsOptional()
  @IsString()
  @Length(1, 128)
  sessionId?: string;
}
