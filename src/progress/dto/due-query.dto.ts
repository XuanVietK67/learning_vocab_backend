import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const LANGUAGE_CODE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;

export class DueQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message:
      'translationLang must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  translationLang?: string;
}
