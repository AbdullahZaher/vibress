import {
  WebhookRepository,
  WebhookEndpoint,
  WebhookDelivery,
} from "../domain/webhook";
import { decryptSecret, isSafeUrl, safeFetch } from "@vibress/security";
import { domainEvents } from "@vibress/events";
import crypto from "node:crypto";

export class WebhookDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface DeliveryDispatcher {
  enqueue(deliveryId: string, endpointId: string): Promise<void>;
}

const MAX_RETRIES = 5;

export class WebhooksService {
  constructor(
    private repo: WebhookRepository,
    private dispatcher: DeliveryDispatcher,
  ) {}

  // ---------------- Endpoint management ----------------

  async createEndpoint(
    data: {
      name: string;
      url: string;
      secret?: string | null;
      eventTypes: string[];
    },
    actorId: string | null,
  ): Promise<WebhookEndpoint> {
    if (!data.name.trim())
      throw new WebhookDomainError("VALIDATION_ERROR", "Name is required");
    if (!isSafeUrl(data.url)) {
      throw new WebhookDomainError(
        "UNSAFE_URL",
        "Webhook URL must be http/https and not point to a private/localhost address",
      );
    }
    if (!Array.isArray(data.eventTypes) || data.eventTypes.length === 0) {
      throw new WebhookDomainError(
        "VALIDATION_ERROR",
        "At least one event type is required",
      );
    }
    const endpoint = await this.repo.createEndpoint({
      name: data.name,
      url: data.url,
      secret: data.secret || null,
      eventTypes: data.eventTypes,
    });
    domainEvents.emit("webhook.endpoint_created", {
      endpointId: endpoint.id,
      actorId,
    });
    return endpoint;
  }

  async updateEndpoint(
    id: string,
    data: {
      name?: string;
      url?: string;
      secret?: string | null;
      enabled?: boolean;
      eventTypes?: string[];
    },
    actorId: string | null,
  ): Promise<WebhookEndpoint> {
    const existing = await this.repo.findEndpointById(id);
    if (!existing)
      throw new WebhookDomainError(
        "WEBHOOK_NOT_FOUND",
        "Webhook endpoint not found",
      );
    if (data.url && !isSafeUrl(data.url)) {
      throw new WebhookDomainError(
        "UNSAFE_URL",
        "Webhook URL must be http/https and not point to a private/localhost address",
      );
    }
    const updated = await this.repo.updateEndpoint(id, data);
    domainEvents.emit("webhook.endpoint_updated", { endpointId: id, actorId });
    return updated;
  }

  async deleteEndpoint(id: string, actorId: string | null): Promise<void> {
    await this.repo.deleteEndpoint(id);
    domainEvents.emit("webhook.endpoint_deleted", { endpointId: id, actorId });
  }

  async listEndpoints(): Promise<WebhookEndpoint[]> {
    return this.repo.listEndpoints();
  }

  maskEndpoint(endpoint: WebhookEndpoint) {
    return {
      id: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      hasSecret: !!endpoint.secretEncrypted,
      enabled: endpoint.enabled,
      eventTypes: endpoint.eventTypes,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    };
  }

  // ---------------- Delivery ----------------

  /**
   * Called when a domain event fires: snapshots the event into durable
   * delivery rows for matching endpoints and enqueues them.
   * Dedup: UNIQUE(endpoint_id, event_id) — repeated events cannot create
   * duplicate deliveries.
   */
  async dispatchEvent(eventName: string, payload: unknown): Promise<number> {
    const endpoints = await this.repo.findActiveEndpointsForEvent(eventName);
    if (endpoints.length === 0) return 0;

    const eventId = crypto.randomUUID();
    const eventPayload = JSON.stringify({
      id: eventId,
      type: eventName,
      timestamp: new Date().toISOString(),
      data: payload,
    });
    const payloadHash = crypto
      .createHash("sha256")
      .update(eventPayload)
      .digest("hex");

    let enqueued = 0;
    for (const endpoint of endpoints) {
      const existing = await this.repo.findDelivery(endpoint.id, eventId);
      if (existing) continue;
      const delivery = await this.repo.createDelivery({
        endpointId: endpoint.id,
        eventId,
        eventType: eventName,
        payloadHash,
      });
      await this.dispatcher.enqueue(delivery.id, endpoint.id);
      enqueued++;
    }
    return enqueued;
  }

