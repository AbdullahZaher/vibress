export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead_letter';

export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  secretEncrypted: string | null;
  enabled: boolean;
  eventTypes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWebhookEndpointData {
  id?: string | undefined;
  name: string;
  url: string;
  secret?: string | null | undefined;
  enabled?: boolean | undefined;
  eventTypes?: string[] | undefined;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  payloadHash: string;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  lastError: string | null;
  responseStatus: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListDeliveriesFilter {
  endpointId?: string | undefined;
  status?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface WebhookRepository {
  createEndpoint(data: CreateWebhookEndpointData): Promise<WebhookEndpoint>;
  findEndpointById(id: string): Promise<WebhookEndpoint | null>;
  listEndpoints(): Promise<WebhookEndpoint[]>;
  updateEndpoint(id: string, data: Partial<CreateWebhookEndpointData>): Promise<WebhookEndpoint>;
  deleteEndpoint(id: string): Promise<void>;
  findActiveEndpointsForEvent(eventType: string): Promise<WebhookEndpoint[]>;

  createDelivery(data: { endpointId: string; eventId: string; eventType: string; payloadHash: string }): Promise<WebhookDelivery>;
  findDelivery(endpointId: string, eventId: string): Promise<WebhookDelivery | null>;
  findDeliveryById(id: string): Promise<WebhookDelivery | null>;
  listDeliveries(filter?: ListDeliveriesFilter): Promise<{ deliveries: WebhookDelivery[]; total: number }>;
  markDelivered(id: string, responseStatus: number): Promise<void>;
  markFailed(id: string, error: string, attemptCount: number): Promise<void>;
  markDeadLetter(id: string, error: string): Promise<void>;
  listPendingDeliveries(limit: number): Promise<WebhookDelivery[]>;
  incrementAttempt(id: string): Promise<void>;
}
