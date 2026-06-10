import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum LeaderboardMetric {
  WORDS_MASTERED = 'words_mastered',
  NEW_WORDS = 'new_words',
}

export enum LeaderboardWindow {
  ALL = 'all',
  WEEK = 'week',
  MONTH = 'month',
}

export class LeaderboardQueryDto {
  @IsOptional()
  @IsEnum(LeaderboardMetric, {
    message: 'metric must be one of words_mastered, new_words',
  })
  metric: LeaderboardMetric = LeaderboardMetric.WORDS_MASTERED;

  // Default depends on `metric` and is resolved in the service
  // (words_mastered → all, new_words → week).
  @IsOptional()
  @IsEnum(LeaderboardWindow, {
    message: 'window must be one of all, week, month',
  })
  window?: LeaderboardWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}
