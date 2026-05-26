import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

const LANGUAGE_CODE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;

export class CreateDeckDto {
  @IsString()
  @Length(1, 128)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message: 'language must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  language!: string;

  @IsOptional()
  @IsEnum(ProficiencyLevel, {
    message: 'cefrLevel must be one of A1, A2, B1, B2, C1, C2',
  })
  cefrLevel?: ProficiencyLevel;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Type(() => String)
  @IsUUID('4', { each: true })
  vocabularyIds?: string[];
}
