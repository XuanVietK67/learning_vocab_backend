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

const TOPIC_SLUG_REGEX = /^[a-z0-9-]+$/;

// Learner-facing browse filters over PUBLISHED scenarios only. Status is not a
// filter here (the catalog never exposes drafts/retired specs).
export class ScenarioBrowseQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(TOPIC_SLUG_REGEX, { message: 'topic must match [a-z0-9-]+' })
  topic?: string;

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
