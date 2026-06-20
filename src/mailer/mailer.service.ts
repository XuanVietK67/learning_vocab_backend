import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;
  private from: string | null = null;

  constructor(private readonly config: ConfigService) {}

  async sendMail(input: SendMailInput): Promise<void> {
    const transporter = this.getTransporter();
    try {
      await transporter.sendMail({
        from: this.from ?? undefined,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
    } catch (err) {
      this.logger.error(
        `failed to send mail to ${input.to}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const host = this.config.getOrThrow<string>('mail.smtp.host');
    const port = this.config.getOrThrow<number>('mail.smtp.port');
    const secure = this.config.getOrThrow<boolean>('mail.smtp.secure');
    const user = this.config.get<string>('mail.smtp.user') ?? '';
    const pass = this.config.get<string>('mail.smtp.pass') ?? '';
    this.from = this.config.getOrThrow<string>('mail.from');

    // Force IPv4: many hosts (Railway, Docker, some VPS) resolve smtp hosts
    // to an IPv6 address they cannot route, yielding ENETUNREACH on connect.
    // `family` is a valid nodemailer socket option but missing from its types.
    const options: SMTPTransport.Options & { family: number } = {
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      family: 4,
    };
    this.transporter = nodemailer.createTransport(options);
    return this.transporter;
  }
}
