import { AnalyticsRepository, IngestEventData, ALLOWED_EVENT_NAMES, ANALYTICS_SCHEMA_VERSION } from '../domain/analytics';
import { domainEvents } from '@vibress/events';
import crypto from 'node:crypto';

export class AnalyticsDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const MAX_EVENT_PROPERTIES = 20;
const MAX_PROPERTY_KEYS = 1000;
const MAX_STRING_LENGTH = 500;

/**
 * Validates the bounded analytics envelope. Arbitrary unbounded JSON and
 * unknown event names are rejected. PII minimization: actor/entity IDs are
 * opaque references, not emails/names; context is key- and length-bounded.
 */
export function validateAnalyticsEvent(data: IngestEventData): IngestEventData {
  if (!data.eventId || typeof data.eventId !== 'string' || data.eventId.length > 128) {
    throw new AnalyticsDomainError('INVALID_EVENT', 'eventId must be a non-empty string');
  }
  if (typeof data.eventName !== 'string' || !ALLOWED_EVENT_NAMES.includes(data.eventName as (typeof ALLOWED_EVENT_NAMES)[number])) {
    throw new AnalyticsDomainError('INVALID_EVENT', `Unknown analytics event: ${data.eventName}`);
  }
  if (data.context && Object.keys(data.context).length > MAX_PROPERTY_KEYS) {
    throw new AnalyticsDomainError('INVALID_EVENT', 'context has too many keys');
  }
  if (data.properties && Object.keys(data.properties).length > MAX_PROPERTY_KEYS) {
    throw new AnalyticsDomainError('INVALID_EVENT', 'properties has too many keys');
  }
  // Bounded traffic fields (public web tracking)
  if (data.path !== undefined && data.path !== null) {
    if (typeof data.path !== 'string' || data.path.length > 512 || !data.path.startsWith('/')) {
      throw new AnalyticsDomainError('INVALID_EVENT', 'path must be a short normalized path');
    }
  }
  if (data.visitorHash !== undefined && data.visitorHash !== null) {
    if (typeof data.visitorHash !== 'string' || data.visitorHash.length > 64 || !/^[0-9a-f]{64}$/.test(data.visitorHash)) {
      throw new AnalyticsDomainError('INVALID_EVENT', 'visitorHash must be a 64-char hex digest');
    }
  }
  if (data.referrerDomain !== undefined && data.referrerDomain !== null) {
    if (typeof data.referrerDomain !== 'string' || data.referrerDomain.length > 253) {
      throw new AnalyticsDomainError('INVALID_EVENT', 'referrerDomain must be a short domain');
    }
  }
  // Bounded string values
  const checkValues = (obj: Record<string, unknown> | null | undefined) => {
    if (!obj) return;
    for (const [key, value] of Object.entries(obj)) {
      if (key.length > 100) throw new AnalyticsDomainError('INVALID_EVENT', 'property key too long');
      if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
        throw new AnalyticsDomainError('INVALID_EVENT', 'property value too long');
      }
      if (Array.isArray(value) && value.length > 50) {
        throw new AnalyticsDomainError('INVALID_EVENT', 'property array too large');
      }
    }
  };
  checkValues(data.context);
  checkValues(data.properties);

  return data;
}

export interface MetricsQuery {
  metricName?: string | undefined;
  from: string;
  to: string;
}

export class AnalyticsService {
  constructor(private repo: AnalyticsRepository) {}

  /**
   * Ingests a validated event and updates the idempotent daily aggregation.
   * Idempotent: duplicate event IDs are ignored.
   */
  async ingest(data: IngestEventData): Promise<void> {
    const validated = validateAnalyticsEvent(data);
    const exists = await this.repo.findEvent(validated.eventId);
    if (exists) return;

    await this.repo.ingest(validated);

    // Daily aggregation (date bucket = UTC date). occurredAt may arrive as a
    // JSON string after queue serialization — coerce defensively. Bot events
    // are persisted raw (for diagnostics) but never counted in aggregates, so
    // bots cannot distort dashboard statistics.
    const occurredAt = validated.occurredAt ? new Date(validated.occurredAt) : new Date();
    const dateBucket = occurredAt.toISOString().slice(0, 10);
    if (!validated.isBot) {
      await this.repo.upsertDailyMetric({
        metricDate: dateBucket,
        metricName: validated.eventName,
        dimensionKey: 'total',
        dimensionValue: 'total',
        count: 1,
      });
    }

    domainEvents.emit('analytics.event_ingested', { eventId: validated.eventId, eventName: validated.eventName, isBot: !!validated.isBot });
  }

  /**
   * Bounded aggregation query over daily metrics. Date buckets are UTC days.
   */
  async getMetrics(query: MetricsQuery): Promise<{ metrics: Array<{ date: string; name: string; count: number }>; from: string; to: string; timezone: string }> {
    const from = query.from || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const to = query.to || new Date().toISOString().slice(0, 10);

    let metrics;
    if (query.metricName) {
      const rows = await this.repo.getDailyMetrics(query.metricName, from, to);
      metrics = rows.map((r) => ({ date: r.metricDate, name: r.metricName, count: r.count }));
    } else {
      // Aggregate all metric names for the range
      const names = await this.repo.listEventNames(from, to);
      const all: Array<{ date: string; name: string; count: number }> = [];
      for (const name of names) {
        const rows = await this.repo.getDailyMetrics(name, from, to);
        for (const r of rows) all.push({ date: r.metricDate, name: r.metricName, count: r.count });
      }
      metrics = all;
    }

    return { metrics, from, to, timezone: 'UTC' };
  }

  /**
   * Rebuilds the daily aggregation for a date bucket from raw events.
   * Used for recompute/recovery.
   */
  async rebuild(metricDate: string, events: IngestEventData[]): Promise<void> {
    const validated = events.map((e) => validateAnalyticsEvent(e));
    await this.repo.rebuildDay(metricDate, validated);
  }
}
