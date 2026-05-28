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

export class UpdateUserProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message:
      'nativeLanguage must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  nativeLanguage?: string;

  @IsOptional()
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message:
      'targetLanguage must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  targetLanguage?: string;

  @IsOptional()
  @IsEnum(ProficiencyLevel, {
    message: 'proficiencyLevel must be one of A1, A2, B1, B2, C1, C2',
  })
  proficiencyLevel?: ProficiencyLevel;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  dailyGoalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(250)
  weeklyVocabGoal?: number;
}
