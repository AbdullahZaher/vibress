import { RecipientStatus } from './recipient-status';

export interface EmailRecipient {
  id: string;
  sendId: string;
  memberId: string | null;
  email: string;
  name: string | null;
  status: RecipientStatus;
  providerMessageId: string | null;
  unsubscribeToken: string;
  attemptCount: number;
  lastError: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRecipientData {
  id?: string | undefined;
  sendId: string;
  memberId: string | null;
  email: string;
  name?: string | null | undefined;
  unsubscribeToken: string;
}

export interface EmailRecipientRepository {
  createMany(rows: CreateRecipientData[]): Promise<number>;
  findPending(sendId: string, limit: number): Promise<EmailRecipient[]>;
  findById(id: string): Promise<EmailRecipient | null>;
  findByMessageId(messageId: string): Promise<EmailRecipient | null>;
  findByEmailAndSend(email: string, sendId: string): Promise<EmailRecipient | null>;
  markSent(id: string, messageId: string, at: Date): Promise<EmailRecipient>;
  markFailed(id: string, error: string, attemptCount: number): Promise<EmailRecipient>;
  markDelivered(id: string, at: Date): Promise<EmailRecipient>;
  markOpened(id: string, at: Date): Promise<EmailRecipient>;
  markClicked(id: string, at: Date): Promise<EmailRecipient>;
  countByStatus(sendId: string): Promise<Record<string, number>>;
}

export interface EmailEvent {
  id: string;
  recipientId: string;
  sendId: string | null;
  memberId: string | null;
  type: string;
  provider: string | null;
  providerEventId: string | null;
  occurredAt: Date;
  data: Record<string, unknown> | null;
}

export interface EmailEventRepository {
  record(data: {
    recipientId: string;
    sendId?: string | null | undefined;
    memberId?: string | null | undefined;
    type: string;
    provider?: string | null | undefined;
    providerEventId?: string | null | undefined;
    data?: Record<string, unknown> | null | undefined;
  }): Promise<EmailEvent>;
}

export type SuppressionReason = 'hard_bounce' | 'spam_complaint' | 'manual' | 'provider_suppression';

export interface EmailSuppression {
  id: string;
  memberId: string | null;
  email: string;
  reason: SuppressionReason;
  source: string;
  detail: string | null;
  createdAt: Date;
}

export interface EmailSuppressionRepository {
  add(data: {
    memberId?: string | null | undefined;
    email: string;
    reason: SuppressionReason;
    source: string;
    detail?: string | null | undefined;
  }): Promise<void>;
  isSuppressed(email: string): Promise<boolean>;
  findByEmail(email: string): Promise<EmailSuppression | null>;
  list(limit?: number, offset?: number): Promise<{ suppressions: EmailSuppression[]; total: number }>;
  remove(email: string, reason: SuppressionReason): Promise<void>;
}
