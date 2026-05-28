import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from '@/auth/auth.service';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AppleSignInDto } from '@/auth/dto/apple-sign-in.dto';
import type { AuthResponseDto } from '@/auth/dto/auth-response.dto';
import { GithubSignInDto } from '@/auth/dto/github-sign-in.dto';
import { GoogleSignInDto } from '@/auth/dto/google-sign-in.dto';
import { LoginDto } from '@/auth/dto/login.dto';
import { RefreshDto } from '@/auth/dto/refresh.dto';
import { RegisterDto } from '@/auth/dto/register.dto';
import { VerifyEmailDto } from '@/auth/dto/verify-email.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { EmailVerificationService } from '@/auth/services/email-verification.service';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import type { IssueTokenContext } from '@/auth/services/token.service';
import type { UserResponseDto } from '@/users/dto/user-response.dto';
import { UsersService } from '@/users/users.service';

const LOGIN_THROTTLE_TTL_MS =
  Number(process.env.AUTH_LOGIN_THROTTLE_TTL ?? '900') * 1000;
const LOGIN_THROTTLE_LIMIT = Number(
  process.env.AUTH_LOGIN_THROTTLE_LIMIT ?? '5',
);

function tokenContextFrom(req: Request): IssueTokenContext {
  const ua = req.headers['user-agent'];
  return {
    userAgent: typeof ua === 'string' ? ua.slice(0, 512) : null,
    ipAddress: req.ip ?? null,
  };
}

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  @Post('register')
  register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.register(dto, tokenContextFrom(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: { limit: LOGIN_THROTTLE_LIMIT, ttl: LOGIN_THROTTLE_TTL_MS },
  })
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthResponseDto> {
    return this.authService.login(dto, tokenContextFrom(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.refresh(dto.refreshToken, tokenContextFrom(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  google(
    @Body() dto: GoogleSignInDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.signInWithGoogle(
      dto.idToken,
      tokenContextFrom(req),
    );
  }

  @Post('apple')
  @HttpCode(HttpStatus.OK)
  apple(
    @Body() dto: AppleSignInDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.signInWithApple(dto.idToken, tokenContextFrom(req));
  }

  @Post('github')
  @HttpCode(HttpStatus.OK)
  github(
    @Body() dto: GithubSignInDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.signInWithGithub(dto.code, tokenContextFrom(req));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(
    @CurrentUser() current: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.findById(current.id);
    return this.usersService.toResponse(user);
  }

  @Post('email/send-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async sendEmailVerification(
    @CurrentUser() current: AuthenticatedUser,
  ): Promise<{ expiresAt: string }> {
    const { expiresAt } = await this.emailVerificationService.requestCode(
      current.id,
    );
    return { expiresAt: expiresAt.toISOString() };
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: VerifyEmailDto,
  ): Promise<UserResponseDto> {
    await this.emailVerificationService.verifyCode(current.id, dto.code);
    const user = await this.usersService.findById(current.id);
    return this.usersService.toResponse(user);
  }
}
