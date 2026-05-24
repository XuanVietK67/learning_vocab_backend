import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SocialProfile } from '@/auth/services/google.service';

interface GithubUserResponse {
  id: number;
  login: string;
  avatar_url: string | null;
  name: string | null;
}

interface GithubEmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
}

@Injectable()
export class GithubService {
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('auth.github.clientId') ?? '';
    this.clientSecret = config.get<string>('auth.github.clientSecret') ?? '';
  }

  async verifyAuthCode(code: string): Promise<SocialProfile> {
    if (!this.clientId || !this.clientSecret) {
      throw new ServiceUnavailableException('github sign-in not configured');
    }

    const accessToken = await this.exchangeCode(code);
    const [user, email] = await Promise.all([
      this.fetchUser(accessToken),
      this.fetchPrimaryEmail(accessToken),
    ]);

    return {
      providerUserId: String(user.id),
      email: email.email,
      emailVerified: email.verified,
      avatarUrl: user.avatar_url,
      displayName: user.name ?? user.login,
    };
  }

  private async exchangeCode(code: string): Promise<string> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
      }),
    });
    if (!res.ok) {
      throw new UnauthorizedException('github code exchange failed');
    }
    const data = (await res.json()) as {
      access_token?: string;
      error?: string;
    };
    if (!data.access_token) {
      throw new UnauthorizedException(data.error ?? 'invalid github code');
    }
    return data.access_token;
  }

  private async fetchUser(accessToken: string): Promise<GithubUserResponse> {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      throw new UnauthorizedException('github user fetch failed');
    }
    return (await res.json()) as GithubUserResponse;
  }

  private async fetchPrimaryEmail(
    accessToken: string,
  ): Promise<GithubEmailResponse> {
    const res = await fetch('https://api.github.com/user/emails', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      throw new UnauthorizedException('github email fetch failed');
    }
    const emails = (await res.json()) as GithubEmailResponse[];
    const primary =
      emails.find((e) => e.primary && e.verified) ??
      emails.find((e) => e.verified);
    if (!primary) {
      throw new UnauthorizedException(
        'no verified primary email on github account',
      );
    }
    return primary;
  }
}
