import { getDb, analyticsEvents, analyticsDailyMetrics, AnalyticsEventRow, AnalyticsDailyMetricRow } from '@vibress/database';
import { eq, and, gte, lte, sql, inArray, isNotNull, isNull } from 'drizzle-orm';
import crypto from 'node:crypto';
import { AnalyticsRepository, IngestEventData, DailyMetric, TrafficTopRow } from '../domain/analytics';

/** Traffic event names used for public web page/post views. */
export const TRAFFIC_EVENT_NAMES = ['post.view', 'page.view'] as const;

export class DrizzleAnalyticsRepository implements AnalyticsRepository {
  async ingest(data: IngestEventData): Promise<void> {
    const db = getDb();
    const occurredAt = data.occurredAt ? new Date(data.occurredAt) : new Date();
    await db.insert(analyticsEvents).values({
      id: crypto.randomUUID(),
      eventId: data.eventId,
      eventName: data.eventName,
      occurredAt,
      actorType: data.actorType || null,
      actorId: data.actorId || null,
      entityType: data.entityType || null,
      entityId: data.entityId || null,
      path: data.path ?? null,
      visitorHash: data.visitorHash ?? null,
      referrerDomain: data.referrerDomain ?? null,
      isBot: data.isBot ?? false,
      context: data.context || null,
      properties: data.properties || null,
      schemaVersion: 1,
      createdAt: new Date(),
    }).onConflictDoNothing();
  }

  async findEvent(eventId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db.select({ id: analyticsEvents.id }).from(analyticsEvents).where(eq(analyticsEvents.eventId, eventId)).limit(1);
    return rows.length > 0;
  }

  async upsertDailyMetric(metric: { metricDate: string; metricName: string; dimensionKey: string; dimensionValue: string; count: number }): Promise<void> {
    const db = getDb();
    await db
      .insert(analyticsDailyMetrics)
      .values({
        id: crypto.randomUUID(),
        metricDate: metric.metricDate,
        metricName: metric.metricName,
        dimensionKey: metric.dimensionKey,
        dimensionValue: metric.dimensionValue,
        count: metric.count,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [analyticsDailyMetrics.metricDate, analyticsDailyMetrics.metricName, analyticsDailyMetrics.dimensionKey, analyticsDailyMetrics.dimensionValue],
        set: { count: sql`${analyticsDailyMetrics.count} + ${metric.count}`, updatedAt: new Date() },
      });
  }

  async getDailyMetrics(metricName: string, from: string, to: string): Promise<DailyMetric[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(analyticsDailyMetrics)
      .where(and(
        eq(analyticsDailyMetrics.metricName, metricName),
        gte(analyticsDailyMetrics.metricDate, from),
        lte(analyticsDailyMetrics.metricDate, to),
      ))
      .orderBy(analyticsDailyMetrics.metricDate);
    return rows.map((r) => this.mapMetricToDomain(r));
  }

