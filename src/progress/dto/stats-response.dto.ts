export class ProgressCountsDto {
  new!: number;
  learning!: number;
  review!: number;
  mastered!: number;
}

export class StatsResponseDto {
  streakDays!: number;
  dueNow!: number;
  reviewedToday!: number;
  dailyGoalMinutes!: number | null;
  counts!: ProgressCountsDto;
}
