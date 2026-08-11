import { randomUUID } from 'node:crypto';
import { OutboxEventName, OutboxEventPayloadMap } from './event-map';
import { buildEventEnvelope } from './event-envelope';
import { OutboxRepository, defaultOutboxRepository } from './outbox-repository';

/**
 * Writes domain events into the transactional outbox. Safe to call inside a
 * runInTransaction block: the repository's getDb() resolves to the active
 * transaction, so the outbox row commits (or rolls back) atomically with the
 * business state change that produced it.
 */
export class OutboxEventWriter {
  constructor(private repository: OutboxRepository = defaultOutboxRepository) {}

  async write<E extends OutboxEventName>(eventName: E, payload: OutboxEventPayloadMap[E]): Promise<void> {
    const envelope = buildEventEnvelope(eventName, payload);
    await this.repository.insert({
      id: randomUUID(),
      eventType: eventName,
      payload: envelope,
      status: 'pending',
      attempts: 0,
    });
  }
}

export const defaultOutboxEventWriter: OutboxEventWriter = new OutboxEventWriter();