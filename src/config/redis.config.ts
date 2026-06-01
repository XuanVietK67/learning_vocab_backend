import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  // Local/dev Redis runs auth-less; omitted from the connection when blank.
  password: process.env.REDIS_PASSWORD || undefined,
}));
