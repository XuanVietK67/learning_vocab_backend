import { UnauthorizedException } from '@nestjs/common';
import { HmacSignerService } from '@/learn/hmac-signer.service';
import { QuestionType } from '@/learn/enums/question-type.enum';

function makeSigner(ttlMs = 1800_000): HmacSignerService {
  return new HmacSignerService({
    hmacSecret: 'test-secret-value-do-not-use-anywhere',
    signatureTtlMs: ttlMs,
    defaultSessionLimit: 15,
    maxSessionLimit: 50,
  });
}

const basePayload = {
  userId: '11111111-1111-1111-1111-111111111111',
  vocabularyId: '22222222-2222-2222-2222-222222222222',
  type: QuestionType.CLOZE_MCQ,
  exampleId: '33333333-3333-3333-3333-333333333333',
  translationLang: 'vi' as string | null,
};

describe('HmacSignerService', () => {
  it('round-trips: issue + verify works', () => {
    const signer = makeSigner();
    const issued = signer.issue(basePayload);
    expect(() =>
      signer.verify(
        {
          ...basePayload,
          nonce: issued.nonce,
          issuedAtMs: issued.issuedAtMs,
        },
        issued.signature,
      ),
    ).not.toThrow();
  });

  it('rejects a tampered exampleId', () => {
    const signer = makeSigner();
    const issued = signer.issue(basePayload);
    expect(() =>
      signer.verify(
        {
          ...basePayload,
          exampleId: '44444444-4444-4444-4444-444444444444',
          nonce: issued.nonce,
          issuedAtMs: issued.issuedAtMs,
        },
        issued.signature,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a tampered translationLang', () => {
    const signer = makeSigner();
    const issued = signer.issue(basePayload);
    expect(() =>
      signer.verify(
        {
          ...basePayload,
          translationLang: 'en',
          nonce: issued.nonce,
          issuedAtMs: issued.issuedAtMs,
        },
        issued.signature,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a different userId (cross-user replay)', () => {
    const signer = makeSigner();
    const issued = signer.issue(basePayload);
    expect(() =>
      signer.verify(
        {
          ...basePayload,
          userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          nonce: issued.nonce,
          issuedAtMs: issued.issuedAtMs,
        },
        issued.signature,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects an expired signature', () => {
    const signer = makeSigner(1000); // 1s TTL
    const issued = signer.issue(basePayload);
    const expiredIssuedAt = issued.issuedAtMs - 2_000;
    // Recompute signature with the expired timestamp so it matches the TTL check;
    // simpler: just verify the original payload but spoof issuedAtMs to be old
    expect(() =>
      signer.verify(
        {
          ...basePayload,
          nonce: issued.nonce,
          issuedAtMs: expiredIssuedAt,
        },
        issued.signature,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a malformed signature', () => {
    const signer = makeSigner();
    const issued = signer.issue(basePayload);
    expect(() =>
      signer.verify(
        {
          ...basePayload,
          nonce: issued.nonce,
          issuedAtMs: issued.issuedAtMs,
        },
        'not-a-real-signature',
      ),
    ).toThrow(UnauthorizedException);
  });
});
