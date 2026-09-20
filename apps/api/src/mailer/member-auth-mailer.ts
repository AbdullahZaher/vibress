import nodemailer from "nodemailer";
import { MemberAuthMailer, MemberMagicLinkEmail } from "@vibress/members";
import { getConfig } from "@vibress/config";

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
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: "Your Vibress sign-in link",
        text: `Sign in to Vibress by opening this link: ${input.magicLinkUrl}\n\nThis link expires in ${input.expiresInMinutes} minutes.`,
        html: `<p>Sign in to Vibress by clicking the link below:</p><p><a href="${escapeHtml(input.magicLinkUrl)}">Sign in</a></p><p>This link expires in ${input.expiresInMinutes} minutes.</p>`,
      });
    } catch (err) {
      console.error("sendMagicLink error:", err);
      throw err;
    }
  }

  async sendEmailChangeVerification(input: {
    to: string;
    verifyUrl: string;
    expiresInMinutes: number;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: "Confirm your new Vibress email address",
        text: `Confirm your new email address by opening this link: ${input.verifyUrl}\n\nThis link expires in ${input.expiresInMinutes} minutes.`,
        html: `<p>Confirm your new email address by clicking the link below:</p><p><a href="${escapeHtml(input.verifyUrl)}">Confirm email change</a></p><p>This link expires in ${input.expiresInMinutes} minutes.</p>`,
      });
    } catch (err) {
      console.error("sendEmailChangeVerification error:", err);
      throw err;
    }
  }

  async sendEmailChangeNotice(input: {
    to: string;
    newEmail: string;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: "Your Vibress email address change request",
        text: `A request was made to change your Vibress account email address to ${input.newEmail}. If you did not make this request, please contact your administrator.`,
        html: `<p>A request was made to change your Vibress account email address to <strong>${escapeHtml(input.newEmail)}</strong>.</p><p>If you did not make this request, please contact your administrator.</p>`,
      });
    } catch (err) {
      console.error("sendEmailChangeNotice error:", err);
      throw err;
    }
  }
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
