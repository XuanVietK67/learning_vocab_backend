import { registerAs } from '@nestjs/config';

export default registerAs('learn', () => ({
  hmacSecret:
    process.env.LEARN_HMAC_SECRET ?? 'dev-learn-hmac-secret-change-me',
  signatureTtlMs: parseInt(process.env.LEARN_SIGNATURE_TTL_MS ?? '1800000', 10),
  defaultSessionLimit: parseInt(
    process.env.LEARN_DEFAULT_SESSION_LIMIT ?? '15',
    10,
  ),
  maxSessionLimit: parseInt(process.env.LEARN_MAX_SESSION_LIMIT ?? '50', 10),
}));
