import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginTicket, OAuth2Client, TokenPayload } from 'google-auth-library';

export interface SocialProfile {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  avatarUrl: string | null;
  displayName: string | null;
}

@Injectable()
export class GoogleService {
  private readonly client: OAuth2Client | null;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('auth.google.clientId') ?? '';
    this.clientSecret = config.get<string>('auth.google.clientSecret') ?? '';
    this.client = this.clientId
      ? new OAuth2Client({
          clientId: this.clientId,
          clientSecret: this.clientSecret,
          // The GIS popup code flow exchanges against the literal `postmessage`
          // redirect rather than a registered redirect URL.
          redirectUri: 'postmessage',
        })
      : null;
  }

  // Authorization-code flow: exchange the GIS popup `code` with Google for tokens,
  // then verify the resulting `id_token` with the same logic as the legacy flow.
  async verifyAuthCode(code: string): Promise<SocialProfile> {
    if (!this.client || !this.clientSecret) {
      throw new ServiceUnavailableException('google sign-in not configured');
    }

    let idToken: string | null | undefined;
    try {
      const { tokens } = await this.client.getToken({
        code,
        redirect_uri: 'postmessage',
      });
      idToken = tokens.id_token;
    } catch {
      throw new UnauthorizedException('invalid google token');
    }

    if (!idToken) {
      throw new UnauthorizedException('invalid google token');
    }

    return this.verifyIdToken(idToken);
  }

  async verifyIdToken(idToken: string): Promise<SocialProfile> {
    if (!this.client) {
      throw new ServiceUnavailableException('google sign-in not configured');
    }

    let ticket: LoginTicket;
    try {
      ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
    } catch {
      throw new UnauthorizedException('invalid google token');
    }

    const payload: TokenPayload | undefined = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('invalid google token payload');
    }
    if (!payload.email_verified) {
      throw new UnauthorizedException('google email not verified');
    }

    return {
      providerUserId: payload.sub,
      email: payload.email,
      emailVerified: true,
      avatarUrl: payload.picture ?? null,
      displayName: payload.name ?? null,
    };
  }
}
