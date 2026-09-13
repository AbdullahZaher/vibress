import nodemailer from "nodemailer";
import { getConfig } from "@vibress/config";

export interface StaffInvitationEmail {
  to: string;
  name: string;
  invitationUrl: string;
  expiresInHours: number;
}

export interface StaffPasswordResetEmail {
  to: string;
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export class SmtpStaffAuthMailer {
  private transporter: nodemailer.Transporter;
  private from: string;

  constructor() {
    const { smtp } = getConfig();
    const { host, port, secure, user, pass, from } = smtp;

    this.from = from || "no-reply@vibress.local";
    this.transporter = nodemailer.createTransport({
      host: host || "127.0.0.1",
      port: port || 1025,
      secure: Boolean(secure),
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  async sendStaffInvitation(input: StaffInvitationEmail): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: "You've been invited to join Vibress Staff",
        text: `Hello ${input.name},\n\nYou have been invited to join the Vibress staff team. Set up your account and password here:\n${input.invitationUrl}\n\nThis link expires in ${input.expiresInHours} hours.`,
        html: `<p>Hello ${escapeHtml(input.name)},</p><p>You have been invited to join the Vibress staff team.</p><p><a href="${escapeHtml(input.invitationUrl)}" style="display:inline-block;padding:10px 20px;background-color:#000;color:#fff;text-decoration:none;border-radius:4px;">Set Up Account</a></p><p>Or copy this URL: ${escapeHtml(input.invitationUrl)}</p><p>This link expires in ${input.expiresInHours} hours.</p>`,
      });
    } catch (err) {
      console.error("[StaffAuthMailer] Failed to send staff invitation:", err);
      // Non-blocking in dev/test, but re-throw in production if critical
    }
  }

  async sendPasswordReset(input: StaffPasswordResetEmail): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: "Reset your Vibress password",
        text: `Hello ${input.name},\n\nYou requested to reset your Vibress password. Reset it here:\n${input.resetUrl}\n\nThis link expires in ${input.expiresInMinutes} minutes. If you did not request this, please ignore this email.`,
        html: `<p>Hello ${escapeHtml(input.name)},</p><p>You requested to reset your Vibress password.</p><p><a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;padding:10px 20px;background-color:#000;color:#fff;text-decoration:none;border-radius:4px;">Reset Password</a></p><p>Or copy this URL: ${escapeHtml(input.resetUrl)}</p><p>This link expires in ${input.expiresInMinutes} minutes. If you did not request this, please ignore this email.</p>`,
      });
    } catch (err) {
      console.error("[StaffAuthMailer] Failed to send password reset:", err);
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

export const staffAuthMailer = new SmtpStaffAuthMailer();
