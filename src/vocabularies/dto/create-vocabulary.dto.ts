import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';

const LANGUAGE_CODE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;
const TOPIC_SLUG_REGEX = /^[a-z0-9-]+$/;

export class CreateTranslationDto {
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message: 'language must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  language!: string;

  @IsString()
  @Length(1, 255)
  translation!: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  note?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  source?: string;
}

export class CreateExampleDto {
  @IsString()
  @Length(1, 1000)
  sentence!: string;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  translation?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  source?: string;
}

export class CreateSenseDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  gloss?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  definition?: string;

  @IsOptional()
  @IsString()
  @Length(1, 512)
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  synonyms?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  antonyms?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => CreateTranslationDto)
  translations?: CreateTranslationDto[];

  // Two examples minimum: one is shown during study/reveal, others are held out
  // as test sentences by the learning-session feature so the learner doesn't
  // just memorize the single sentence they saw on study day.
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => CreateExampleDto)
  examples!: CreateExampleDto[];
}

export class CreateVocabularyDto {
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message: 'language must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  language!: string;

  @IsString()
  @Length(1, 128)
  lemma!: string;

  @IsEnum(PartOfSpeech, {
    message: `partOfSpeech must be one of ${Object.values(PartOfSpeech).join(', ')}`,
  })
  partOfSpeech!: PartOfSpeech;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  ipa?: string;

  @IsOptional()
  @IsEnum(ProficiencyLevel, {
    message: 'cefrLevel must be one of A1, A2, B1, B2, C1, C2',
  })
  cefrLevel?: ProficiencyLevel;

  @IsOptional()
  @IsInt()
  @Min(0)
  frequencyRank?: number;

  @IsOptional()
  @IsString()
  @Length(1, 512)
  audioUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Matches(TOPIC_SLUG_REGEX, {
    each: true,
    message: 'topic slug must match [a-z0-9-]+',
  })
  topics?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => CreateSenseDto)
  senses!: CreateSenseDto[];
}
