export type SendStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface AudienceDefinition {
  filter: 'all' | 'paid' | 'free';
  productId: string | null;
  planId: string | null;
}

export interface NewsletterSend {
  id: string;
  newsletterId: string;
  subject: string;
  contentVersion: number;
  content: unknown;
  senderName: string;
  senderEmail: string;
  replyTo: string | null;
  audience: AudienceDefinition;
  createdBy: string | null;
  scheduledAt: Date | null;
  status: SendStatus;
  totalRecipients: number;
  sentRecipients: number;
  failedRecipients: number;
  startedAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSendData {
  id?: string | undefined;
  newsletterId: string;
  subject: string;
  contentVersion?: number | undefined;
  content: unknown;
  senderName: string;
  senderEmail: string;
  replyTo?: string | null | undefined;
  audience: AudienceDefinition;
  createdBy?: string | null | undefined;
  scheduledAt?: Date | null | undefined;
  status?: SendStatus | undefined;
}

export interface SendRepository {
  create(data: CreateSendData): Promise<NewsletterSend>;
  findById(id: string): Promise<NewsletterSend | null>;
  updateStatus(id: string, status: SendStatus, patch?: Partial<NewsletterSend>): Promise<NewsletterSend>;
  list(filter?: { status?: SendStatus; newsletterId?: string; limit?: number; offset?: number }): Promise<{ sends: NewsletterSend[]; total: number }>;
  findDueScheduled(now: Date, limit: number): Promise<NewsletterSend[]>;
}
