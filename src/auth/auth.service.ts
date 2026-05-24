import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthResponseDto } from '@/auth/dto/auth-response.dto';
import type { LoginDto } from '@/auth/dto/login.dto';
import type { RegisterDto } from '@/auth/dto/register.dto';
import { AppleService } from '@/auth/services/apple.service';
import { GithubService } from '@/auth/services/github.service';
import {
  GoogleService,
  type SocialProfile,
} from '@/auth/services/google.service';
import {
  type IssueTokenContext,
  TokenService,
} from '@/auth/services/token.service';
import { AuthProvider } from '@/users/entities/user-identity.entity';
import type { User } from '@/users/entities/user.entity';
import { UsersService } from '@/users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly googleService: GoogleService,
    private readonly appleService: AppleService,
    private readonly githubService: GithubService,
  ) {}

  async register(
    dto: RegisterDto,
    ctx: IssueTokenContext,
  ): Promise<AuthResponseDto> {
    const user = await this.usersService.createLocal(dto);
    return this.tokenService.issueTokens(user, ctx);
  }

  async login(dto: LoginDto, ctx: IssueTokenContext): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('invalid credentials');
    }
    const ok = await this.usersService.verifyPassword(user, dto.password);
    if (!ok) {
      throw new UnauthorizedException('invalid credentials');
    }
    return this.tokenService.issueTokens(user, ctx);
  }

  async refresh(
    refreshToken: string,
    ctx: IssueTokenContext,
  ): Promise<AuthResponseDto> {
    return this.tokenService.rotateRefreshToken(refreshToken, ctx);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokenService.revokeRefreshToken(refreshToken);
  }

  async signInWithGoogle(
    idToken: string,
    ctx: IssueTokenContext,
  ): Promise<AuthResponseDto> {
    const profile = await this.googleService.verifyIdToken(idToken);
    return this.findOrCreateFromSocial(AuthProvider.GOOGLE, profile, ctx);
  }

  async signInWithApple(
    idToken: string,
    ctx: IssueTokenContext,
  ): Promise<AuthResponseDto> {
    const profile = await this.appleService.verifyIdToken(idToken);
    return this.findOrCreateFromSocial(AuthProvider.APPLE, profile, ctx);
  }

  async signInWithGithub(
    code: string,
    ctx: IssueTokenContext,
  ): Promise<AuthResponseDto> {
    const profile = await this.githubService.verifyAuthCode(code);
    return this.findOrCreateFromSocial(AuthProvider.GITHUB, profile, ctx);
  }

  private async findOrCreateFromSocial(
    provider: AuthProvider,
    profile: SocialProfile,
    ctx: IssueTokenContext,
  ): Promise<AuthResponseDto> {
    let user: User | null = await this.usersService.findByIdentity(
      provider,
      profile.providerUserId,
    );

    if (!user) {
      const existingByEmail = await this.usersService.findByEmail(
        profile.email,
      );
      if (existingByEmail) {
        if (!existingByEmail.isActive) {
          throw new UnauthorizedException('account is disabled');
        }
        await this.usersService.linkIdentity(
          existingByEmail.id,
          provider,
          profile.providerUserId,
        );
        user = existingByEmail;
      } else {
        user = await this.usersService.createFromSocial({
          email: profile.email,
          provider,
          providerUserId: profile.providerUserId,
          avatarUrl: profile.avatarUrl,
          emailVerified: profile.emailVerified,
        });
      }
    }

    if (!user.isActive) {
      throw new UnauthorizedException('account is disabled');
    }

    return this.tokenService.issueTokens(user, ctx);
  }
}
