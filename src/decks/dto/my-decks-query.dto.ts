import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

const LANGUAGE_CODE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;

export class MyDecksQueryDto {
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
