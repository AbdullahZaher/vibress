import nodemailer, { Transporter } from 'nodemailer';
import crypto from 'node:crypto';
import { EmailProvider, EmailMessage, EmailSendResult, NormalizedEmailEvent, EmailProviderError, EmailEventType } from '../../domain/provider';

export interface SmtpProviderOptions {
  host: string;
  port: number;
  secure?: boolean | undefined;
  user?: string | null | undefined;
  pass?: string | null | undefined;
  webhookSecret?: string | null | undefined;
  maxConnections?: number | undefined;
}

/**
 * SMTP email provider (Mailpit in development).
 * Webhook events use an HMAC-signed JSON envelope verified with
 * `webhookSecret` — the signature contract mirrors what an ESP adapter
 * would implement with its native signature scheme.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private transporter: Transporter;
  private webhookSecret: string | null;

  constructor(options: SmtpProviderOptions) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? false,
      ...(options.user ? { auth: { user: options.user, pass: options.pass || '' } } : {}),
      pool: true,
      maxConnections: options.maxConnections || 5,
    });
    this.webhookSecret = options.webhookSecret || null;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const result = await this.transporter.sendMail({
        to: message.toName ? `"${sanitizeName(message.toName)}" <${message.to}>` : message.to,
        from: message.fromName ? `"${sanitizeName(message.fromName)}" <${message.from}>` : message.from,
        replyTo: message.replyTo || undefined,
        subject: message.subject,
        html: message.html,
        text: message.text || undefined,
        headers: message.headers,
      });
      return { messageId: result.messageId || crypto.randomUUID() };
    } catch (err: any) {
      throw new EmailProviderError('SEND_FAILED', err.message || 'SMTP send failed', true);
    }
  }

  async sendBatch(messages: EmailMessage[]): Promise<EmailSendResult[]> {
    const results: EmailSendResult[] = [];
    for (const message of messages) {
      results.push(await this.send(message));
    }
    return results;
  }

  async verifyWebhookSignature(payload: string | Buffer, signatureHeader: string | null | undefined): Promise<boolean> {
    if (!signatureHeader || !this.webhookSecret) return false;
    const body = typeof payload === 'string' ? payload : payload.toString();
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(body).digest('hex');
    const received = signatureHeader.replace(/^sha256=/, '');
    if (received.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  }

  async parseWebhookEvent(payload: string | Buffer): Promise<NormalizedEmailEvent> {
    const body = JSON.parse(payload.toString()) as {
      id?: unknown;
      event?: unknown;
      type?: unknown;
      messageId?: unknown;
      email?: unknown;
      timestamp?: unknown;
      detail?: unknown;
    };
    if (typeof body.id !== 'string' || typeof body.type !== 'string') {
      throw new EmailProviderError('INVALID_WEBHOOK_EVENT', 'Invalid webhook event shape');
    }
    const type = normalizeEventType(body.type);
    return {
      providerEventId: body.id,
      type,
      recipientEmail: typeof body.email === 'string' ? body.email : null,
      messageId: typeof body.messageId === 'string' ? body.messageId : null,
      timestamp: typeof body.timestamp === 'number' ? body.timestamp : null,
      detail: typeof body.detail === 'string' ? body.detail : null,
      data: { event: body.event ?? null, ...(typeof body.detail === 'string' ? { detail: body.detail } : {}) },
    };
  }
}

function normalizeEventType(raw: string): EmailEventType {
  switch (raw) {
    case 'delivered':
    case 'delivery':
      return 'delivered';
    case 'bounce':
    case 'bounced':
      return 'bounced';
    case 'complaint':
    case 'complained':
      return 'complained';
    case 'failed':
    case 'permanent_failure':
      return 'failed';
    case 'open':
    case 'opened':
      return 'opened';
    case 'click':
    case 'clicked':
      return 'clicked';
    default:
      throw new EmailProviderError('INVALID_WEBHOOK_EVENT', `Unknown event type: ${raw}`);
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[\r\n"<>]/g, '').slice(0, 200);
}
