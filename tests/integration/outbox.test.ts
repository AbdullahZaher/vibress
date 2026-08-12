import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runMigrations, seedDatabase, getDbPool, closeDbPool, runInTransaction } from '@vibress/database';
import { withSpan, initTracing } from '@vibress/observability';
import {
  DrizzleOutboxRepository,
  OutboxEventWriter,
  OutboxDispatcherWorker,
  buildEventEnvelope,
  parseEventEnvelope,
  EnvelopeValidationError,
  isKnownOutboxEventName,
  type OutboxEventRow,
} from '@vibress/events';

describe('Transactional Outbox', () => {
  let repository: DrizzleOutboxRepository;
  let writer: OutboxEventWriter;
  let tracingHandle: { stop: () => Promise<void> };

  beforeAll(async () => {
    await runMigrations();
    const pool = getDbPool();
    await pool.query('TRUNCATE TABLE outbox_events CASCADE;');
    await seedDatabase();
    repository = new DrizzleOutboxRepository();
    writer = new OutboxEventWriter(repository);
    // Register a real OTel provider so spans are sampled during this suite
    // (exporter unreachable → fail-open, same as production without collector).
    tracingHandle = initTracing({
      enabled: true,
      serviceName: 'outbox-test',
      otlpEndpoint: 'http://127.0.0.1:1',
    });
  }, 30000);

  afterAll(async () => {
    await tracingHandle.stop();
    await closeDbPool();
  });

  async function countRows(where: string): Promise<number> {
    const pool = getDbPool();
    const res = await pool.query(`SELECT COUNT(*)::int AS n FROM outbox_events WHERE ${where}`);
    return res.rows[0].n;
  }

  async function writeDirect(
    eventType: 'post.published' | 'post.unpublished' | 'post.deleted',
    payload: Record<string, unknown>,
    opts: { createdAt?: Date } = {}
  ): Promise<string> {
    const envelope = buildEventEnvelope(eventType, payload as never);
    const id = `test-${randomUUID()}`;
    await repository.insert({
      id,
      eventType,
      payload: envelope,
      status: 'pending',
      attempts: 0,
      createdAt: opts.createdAt,
    });
    return id;
  }

  describe('outbox writer', () => {
    it('commits outbox rows written inside a transaction', async () => {
      const before = await countRows(`event_type = 'post.published'`);
      const postId = randomUUID();
      await runInTransaction(async () => {
        await writer.write('post.published', { postId, title: 'Hello', slug: 'hello' });
      });
      expect(await countRows(`event_type = 'post.published'`)).toBe(before + 1);
    });

    it('rolls back the outbox row when the transaction fails', async () => {
      const before = await countRows(`1=1`);
      await expect(
        runInTransaction(async () => {
          await writer.write('post.deleted', { postId: 'rollback-target' });
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
      expect(await countRows(`1=1`)).toBe(before);
    });

    it('persists rows outside a transaction as pending (worker-down safety)', async () => {
      const before = await countRows(`event_type = 'post.unpublished'`);
      await writer.write('post.unpublished', { postId: 'pending-target', slug: 'pending' });
      expect(await countRows(`event_type = 'post.unpublished'`)).toBe(before + 1);

      const rows = await repository.claimReady({ limit: 10 });
      const pendingUnpublish = rows.find((r) => r.eventType === 'post.unpublished');
      expect(pendingUnpublish).toBeDefined();
      expect(pendingUnpublish!.status).toBe('delivering');
      await repository.markPublished([pendingUnpublish!.id]);
    });

    it('propagates the active OpenTelemetry traceId into the outbox envelope', async () => {
      const postId = randomUUID();
      await withSpan('test.outbox.trace', async () => {
        await writer.write('post.published', { postId, title: 'Traced', slug: 'traced' });
      });
      const rows = await repository.claimReady({ limit: 50 });
      const row = rows.find((r) => {
        const env = parseEventEnvelope(r.payload);
        return env.payload && typeof env.payload === 'object' && (env.payload as { postId?: string }).postId === postId;
      });
      expect(row).toBeDefined();
      const envelope = parseEventEnvelope(row!.payload);
      expect(envelope.trace).toBeDefined();
      expect(envelope.trace!.traceId).toMatch(/^[0-9a-f]{32}$/);
      await repository.markPublished([row!.id]);
    });
  });

  describe('outbox repository claims', () => {
    it('claims pending rows exactly once under contention (SKIP LOCKED)', async () => {
      const id = await writeDirect('post.published', { postId: 'contend-1', title: 't', slug: 's' });

      const pool = getDbPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Lock the row without changing status; claimReady runs on a
        // different connection and must skip it (FOR UPDATE SKIP LOCKED).
        await client.query(`SELECT id FROM outbox_events WHERE id = '${id}' FOR UPDATE`);
        const first = await repository.claimReady({ limit: 10 });
        expect(first.map((r) => r.id)).not.toContain(id);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // Row unlocked: a subsequent claim wins it exactly once.
      const second = await repository.claimReady({ limit: 10 });
      expect(second.map((r) => r.id)).toContain(id);
      await repository.markPublished([id]);
      expect(await countRows(`id = '${id}' AND status = 'published'`)).toBe(1);
    });

    it('reclaims stale delivering claims so they are retried', async () => {
      const id = await writeDirect('post.deleted', { postId: 'stale-1' });
      const pool = getDbPool();
      await pool.query(`
        UPDATE outbox_events SET status = 'delivering', updated_at = now() - interval '2 minutes' WHERE id = '${id}'
      `);
      expect(await countRows(`id = '${id}' AND status = 'delivering'`)).toBe(1);
      const reclaimed = await repository.reclaimStaleClaims({ staleAfterMs: 60_000 });
      expect(reclaimed).toBeGreaterThanOrEqual(1);
      expect(await countRows(`id = '${id}' AND status = 'pending'`)).toBe(1);
      await repository.markPublished([id]);
    });

    it('does not claim rows whose availableAfter window has not passed', async () => {
      const id = await writeDirect('post.published', { postId: 'backoff-1', title: 't', slug: 's' });
      await repository.markFailed(id, 'simulated relay outage', { maxAttempts: 5 });

      const now = new Date();
      const withinWindow = await repository.claimReady({ limit: 10, now: new Date(now.getTime() + 1_000) });
      expect(withinWindow.map((r) => r.id)).not.toContain(id);

      const afterWindow = await repository.claimReady({ limit: 10, now: new Date(now.getTime() + 10_000) });
      expect(afterWindow.map((r) => r.id)).toContain(id);
      await repository.markPublished([id]);
    });

    it('marks a row failed permanently after max attempts', async () => {
      const id = await writeDirect('post.unpublished', { postId: 'failmax-1', slug: 'x' });
      await repository.markFailed(id, 'nope', { maxAttempts: 3 });
      await repository.markFailed(id, 'nope', { maxAttempts: 3 });
      await repository.markFailed(id, 'nope', { maxAttempts: 3 });
      expect(await countRows(`id = '${id}' AND status = 'failed' AND attempts = 3`)).toBe(1);
    });
  });

  describe('envelope validation', () => {
    it('round-trips typed envelopes', () => {
      const envelope = buildEventEnvelope('post.published', { postId: 'p1', title: 'T', slug: 't' });
      expect(parseEventEnvelope(envelope)).toEqual(envelope);
    });

    it('rejects unknown event types, versions, and malformed rows', () => {
      expect(isKnownOutboxEventName('post.published')).toBe(true);
      expect(isKnownOutboxEventName('post.bogus')).toBe(false);
      expect(() => parseEventEnvelope({ version: 1, eventType: 'post.bogus', payload: {} })).toThrow(EnvelopeValidationError);
      expect(() => parseEventEnvelope({ version: 99, eventType: 'post.published', payload: {} })).toThrow(EnvelopeValidationError);
      expect(() => parseEventEnvelope(null)).toThrow(EnvelopeValidationError);
    });
  });

  describe('outbox dispatcher', () => {
    it('delivers pending events to the relay and marks them published', async () => {
      const delivered: string[] = [];
      const dispatcher = new OutboxDispatcherWorker(repository, {
        deliver: async (row) => {
          delivered.push(row.eventType);
        },
      });
      const id = await writeDirect('post.published', { postId: 'dispatch-1', title: 't', slug: 's' });
      await dispatcher.runDispatchCycle();
      expect(delivered).toContain('post.published');
      expect(await countRows(`id = '${id}' AND status = 'published'`)).toBe(1);
    });

    it('keeps claim order across a batch', async () => {
      const delivered: string[] = [];
      const dispatcher = new OutboxDispatcherWorker(repository, {
        deliver: async (row) => {
          const envelope = parseEventEnvelope(row.payload);
          delivered.push((envelope.payload as { postId: string }).postId);
        },
      });
      const t0 = new Date();
      await writeDirect('post.published', { postId: 'order-1', title: 'a', slug: 'a' }, { createdAt: new Date(t0.getTime()) });
      await writeDirect('post.published', { postId: 'order-2', title: 'b', slug: 'b' }, { createdAt: new Date(t0.getTime() + 1000) });
      await dispatcher.runDispatchCycle();
      expect(delivered).toEqual(['order-1', 'order-2']);
    });

    it('retries failed deliveries after backoff and tolerates re-delivery idempotently', async () => {
      const deliveries: string[] = [];
      let failFirst = true;
      const dispatcher = new OutboxDispatcherWorker(repository, {
        deliver: async (row) => {
          deliveries.push(row.id);
          if (failFirst) {
            failFirst = false;
            throw new Error('redis unavailable');
          }
        },
      });
      const id = await writeDirect('post.deleted', { postId: 'retry-1' });

      // Cycle 1: delivery fails → row returns to pending with backoff window
      await dispatcher.runDispatchCycle();
      expect(deliveries).toHaveLength(1);
      expect(await countRows(`id = '${id}' AND status = 'pending' AND attempts = 1`)).toBe(1);

      // Within the backoff window the row is not claimable...
      const now = new Date();
      const withinWindow = await repository.claimReady({ limit: 10, now: new Date(now.getTime() + 1_000) });
      expect(withinWindow.map((r) => r.id)).not.toContain(id);

      // ...once the backoff expires, the next cycle redelivers and publishes.
      const pool = getDbPool();
      await pool.query(`UPDATE outbox_events SET available_after = now() - interval '1 second' WHERE id = '${id}'`);
      await dispatcher.runDispatchCycle();
      expect(deliveries).toHaveLength(2);
      expect(deliveries[0]).toBe(id);
      expect(deliveries[1]).toBe(id);
      expect(await countRows(`id = '${id}' AND status = 'published'`)).toBe(1);
    });

    it('purges rows past retention windows', async () => {
      const pool = getDbPool();
      const oldPublishedId = `ret-${randomUUID()}`;
      const recentPublishedId = `ret-${randomUUID()}`;
      const oldFailedId = `ret-${randomUUID()}`;
      await pool.query(`
        INSERT INTO outbox_events (id, event_type, payload, status, published_at, updated_at, created_at)
        VALUES
          ('${oldPublishedId}', 'post.published', '{"version":1,"eventType":"post.published","payload":{"postId":"x"}}', 'published', now() - interval '8 days', now() - interval '8 days', now() - interval '8 days'),
          ('${recentPublishedId}', 'post.published', '{"version":1,"eventType":"post.published","payload":{"postId":"x"}}', 'published', now(), now(), now()),
          ('${oldFailedId}', 'post.deleted', '{"version":1,"eventType":"post.deleted","payload":{"postId":"x"}}', 'failed', NULL, now() - interval '31 days', now() - interval '31 days');
      `);

      const dispatcher = new OutboxDispatcherWorker(
        repository,
        { deliver: async () => undefined },
        { publishedRetentionDays: 7, failedRetentionDays: 30 }
      );
      await dispatcher.runDispatchCycle();

      expect(await countRows(`id = '${oldPublishedId}'`)).toBe(0);
      expect(await countRows(`id = '${recentPublishedId}'`)).toBe(1);
      expect(await countRows(`id = '${oldFailedId}'`)).toBe(0);
    });
  });
});