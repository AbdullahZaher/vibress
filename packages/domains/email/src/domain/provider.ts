export type EmailEventType =
  "delivered" | "bounced" | "complained" | "failed" | "opened" | "clicked";

export interface EmailMessage {
  to: string;
  toName: string | null;
  from: string;
  fromName: string | null;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string | null;
  headers?: Record<string, string> | undefined;
  metadata?: Record<string, string> | undefined;
}

export interface EmailSendResult {
  messageId: string;
}

export interface NormalizedEmailEvent {
  providerEventId: string;
  type: EmailEventType;
  recipientEmail: string | null;
  messageId: string | null;
  timestamp: number | null;
  detail: string | null;
  data: Record<string, unknown> | null;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
  sendBatch(messages: EmailMessage[]): Promise<EmailSendResult[]>;
  verifyWebhookSignature(
    payload: string | Buffer,
    signatureHeader: string | null | undefined,
  ): Promise<boolean>;
  parseWebhookEvent(payload: string | Buffer): Promise<NormalizedEmailEvent>;
}

export class EmailProviderError extends Error {
  code: string;
  transient: boolean;

  constructor(code: string, message: string, transient = false) {
    super(message);
    this.code = code;
    this.transient = transient;
  }
}
