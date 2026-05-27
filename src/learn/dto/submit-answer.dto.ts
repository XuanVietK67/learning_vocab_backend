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

  // Free-form string for typing/build/MCQ-index-as-string. The grader interprets
  // this per-type. We accept a generous length cap to allow sentence build.
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
