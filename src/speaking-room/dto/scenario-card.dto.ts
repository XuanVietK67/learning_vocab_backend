import { Expose, Type } from 'class-transformer';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

// The learner-facing view of a published scenario (the scene card shown when
// browsing/recommending). Deliberately omits admin-only fields (status, version,
// createdBy, introVideoScript) — only what a learner needs to pick and start.
export class ScenarioCardDto {
  @Expose() id!: string;
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
  @Expose() introVideoUrl!: string | null;
}

export class PaginatedScenarioCardsDto {
  @Expose()
  @Type(() => ScenarioCardDto)
  data!: ScenarioCardDto[];

  @Expose() page!: number;
  @Expose() limit!: number;
  @Expose() total!: number;
}