  async listEventNames(from: string, to: string): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .select({ eventName: analyticsEvents.eventName })
      .from(analyticsEvents)
      .where(and(
        gte(analyticsEvents.occurredAt, new Date(`${from}T00:00:00Z`)),
        lte(analyticsEvents.occurredAt, new Date(`${to}T23:59:59Z`)),
      ))
      .groupBy(analyticsEvents.eventName);
    return rows.map((r) => r.eventName);
  }

  async rebuildDay(metricDate: string, events: IngestEventData[]): Promise<void> {
    const db = getDb();
    // Clear the day's metrics for this event range, then re-aggregate
    await db
      .delete(analyticsDailyMetrics)
      .where(eq(analyticsDailyMetrics.metricDate, metricDate));

    const byName: Record<string, number> = {};
    for (const evt of events) {
      byName[evt.eventName] = (byName[evt.eventName] || 0) + 1;
    }
    for (const [name, count] of Object.entries(byName)) {
      await db.insert(analyticsDailyMetrics).values({
        id: crypto.randomUUID(),
        metricDate,
        metricName: name,
        dimensionKey: 'total',
        dimensionValue: 'total',
        count,
        updatedAt: new Date(),
      }).onConflictDoNothing();
    }
  }

  async getTrafficViewsByDay(from: string, to: string): Promise<Array<{ date: string; views: number }>> {
    const db = getDb();
    const rows = await db
      .select({
        date: analyticsDailyMetrics.metricDate,
        views: sql<number>`sum(${analyticsDailyMetrics.count})::int`,
      })
      .from(analyticsDailyMetrics)
      .where(and(
        inArray(analyticsDailyMetrics.metricName, [...TRAFFIC_EVENT_NAMES]),
        eq(analyticsDailyMetrics.dimensionKey, 'total'),
        eq(analyticsDailyMetrics.dimensionValue, 'total'),
        gte(analyticsDailyMetrics.metricDate, from),
        lte(analyticsDailyMetrics.metricDate, to),
      ))
      .groupBy(analyticsDailyMetrics.metricDate)
      .orderBy(analyticsDailyMetrics.metricDate);
    return rows.map((r) => ({ date: r.date, views: Number(r.views) || 0 }));
  }

  async countDistinctVisitors(from: Date, to: Date): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ count: sql<number>`count(distinct ${analyticsEvents.visitorHash})::int` })
      .from(analyticsEvents)
      .where(and(
        inArray(analyticsEvents.eventName, [...TRAFFIC_EVENT_NAMES]),
        eq(analyticsEvents.isBot, false),
        isNotNull(analyticsEvents.visitorHash),
        gte(analyticsEvents.occurredAt, from),
        lte(analyticsEvents.occurredAt, to),
      ));
    return Number(rows[0]?.count || 0);
  }

  async countDistinctVisitorsByDay(from: Date, to: Date): Promise<Array<{ date: string; visitors: number }>> {
    const db = getDb();
    const rows = await db
      .select({
        date: sql<string>`to_char(${analyticsEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        visitors: sql<number>`count(distinct ${analyticsEvents.visitorHash})::int`,
      })
      .from(analyticsEvents)
      .where(and(
        inArray(analyticsEvents.eventName, [...TRAFFIC_EVENT_NAMES]),
        eq(analyticsEvents.isBot, false),
        isNotNull(analyticsEvents.visitorHash),
        gte(analyticsEvents.occurredAt, from),
        lte(analyticsEvents.occurredAt, to),
      ))
      .groupBy(sql`to_char(${analyticsEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${analyticsEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`);
    return rows.map((r) => ({ date: r.date, visitors: Number(r.visitors) || 0 }));
  }

  async getTopTrafficPaths(from: Date, to: Date, entityType?: string | null, limit = 10): Promise<TrafficTopRow[]> {
    const db = getDb();
    const conditions = [
      inArray(analyticsEvents.eventName, [...TRAFFIC_EVENT_NAMES]),
      eq(analyticsEvents.isBot, false),
      isNotNull(analyticsEvents.path),
      gte(analyticsEvents.occurredAt, from),
      lte(analyticsEvents.occurredAt, to),
    ];
    if (entityType) {
      conditions.push(eq(analyticsEvents.entityType, entityType));
    }
    const rows = await db
      .select({
        key: analyticsEvents.path,
        views: sql<number>`count(*)::int`,
      })
      .from(analyticsEvents)
      .where(and(...conditions))
      .groupBy(analyticsEvents.path)
      .orderBy(sql`count(*) desc`)
      .limit(limit);
    return rows.map((r) => ({ key: r.key ?? '', views: Number(r.views) || 0 }));
  }

  async getTopTrafficReferrers(from: Date, to: Date, limit = 10): Promise<TrafficTopRow[]> {
    const db = getDb();
    const rows = await db
      .select({
        key: sql<string>`coalesce(${analyticsEvents.referrerDomain}, 'direct')`,
        views: sql<number>`count(*)::int`,
      })
      .from(analyticsEvents)
      .where(and(
        inArray(analyticsEvents.eventName, [...TRAFFIC_EVENT_NAMES]),
        eq(analyticsEvents.isBot, false),
        gte(analyticsEvents.occurredAt, from),
        lte(analyticsEvents.occurredAt, to),
      ))
      .groupBy(sql`coalesce(${analyticsEvents.referrerDomain}, 'direct')`)
      .orderBy(sql`count(*) desc`)
      .limit(limit);
    return rows.map((r) => ({ key: String(r.key), views: Number(r.views) || 0 }));
  }

  async deleteTrafficEventsBefore(before: Date): Promise<number> {
    const db = getDb();
    const result = await db
      .delete(analyticsEvents)
      .where(and(
        inArray(analyticsEvents.eventName, [...TRAFFIC_EVENT_NAMES]),
        lte(analyticsEvents.occurredAt, before),
      ))
      .returning({ id: analyticsEvents.id });
    return result.length;
  }

  private mapMetricToDomain(row: AnalyticsDailyMetricRow): DailyMetric {
    return {
      id: row.id,
      metricDate: row.metricDate,
      metricName: row.metricName,
      dimensionKey: row.dimensionKey,
      dimensionValue: row.dimensionValue,
      count: row.count,
    };
  }
}

export type { AnalyticsEventRow, AnalyticsDailyMetricRow };
