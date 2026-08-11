import nodemailer from 'nodemailer';
import { MemberAuthMailer, MemberMagicLinkEmail } from '@vibress/members';
import { getConfig } from '@vibress/config';

export class SmtpMemberAuthMailer implements MemberAuthMailer {
  private transporter: nodemailer.Transporter;
  private from: string;

  constructor() {
    const { smtp } = getConfig();
    const { host, port, secure, user, pass, from } = smtp;

    this.from = from;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  async sendMagicLink(input: MemberMagicLinkEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: input.to,
      subject: 'Your Vibress sign-in link',
      text: `Sign in to Vibress by opening this link: ${input.magicLinkUrl}\n\nThis link expires in ${input.expiresInMinutes} minutes.`,
      html: `<p>Sign in to Vibress by clicking the link below:</p><p><a href="${escapeHtml(input.magicLinkUrl)}">Sign in</a></p><p>This link expires in ${input.expiresInMinutes} minutes.</p>`,
    });
  }
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
