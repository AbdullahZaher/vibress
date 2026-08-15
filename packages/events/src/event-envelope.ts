import {
  OutboxEventName,
  OutboxEventPayloadMap,
  isKnownOutboxEventName,
} from "./event-map";

export const OUTBOX_EVENT_VERSION = 1;

/**
 * Versioned event envelope stored in the outbox payload column. The version
 * field allows future payload migrations without changing the row shape;
 * consumers tolerate unknown versions by treating the payload opaquely.
 */
export interface EventEnvelope<T = unknown> {
  version: typeof OUTBOX_EVENT_VERSION;
  eventType: OutboxEventName;
  payload: T;
  /** Propagated OpenTelemetry trace context from the writing process (optional). */
  trace?: { traceId: string; spanId: string };
}

export function buildEventEnvelope<E extends OutboxEventName>(
  eventType: E,
  payload: OutboxEventPayloadMap[E],
  trace?: { traceId: string; spanId: string },
): EventEnvelope<OutboxEventPayloadMap[E]> {
  return {
    version: OUTBOX_EVENT_VERSION,
    eventType,
    payload,
    ...(trace ? { trace } : {}),
  };
}

export class EnvelopeValidationError extends Error {
  code = "OUTBOX_ENVELOPE_INVALID";

  constructor(message: string) {
    super(message);
  }
}

export function parseEventEnvelope(json: unknown): EventEnvelope<unknown> {
  if (!json || typeof json !== "object") {
    throw new EnvelopeValidationError("Outbox payload is not an object");
  }
  const candidate = json as Record<string, unknown>;
  if (candidate.version !== OUTBOX_EVENT_VERSION) {
    throw new EnvelopeValidationError(
      `Unsupported outbox envelope version: ${String(candidate.version)}`,
    );
  }
  if (
    typeof candidate.eventType !== "string" ||
    !isKnownOutboxEventName(candidate.eventType)
  ) {
    throw new EnvelopeValidationError(
      `Unknown outbox event type: ${String(candidate.eventType)}`,
    );
  }
  if (candidate.payload === undefined || candidate.payload === null) {
    throw new EnvelopeValidationError(
      `Outbox event missing payload: ${String(candidate.eventType)}`,
    );
  }
  return candidate as unknown as EventEnvelope<unknown>;
}
