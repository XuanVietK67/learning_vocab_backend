import {
  ArrayMaxSize,
  IsArray,
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

// Slug-style recommendation tag (e.g. `food`, `travel`, `work`) so Phase 2 can
// match a scenario to the topic a learner is studying.
const TOPIC_SLUG_REGEX = /^[a-z0-9-]+$/;

// Admin-supplied inputs for a reusable speaking-room scenario (Phase 1).
// `status`, `version`, `createdBy`, and `introVideoUrl` are server-controlled —
// `introVideoUrl` is attached later via the intro-video endpoint.
export class CreateScenarioDto {
  @IsString()
  @Length(1, 160)
  title!: string;

  @IsString()
  @Length(1, 64)
  @Matches(TOPIC_SLUG_REGEX, {
    message: 'topic must contain only lowercase letters, digits, and hyphens',
  })
  topic!: string;

  // Omit (or null) means the scenario targets "any" CEFR level.
  @IsOptional()
  @IsEnum(ProficiencyLevel, {
    message: 'cefrLevel must be one of A1, A2, B1, B2, C1, C2',
  })
  cefrLevel?: ProficiencyLevel;

  @IsString()
  @Length(1, 2000)
  setting!: string;

  @IsString()
  @Length(1, 120)
  aiRole!: string;

  @IsString()
  @Length(1, 120)
  userRole!: string;

  @IsString()
  @Length(1, 1000)
  goal!: string;

  @IsString()
  @Length(1, 1000)
  openingLine!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  seedPhrases?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  estTurns?: number;

  // Optional script for the (later) HyperFrames intro-video render. Inert in
  // Phase 1 — stored but not rendered.
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  introVideoScript?: string;
}
