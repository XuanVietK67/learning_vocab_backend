import { randomInt, createHash, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { EmailVerificationCode } from '@/auth/entities/email-verification-code.entity';
import { MailerService } from '@/mailer/mailer.service';
import { UsersService } from '@/users/users.service';

const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @InjectRepository(EmailVerificationCode)
    private readonly codesRepo: Repository<EmailVerificationCode>,
    private readonly usersService: UsersService,
    private readonly mailerService: MailerService,
  ) {}

  async requestCode(userId: string): Promise<{ expiresAt: Date }> {
    const user = await this.usersService.findById(userId);
    if (user.isEmailVerified) {
      throw new BadRequestException('email already verified');
    }

    const latest = await this.findActiveCode(userId);
    if (latest) {
      const ageMs = Date.now() - latest.createdAt.getTime();
      const cooldownMs = RESEND_COOLDOWN_SECONDS * 1000;
      if (ageMs < cooldownMs) {
        const retryAfter = Math.ceil((cooldownMs - ageMs) / 1000);
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'please wait before requesting another code',
            error: 'Too Many Requests',
            retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    await this.codesRepo.update(
      { userId, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
    const record = this.codesRepo.create({
      userId,
      codeHash: hashCode(code),
      expiresAt,
    });
    const saved = await this.codesRepo.save(record);

    try {
      const { subject, html, text } = buildVerificationEmail(
        code,
        CODE_TTL_MINUTES,
      );
      await this.mailerService.sendMail({
        to: user.email,
        subject,
        html,
        text,
      });
    } catch (err) {
      await this.codesRepo.update({ id: saved.id }, { consumedAt: new Date() });
      this.logger.error(
        `failed to send verification email to user ${userId}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'failed to send verification email',
      );
    }

    return { expiresAt };
  }

  async verifyCode(userId: string, code: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (user.isEmailVerified) {
      throw new BadRequestException('email already verified');
    }

    const record = await this.findActiveCode(userId);
    if (!record) {
      throw new BadRequestException(
        'no active verification code, request a new one',
      );
    }

    record.attempts += 1;
    if (record.attempts > MAX_ATTEMPTS) {
      record.consumedAt = new Date();
      await this.codesRepo.save(record);
      throw new BadRequestException('too many attempts, request a new code');
    }

    if (!compareCode(code, record.codeHash)) {
      await this.codesRepo.save(record);
      const attemptsRemaining = Math.max(MAX_ATTEMPTS - record.attempts, 0);
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'invalid code',
        error: 'Bad Request',
        attemptsRemaining,
      });
    }

    record.consumedAt = new Date();
    await this.codesRepo.save(record);
    await this.usersService.markEmailVerified(userId);
  }

  private findActiveCode(
    userId: string,
  ): Promise<EmailVerificationCode | null> {
    return this.codesRepo.findOne({
      where: {
        userId,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });
  }
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function compareCode(code: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashCode(code), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

function buildVerificationEmail(
  code: string,
  expiresInMinutes: number,
): { subject: string; html: string; text: string } {
  const subject = 'Your Learning Vocab verification code';
  const text = [
    `Your verification code is: ${code}`,
    ``,
    `It expires in ${expiresInMinutes} minutes. If you didn't request this, you can ignore this email.`,
  ].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="margin-top: 0;">Verify your email</h2>
      <p>Use the code below to verify your email address.</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; margin: 24px 0;">${code}</p>
      <p style="color: #555;">This code expires in ${expiresInMinutes} minutes. If you didn't request this, you can safely ignore this email.</p>
    </div>
  `.trim();
  return { subject, html, text };
}
