import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Visibility } from '@/vocabularies/entities/visibility.enum';

const LANGUAGE_CODE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;
const TOPIC_SLUG_REGEX = /^[a-z0-9-]+$/;

export enum AdminVocabularySortBy {
  CREATED_AT = 'createdAt',
  FREQUENCY_RANK = 'frequencyRank',
}

export enum SortDirection {
  ASC = 'asc',
  DESC = 'desc',
}

export class AdminVocabularyQueryDto {
  @IsOptional()
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message: 'language must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  language?: string;

  @IsOptional()
  @IsEnum(ProficiencyLevel, {
    message: 'cefrLevel must be one of A1, A2, B1, B2, C1, C2',
  })
  cefrLevel?: ProficiencyLevel;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(TOPIC_SLUG_REGEX, { message: 'topic slug must match [a-z0-9-]+' })
  topic?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  q?: string;

  @IsOptional()
  @IsEnum(VocabularySource, { message: 'source must be one of system, user' })
  source?: VocabularySource;

  // Missing / empty / unrecognized → undefined (no filter). Only literal
  // "true"/"false" enable the filter. Read the RAW query value from `obj`, not
  // the `value` arg: the global pipe's enableImplicitConversion coerces the
  // string to this field's boolean type first via Boolean("false") === true, so
  // `value` would already be the wrong boolean. `obj.isApproved` is untouched.
  @IsOptional()
  @Transform(({ obj }) => {
    const raw = (obj as { isApproved?: unknown }).isApproved;
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    return undefined;
  })
  isApproved?: boolean;

  @IsOptional()
  @IsEnum(Visibility, {
    message: 'visibility must be one of system, private, public',
  })
  visibility?: Visibility;

  @IsOptional()
  @IsUUID('4')
  createdByUserId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message:
      'translationLang must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  translationLang?: string;

  @IsOptional()
  @IsEnum(AdminVocabularySortBy, {
    message: 'sortBy must be one of createdAt, frequencyRank',
  })
  sortBy: AdminVocabularySortBy = AdminVocabularySortBy.CREATED_AT;

  @IsOptional()
  @IsEnum(SortDirection, { message: 'sortDir must be one of asc, desc' })
  sortDir: SortDirection = SortDirection.ASC;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
