import { OutboxEventName, OutboxEventPayloadMap } from "./event-map";
import { buildEventEnvelope } from "./event-envelope";
import { getActiveTraceContext } from "@vibress/observability";

/**
 * Minimal query surface of a transaction that already owns the business
 * mutation. Both ScopedTransaction and pg clients satisfy it.
 */
export interface OutboxQueryable {
  query<T = unknown>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface ScopedOutboxEvent<
  E extends OutboxEventName = OutboxEventName,
> {
  /** Caller-owned stable logical identity of the mutation. */
  id: string;
  eventType: E;
  payload: OutboxEventPayloadMap[E];
}

/**
 * Writes an outbox row through the caller's transaction so the event commits
 * or rolls back with the business state change. The caller owns `id`; the
 * ON CONFLICT keeps a replayed mutation to a single row. This is insert
 * idempotency, not exactly-once delivery.
 */
export async function writeScopedOutboxEvent<E extends OutboxEventName>(
  queryable: OutboxQueryable,
  event: ScopedOutboxEvent<E>,
): Promise<void> {
  const envelope = buildEventEnvelope(
    event.eventType,
    event.payload,
    getActiveTraceContext(),
  );
  await queryable.query(
    `INSERT INTO outbox_events (id, event_type, payload, status, attempts)
     VALUES ($1, $2, $3::jsonb, 'pending', 0)
     ON CONFLICT (id) DO NOTHING`,
    [event.id, event.eventType, JSON.stringify(envelope)],
  );
}
