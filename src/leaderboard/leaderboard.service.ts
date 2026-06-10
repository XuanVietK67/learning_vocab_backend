import {
  BadRequestException,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { UserWordProgress } from '@/progress/entities/user-word-progress.entity';
import { User, UserRole } from '@/users/entities/user.entity';
import {
  LeaderboardMetric,
  LeaderboardQueryDto,
  LeaderboardWindow,
} from './dto/leaderboard-query.dto';
import {
  LeaderboardMeDto,
  LeaderboardResponseDto,
} from './dto/leaderboard-response.dto';

interface RankedRow {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  value: number;
}

@Injectable()
export class LeaderboardService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async getLeaderboard(
    userId: string,
    query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponseDto> {
    const metric = query.metric;
    const limit = query.limit;

    if (metric === LeaderboardMetric.NEW_WORDS) {
      // Phase 2 — depends on the `learning_activity` log (heatmap plan), which
      // is not built yet. Surface a clear "not live" signal until it ships.
      throw new NotImplementedException(
        'the new_words leaderboard is not available yet',
      );
    }

    // words_mastered — all-time only.
    const window = query.window ?? LeaderboardWindow.ALL;
    if (window !== LeaderboardWindow.ALL) {
      throw new BadRequestException('words_mastered supports only window=all');
    }

    const now = new Date();

    // v1 (thesis scale): compute the full eligible ranking live, then derive
    // both the visible top-N and the caller's own rank from the same ordered
    // set so they can never disagree. At scale, cache this per (metric, window)
    // and compute `me` with a COUNT(value > my_value) query instead.
    const ranked = await this.rankMasteredAllTime();

    const data = ranked.slice(0, limit).map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      username: row.username,
      avatarUrl: row.avatarUrl,
      value: row.value,
    }));

    return {
      metric,
      window,
      periodStart: null,
      periodEnd: now.toISOString(),
      limit,
      data,
      me: this.resolveMe(userId, ranked),
    };
  }

  // Every eligible learner with ≥1 mastered word, ordered for ranking.
  // Eligible = real, active learner who has not opted out.
  private rankMasteredAllTime(): Promise<RankedRow[]> {
    return this.userRepo
      .createQueryBuilder('u')
      .innerJoin(
        UserWordProgress,
        'p',
        'p.user_id = u.id AND p.status = :mastered',
        { mastered: ProgressStatus.MASTERED },
      )
      .select('u.id', 'userId')
      .addSelect('u.username', 'username')
      .addSelect('u.avatar_url', 'avatarUrl')
      .addSelect('COUNT(p.id)::int', 'value')
      .where('u.role = :role', { role: UserRole.USER })
      .andWhere('u.is_active = true')
      .andWhere('u.leaderboard_opt_out = false')
      .groupBy('u.id')
      .having('COUNT(p.id) > 0')
      .orderBy('COUNT(p.id)', 'DESC')
      .addOrderBy('u.username', 'ASC')
      .getRawMany<RankedRow>();
  }

  // The caller's standing. If they're in the ranked set (eligible + value > 0)
  // their rank is their position; otherwise (opted out, ineligible, or zero
  // mastered) they get { rank: null, value: 0 } per the contract.
  private resolveMe(userId: string, ranked: RankedRow[]): LeaderboardMeDto {
    const index = ranked.findIndex((row) => row.userId === userId);
    if (index >= 0) {
      return { rank: index + 1, value: ranked[index].value };
    }
    return { rank: null, value: 0 };
  }
}
