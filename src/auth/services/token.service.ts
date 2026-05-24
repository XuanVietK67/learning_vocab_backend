import { createHash, randomBytes } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { RefreshToken } from '@/auth/entities/refresh-token.entity';
import type { JwtPayload } from '@/auth/strategies/jwt.strategy';
import type { User } from '@/users/entities/user.entity';
import type { AuthResponseDto } from '@/auth/dto/auth-response.dto';
import { UsersService } from '@/users/users.service';

const REFRESH_TOKEN_BYTES = 48;

export interface IssueTokenContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
  ) {}

  async issueTokens(
    user: User,
    ctx: IssueTokenContext = {},
  ): Promise<AuthResponseDto> {
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id, ctx);
    return {
      accessToken,
      refreshToken,
      user: this.usersService.toResponse(user),
    };
  }

  async rotateRefreshToken(
    presented: string,
    ctx: IssueTokenContext = {},
  ): Promise<AuthResponseDto> {
    const tokenHash = this.hashToken(presented);
    const record = await this.refreshRepo.findOne({
      where: {
        tokenHash,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!record) {
      // Either unknown token or a reused/revoked one — treat as compromise:
      // revoke every active refresh token for the user we *can* identify.
      const reused = await this.refreshRepo.findOne({ where: { tokenHash } });
      if (reused) {
        await this.revokeAllForUser(reused.userId);
      }
      throw new UnauthorizedException('invalid refresh token');
    }

    record.revokedAt = new Date();
    await this.refreshRepo.save(record);

    const user = await this.usersService.findById(record.userId);
    return this.issueTokens(user, ctx);
  }

  async revokeRefreshToken(presented: string): Promise<void> {
    const tokenHash = this.hashToken(presented);
    await this.refreshRepo.update(
      { tokenHash, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshRepo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private signAccessToken(user: User): string {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('auth.jwt.accessSecret'),
      expiresIn: this.config.getOrThrow<string>(
        'auth.jwt.accessExpiresIn',
      ) as unknown as number,
    });
  }

  private async createRefreshToken(
    userId: string,
    ctx: IssueTokenContext,
  ): Promise<string> {
    const raw = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hashToken(raw);
    const expiresAt = this.computeRefreshExpiry();

    await this.refreshRepo.save(
      this.refreshRepo.create({
        userId,
        tokenHash,
        expiresAt,
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
      }),
    );

    return raw;
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private computeRefreshExpiry(): Date {
    const spec = this.config.getOrThrow<string>('auth.jwt.refreshExpiresIn');
    const ms = parseDurationToMs(spec);
    return new Date(Date.now() + ms);
  }
}

function parseDurationToMs(spec: string): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(spec.trim());
  if (!match) {
    const asNumber = Number(spec);
    if (!Number.isFinite(asNumber)) {
      throw new Error(`invalid duration: ${spec}`);
    }
    return asNumber * 1000;
  }
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[unit];
}
