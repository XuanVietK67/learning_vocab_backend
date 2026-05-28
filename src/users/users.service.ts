import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { AuthProvider, UserIdentity } from './entities/user-identity.entity';
import { User, UserRole } from './entities/user.entity';

const BCRYPT_ROUNDS = 12;

export interface CreateLocalUserInput {
  email: string;
  username: string;
  password: string;
}

export interface CreateSocialUserInput {
  email: string;
  provider: AuthProvider;
  providerUserId: string;
  avatarUrl?: string | null;
  emailVerified: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(UserIdentity)
    private readonly identitiesRepo: Repository<UserIdentity>,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('user not found');
    }
    return user;
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { email: email.toLowerCase() } });
  }

  async findByIdentity(
    provider: AuthProvider,
    providerUserId: string,
  ): Promise<User | null> {
    const identity = await this.identitiesRepo.findOne({
      where: { provider, providerUserId },
      relations: { user: true },
    });
    return identity?.user ?? null;
  }

  async createLocal(input: CreateLocalUserInput): Promise<User> {
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim();

    const existing = await this.usersRepo.findOne({
      where: [{ email }, { username }],
      select: { id: true, email: true, username: true },
    });
    if (existing) {
      if (existing.email === email) {
        throw new ConflictException('email already registered');
      }
      throw new ConflictException('username already taken');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = this.usersRepo.create({
      email,
      username,
      passwordHash,
      isOnboarded: false,
    });
    return this.usersRepo.save(user);
  }

  async createFromSocial(input: CreateSocialUserInput): Promise<User> {
    const email = input.email.trim().toLowerCase();

    const user = this.usersRepo.create({
      email,
      username: null,
      passwordHash: null,
      avatarUrl: input.avatarUrl ?? null,
      isEmailVerified: input.emailVerified,
      isOnboarded: false,
    });
    const saved = await this.usersRepo.save(user);

    await this.identitiesRepo.save(
      this.identitiesRepo.create({
        userId: saved.id,
        provider: input.provider,
        providerUserId: input.providerUserId,
      }),
    );

    return saved;
  }

  async linkIdentity(
    userId: string,
    provider: AuthProvider,
    providerUserId: string,
  ): Promise<void> {
    await this.identitiesRepo.save(
      this.identitiesRepo.create({ userId, provider, providerUserId }),
    );
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  async markEmailVerified(userId: string): Promise<User> {
    const user = await this.findById(userId);
    if (user.isEmailVerified) return user;
    user.isEmailVerified = true;
    return this.usersRepo.save(user);
  }

  async deleteAsAdmin(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException('cannot delete an admin account');
    }
    await this.usersRepo.delete({ id: userId });
  }

  async updateProfile(
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<User> {
    const user = await this.findById(userId);

    const merged = {
      nativeLanguage: dto.nativeLanguage ?? user.nativeLanguage,
      targetLanguage: dto.targetLanguage ?? user.targetLanguage,
      proficiencyLevel: dto.proficiencyLevel ?? user.proficiencyLevel,
      dailyGoalMinutes: dto.dailyGoalMinutes ?? user.dailyGoalMinutes,
      weeklyVocabGoal: dto.weeklyVocabGoal ?? user.weeklyVocabGoal,
    };

    if (
      merged.nativeLanguage &&
      merged.targetLanguage &&
      merged.nativeLanguage === merged.targetLanguage
    ) {
      throw new BadRequestException(
        'targetLanguage must differ from nativeLanguage',
      );
    }

    const allOnboardingFieldsPresent =
      merged.nativeLanguage !== null &&
      merged.targetLanguage !== null &&
      merged.proficiencyLevel !== null &&
      merged.dailyGoalMinutes !== null &&
      merged.weeklyVocabGoal !== null;

    if (!user.isOnboarded && !allOnboardingFieldsPresent) {
      throw new BadRequestException(
        'onboarding requires nativeLanguage, targetLanguage, proficiencyLevel, dailyGoalMinutes, and weeklyVocabGoal',
      );
    }

    Object.assign(user, merged);
    if (!user.isOnboarded && allOnboardingFieldsPresent) {
      user.isOnboarded = true;
    }

    return this.usersRepo.save(user);
  }

  toResponse(user: User): UserResponseDto {
    return plainToInstance(UserResponseDto, user, {
      excludeExtraneousValues: true,
    });
  }
}
