import { registerAs } from '@nestjs/config';

export default registerAs('mail', () => ({
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: (process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
  from: process.env.MAIL_FROM ?? 'Learning Vocab <no-reply@example.com>',
}));
