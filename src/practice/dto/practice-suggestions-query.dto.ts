import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PracticeSuggestionsQueryDto {
  // How many words to return. Capped at 20 to stay comfortably under the
  // per-user daily attempt cap (default 30/day) — a set shouldn't be able to
  // exhaust the quota in one go.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  count?: number;
}
