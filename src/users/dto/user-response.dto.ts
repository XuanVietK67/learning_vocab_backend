import { Expose } from 'class-transformer';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { UserRole } from '@/users/entities/user.entity';

export class UserResponseDto {
  @Expose() id!: string;
  @Expose() email!: string;
  @Expose() username!: string | null;
  @Expose() avatarUrl!: string | null;
  @Expose() role!: UserRole;
  @Expose() isEmailVerified!: boolean;
  @Expose() isActive!: boolean;
  @Expose() isOnboarded!: boolean;
  @Expose() nativeLanguage!: string | null;
  @Expose() targetLanguage!: string | null;
  @Expose() proficiencyLevel!: ProficiencyLevel | null;
  @Expose() dailyGoalMinutes!: number | null;
  @Expose() weeklyVocabGoal!: number | null;
  @Expose() leaderboardOptOut!: boolean;
  @Expose() createdAt!: Date;
  @Expose() updatedAt!: Date;
}
