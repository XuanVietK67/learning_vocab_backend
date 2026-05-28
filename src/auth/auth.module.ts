import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from '@/auth/auth.controller';
import { AuthService } from '@/auth/auth.service';
import { EmailVerificationCode } from '@/auth/entities/email-verification-code.entity';
import { RefreshToken } from '@/auth/entities/refresh-token.entity';
import { AppleService } from '@/auth/services/apple.service';
import { EmailVerificationService } from '@/auth/services/email-verification.service';
import { GithubService } from '@/auth/services/github.service';
import { GoogleService } from '@/auth/services/google.service';
import { TokenService } from '@/auth/services/token.service';
import { JwtStrategy } from '@/auth/strategies/jwt.strategy';
import { UsersModule } from '@/users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    TypeOrmModule.forFeature([RefreshToken, EmailVerificationCode]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwt.accessSecret'),
        signOptions: {
          expiresIn: config.getOrThrow<string>(
            'auth.jwt.accessExpiresIn',
          ) as unknown as number,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl:
            config.getOrThrow<number>('auth.throttle.loginTtlSeconds') * 1000,
          limit: config.getOrThrow<number>('auth.throttle.loginLimit'),
        },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtStrategy,
    GoogleService,
    AppleService,
    GithubService,
    EmailVerificationService,
  ],
})
export class AuthModule {}
