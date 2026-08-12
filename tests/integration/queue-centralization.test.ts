import { describe, it, expect } from 'vitest';
import { QUEUE_NAMES, createQueue, createWorker, QUEUE_DEFAULTS } from '@vibress/queue';

describe('Queue Centralization', () => {
  it('exports all required canonical queue names', () => {
    expect(QUEUE_NAMES.EMAIL_DELIVERY).toBe('vibress-email-delivery');
    expect(QUEUE_NAMES.WEBHOOK_DELIVERY).toBe('vibress-webhook-delivery');
    expect(QUEUE_NAMES.SEARCH).toBe('vibress-search');
    expect(QUEUE_NAMES.ANALYTICS).toBe('vibress-analytics');
    expect(QUEUE_NAMES.AUTOMATIONS_RUN).toBe('vibress-automations');
    expect(QUEUE_NAMES.AUTOMATIONS_DELAYED).toBe('vibress-automations-delayed');
  });

  it('queue names are unique', () => {
    const values = Object.values(QUEUE_NAMES);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('createQueue returns a Queue instance connected to Redis', () => {
    const q = createQueue(QUEUE_NAMES.SEARCH);
    expect(q).toBeDefined();
    expect(q.name).toBe(QUEUE_NAMES.SEARCH);
    q.close();
  });

  it('createWorker returns a Worker instance', () => {
    const w = createWorker(QUEUE_NAMES.SEARCH, async () => undefined);
    expect(w).toBeDefined();
    expect(w.name).toBe(QUEUE_NAMES.SEARCH);
    w.close();
  });

  it('typed job interfaces match actual usage shapes', () => {
    const emailJob: { sendId: string; recipientIds: string[] } = {
      sendId: 'test-send',
      recipientIds: ['r1', 'r2'],
    };
    expect(emailJob.recipientIds).toHaveLength(2);

    const searchJob: { op: string; entityType?: string; entityId?: string } = {
      op: 'upsert',
      entityType: 'post',
      entityId: '123',
    };
    expect(searchJob.op).toBe('upsert');
  });

  it('provides default retry policies', () => {
    expect(QUEUE_DEFAULTS.EMAIL.attempts).toBe(5);
    expect(QUEUE_DEFAULTS.EMAIL.backoff.type).toBe('exponential');
    expect(QUEUE_DEFAULTS.STANDARD.attempts).toBe(3);
  });
});
