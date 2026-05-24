import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import appleSignin from 'apple-signin-auth';
import type { SocialProfile } from '@/auth/services/google.service';

@Injectable()
export class AppleService {
  private readonly clientId: string;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('auth.apple.clientId') ?? '';
  }

  async verifyIdToken(idToken: string): Promise<SocialProfile> {
    if (!this.clientId) {
      throw new ServiceUnavailableException('apple sign-in not configured');
    }

    let payload: {
      sub: string;
      email?: string;
      email_verified?: boolean | string;
    };
    try {
      payload = await appleSignin.verifyIdToken(idToken, {
        audience: this.clientId,
        ignoreExpiration: false,
      });
    } catch {
      throw new UnauthorizedException('invalid apple token');
    }

    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('invalid apple token payload');
    }

    const emailVerified =
      payload.email_verified === true || payload.email_verified === 'true';
    if (!emailVerified) {
      throw new UnauthorizedException('apple email not verified');
    }

    return {
      providerUserId: payload.sub,
      email: payload.email,
      emailVerified: true,
      avatarUrl: null,
      displayName: null,
    };
  }
}