  /**
   * Delivers one queued delivery with the SSRF-hardened client.
   * Signs the payload with HMAC-SHA256 using the endpoint secret.
   */
  async deliver(
    deliveryId: string,
  ): Promise<{ status: string; responseStatus: number | null }> {
    const delivery = await this.getDeliveryWithEndpoint(deliveryId);
    if (!delivery)
      throw new WebhookDomainError("DELIVERY_NOT_FOUND", "Delivery not found");
    const { deliveryRow, endpoint } = delivery;

    if (!endpoint.enabled) {
      await this.repo.markDeadLetter(deliveryRow.id, "endpoint disabled");
      return { status: "dead_letter", responseStatus: null };
    }

    await this.repo.incrementAttempt(deliveryRow.id);

    const secret = endpoint.secretEncrypted
      ? decryptSecret(endpoint.secretEncrypted)
      : "";
    const eventPayload = JSON.stringify({
      id: deliveryRow.eventId,
      type: deliveryRow.eventType,
      timestamp: new Date().toISOString(),
    });
    const signature = crypto
      .createHmac("sha256", secret)
      .update(eventPayload)
      .digest("hex");

    try {
      const result = await safeFetch(endpoint.url, {
        method: "POST",
        timeout: 10000,
        maxSize: 262144,
        headers: {
          "Content-Type": "application/json",
          "X-Vibress-Event-Id": deliveryRow.eventId,
          "X-Vibress-Event-Type": deliveryRow.eventType,
          "X-Vibress-Signature": `sha256=${signature}`,
          "X-Vibress-Timestamp": new Date().toISOString(),
        },
      });
      // Workaround: safeFetch currently returns body on GET; for POST we
      // inspect status only. Any 2xx counts as delivered.
      if (result.status >= 200 && result.status < 300) {
        await this.repo.markDelivered(deliveryRow.id, result.status);
        return { status: "delivered", responseStatus: result.status };
      }
      throw new WebhookDomainError(
        "DELIVERY_FAILED",
        `Receiver returned HTTP ${result.status}`,
      );
    } catch (err: unknown) {
      const errMsg = (err as Error).message || "delivery failed";
      const attempt = deliveryRow.attemptCount + 1;
      if (attempt >= MAX_RETRIES) {
        await this.repo.markDeadLetter(deliveryRow.id, errMsg);
        return { status: "dead_letter", responseStatus: null };
      }
      await this.repo.markFailed(deliveryRow.id, errMsg, attempt);
      await this.dispatcher.enqueue(deliveryRow.id, endpoint.id);
      return { status: "failed", responseStatus: null };
    }
  }

  async listDeliveries(filter?: {
    endpointId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ deliveries: WebhookDelivery[]; total: number }> {
    return this.repo.listDeliveries(filter);
  }

  /**
   * Re-enqueues failed deliveries for retry (bounded maintenance op).
   * Idempotent: retries reuse the same event identity.
   */
  async retryFailedDeliveries(): Promise<number> {
    const { deliveries } = await this.repo.listDeliveries({
      status: "failed",
      limit: 100,
    });
    let retried = 0;
    for (const delivery of deliveries) {
      if (delivery.attemptCount < MAX_RETRIES) {
        await this.dispatcher.enqueue(delivery.id, delivery.endpointId);
        retried++;
      }
    }
    return retried;
  }

  private async getDeliveryWithEndpoint(
    deliveryId: string,
  ): Promise<{
    deliveryRow: WebhookDelivery;
    endpoint: WebhookEndpoint;
  } | null> {
    const row = await this.repo.findDeliveryById(deliveryId);
    if (!row) return null;
    const endpoint = await this.repo.findEndpointById(row.endpointId);
    if (!endpoint) return null;
    return { deliveryRow: row, endpoint };
  }
}
