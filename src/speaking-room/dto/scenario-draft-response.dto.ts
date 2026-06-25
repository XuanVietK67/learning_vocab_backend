import { Expose } from 'class-transformer';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

// The LLM-drafted, *unsaved* scenario spec returned to the admin for review.
// Fields mirror CreateScenarioDto so the frontend can prefill the create form;
// `model` reports which LLM produced the draft.
export class ScenarioDraftResponseDto {
  @Expose() title!: string;
  @Expose() topic!: string;
  @Expose() cefrLevel!: ProficiencyLevel | null;
  @Expose() setting!: string;
  @Expose() aiRole!: string;
  @Expose() userRole!: string;
  @Expose() goal!: string;
  @Expose() openingLine!: string;
  @Expose() seedPhrases!: string[];
  @Expose() estTurns!: number | null;
  @Expose() introVideoScript!: string | null;
  @Expose() model!: string;
}
