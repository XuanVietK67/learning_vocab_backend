import { Expose } from 'class-transformer';
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
  @Expose() createdAt!: Date;
  @Expose() updatedAt!: Date;
}
