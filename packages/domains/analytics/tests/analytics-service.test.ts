import { describe, it, expect, vi } from 'vitest';
import { AnalyticsService, AnalyticsDomainError, validateAnalyticsEvent } from '../src/application/analytics-service';
import { AnalyticsRepository, IngestEventData } from '../src/domain/analytics';

describe('validateAnalyticsEvent', () => {
  it('accepts a valid bounded event', () => {
    const event: IngestEventData = {
      eventId: 'evt-1',
      eventName: 'post.view',
      entityType: 'post',
      entityId: 'p1',
    };
    expect(() => validateAnalyticsEvent(event)).not.toThrow();
  });

  it('rejects an unknown event name (bounded envelope)', () => {
    const event: IngestEventData = { eventId: 'evt-2', eventName: 'hacked.event' };
    expect(() => validateAnalyticsEvent(event)).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
  });

  it('rejects oversized property values', () => {
    const event: IngestEventData = {
      eventId: 'evt-3',
      eventName: 'post.view',
      properties: { big: 'x'.repeat(600) },
    };
    expect(() => validateAnalyticsEvent(event)).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
  });

  it('rejects a missing eventId', () => {
    expect(() => validateAnalyticsEvent({ eventName: 'post.view' } as any))
      .toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
  });
});

describe('AnalyticsService', () => {
  const repo: AnalyticsRepository = {
    ingest: vi.fn(async () => undefined),
    findEvent: vi.fn(async () => false),
    upsertDailyMetric: vi.fn(async () => undefined),
    getDailyMetrics: vi.fn(async () => []),
    listEventNames: vi.fn(async () => []),
    rebuildDay: vi.fn(async () => undefined),
  };

  it('ingest is idempotent: duplicate event IDs are ignored', async () => {
    const repoWith: AnalyticsRepository = {
      ...repo,
      findEvent: vi.fn(async () => true), // already ingested
    };
    const service = new AnalyticsService(repoWith);
    await service.ingest({ eventId: 'dup-1', eventName: 'post.view' });
    expect(repoWith.ingest).not.toHaveBeenCalled();
  });

  it('ingest aggregates into daily metrics (UTC date bucket)', async () => {
    const service = new AnalyticsService(repo);
    await service.ingest({ eventId: 'evt-x', eventName: 'member.signup', occurredAt: new Date('2026-08-08T10:00:00Z') });
    expect(repo.upsertDailyMetric).toHaveBeenCalledWith(expect.objectContaining({
      metricDate: '2026-08-08',
      metricName: 'member.signup',
      dimensionKey: 'total',
      count: 1,
    }));
  });

  it('getMetrics returns bounded range with UTC timezone label', async () => {
    const service = new AnalyticsService(repo);
    const result = await service.getMetrics({ from: '2026-08-01', to: '2026-08-08' });
    expect(result.timezone).toBe('UTC');
    expect(result.from).toBe('2026-08-01');
    expect(result.to).toBe('2026-08-08');
  });

  it('rebuild re-aggregates a day from raw events', async () => {
    const service = new AnalyticsService(repo);
    await service.rebuild('2026-08-08', [
      { eventId: 'a', eventName: 'post.view' },
      { eventId: 'b', eventName: 'post.view' },
      { eventId: 'c', eventName: 'comment.created' },
    ]);
    expect(repo.rebuildDay).toHaveBeenCalledWith('2026-08-08', expect.any(Array));
  });
});
