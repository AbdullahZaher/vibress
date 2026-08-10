export interface BillingWebhookEvent {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface BillingWebhookEventRepository {
  create(data: {
    id?: string | undefined;
    provider: string;
    providerEventId: string;
    eventType: string;
    payloadHash: string;
  }): Promise<BillingWebhookEvent>;
  findByProviderEventId(provider: string, providerEventId: string): Promise<BillingWebhookEvent | null>;
  markProcessed(id: string, processedAt?: Date): Promise<void>;
  markFailed(id: string, error: string, attemptCount?: number): Promise<void>;
  listPending(limit?: number): Promise<BillingWebhookEvent[]>;
}

export interface BillingEvent {
  id: string;
  subscriptionId: string | null;
  memberId: string | null;
  provider: string | null;
  providerEventId: string | null;
  type: string;
  occurredAt: Date;
  data: Record<string, unknown> | null;
}

export interface BillingEventRepository {
  record(data: {
    subscriptionId?: string | null | undefined;
    memberId?: string | null | undefined;
    provider?: string | null | undefined;
    providerEventId?: string | null | undefined;
    type: string;
    data?: Record<string, unknown> | null | undefined;
  }): Promise<BillingEvent>;
  listForSubscription(subscriptionId: string, limit?: number): Promise<BillingEvent[]>;
}
