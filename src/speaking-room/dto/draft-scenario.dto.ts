import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

// Slug-style topic, matching CreateScenarioDto so an admin can pin the topic.
const TOPIC_SLUG_REGEX = /^[a-z0-9-]+$/;

// Admin input for the LLM draft helper: a short brief, plus optional hard
// constraints. The server returns an unsaved ScenarioDraft for review — it does
// not persist anything.
export class DraftScenarioDto {
  @IsString()
  @Length(3, 500)
  brief!: string;

  // When set, the draft MUST target this level; otherwise the model infers it.
  @IsOptional()
  @IsEnum(ProficiencyLevel, {
    message: 'cefrLevel must be one of A1, A2, B1, B2, C1, C2',
  })
  cefrLevel?: ProficiencyLevel;

  // When set, the draft MUST use this topic slug.
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(TOPIC_SLUG_REGEX, {
    message: 'topic must contain only lowercase letters, digits, and hyphens',
  })
  topic?: string;
}
