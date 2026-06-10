export class LeaderboardEntryDto {
  rank!: number;
  userId!: string;
  username!: string | null;
  avatarUrl!: string | null;
  value!: number;
}

export class LeaderboardMeDto {
  // null when the caller has no qualifying activity or has opted out.
  rank!: number | null;
  value!: number;
}

export class LeaderboardResponseDto {
  metric!: string;
  window!: string;
  // null for window=all.
  periodStart!: string | null;
  periodEnd!: string;
  limit!: number;
  data!: LeaderboardEntryDto[];
  me!: LeaderboardMeDto;
}
