import { Expose, Type } from 'class-transformer';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { ScenarioStatus } from '@/speaking-room/entities/scenario-status.enum';

export class ScenarioResponseDto {
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
  @Expose() introVideoScript!: string | null;
  @Expose() introVideoUrl!: string | null;
  @Expose() status!: ScenarioStatus;
  @Expose() version!: number;
  @Expose() createdBy!: string | null;
  @Expose() createdAt!: Date;
  @Expose() updatedAt!: Date;
}

export class PaginatedScenariosResponseDto {
  @Expose()
  @Type(() => ScenarioResponseDto)
  data!: ScenarioResponseDto[];

  @Expose() page!: number;
  @Expose() limit!: number;
  @Expose() total!: number;
}
