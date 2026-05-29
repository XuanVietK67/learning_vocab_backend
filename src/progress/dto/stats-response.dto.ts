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
  // ISO timestamp of the soonest progress row scheduled in the future
  // (next_review_at > now). Null when the user has no future-scheduled
  // cards — either nothing enrolled yet, or every card is already due.
  nextDueAt!: string | null;
}
