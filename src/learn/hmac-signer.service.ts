import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import learnConfig from '@/config/learn.config';
import { QuestionType } from '@/learn/enums/question-type.enum';

export interface SignaturePayload {
  userId: string;
  vocabularyId: string;
  type: QuestionType;
  exampleId: string;
  translationLang: string | null;
  nonce: string;
  issuedAtMs: number;
}

export interface IssuedSignature {
  nonce: string;
  issuedAtMs: number;
  signature: string;
}

@Injectable()
export class HmacSignerService {
  private readonly secret: string;
  private readonly ttlMs: number;

  constructor(
    @Inject(learnConfig.KEY)
    private readonly cfg: ConfigType<typeof learnConfig>,
  ) {
    this.secret = cfg.hmacSecret;
    this.ttlMs = cfg.signatureTtlMs;
  }

  issue(
    payload: Omit<SignaturePayload, 'nonce' | 'issuedAtMs'>,
  ): IssuedSignature {
    const nonce = randomUUID();
    const issuedAtMs = Date.now();
    const signature = this.compute({ ...payload, nonce, issuedAtMs });
    return { nonce, issuedAtMs, signature };
  }

  // Throws UnauthorizedException on tamper, expiry, or future-dated signature.
  verify(payload: SignaturePayload, signature: string): void {
    if (Number.isNaN(payload.issuedAtMs)) {
      throw new UnauthorizedException('invalid signature');
    }
    const ageMs = Date.now() - payload.issuedAtMs;
    if (ageMs < -5_000 || ageMs > this.ttlMs) {
      throw new UnauthorizedException('signature expired');
    }
    const expected = this.compute(payload);
    if (!constantTimeEquals(expected, signature)) {
      throw new UnauthorizedException('invalid signature');
    }
  }

  private compute(payload: SignaturePayload): string {
    const message = [
      payload.userId,
      payload.vocabularyId,
      payload.type,
      payload.exampleId,
      payload.translationLang ?? '',
      payload.nonce,
      String(payload.issuedAtMs),
    ].join('|');
    return createHmac('sha256', this.secret).update(message).digest('hex');
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
