export class ActivityDayDto {
  // Local day (per the request `tz`), YYYY-MM-DD.
  date!: string;
  reviews!: number;
  newWords!: number;
}

export class ActivityResponseDto {
  from!: string;
  to!: string;
  timezone!: string;
  totalReviews!: number;
  totalNewWords!: number;
  activeDays!: number;
  maxReviews!: number;
  // Only active days; the client fills empty cells of the grid.
  days!: ActivityDayDto[];
}
