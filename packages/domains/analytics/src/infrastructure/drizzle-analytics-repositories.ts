import { getDb, analyticsEvents, analyticsDailyMetrics, AnalyticsEventRow, AnalyticsDailyMetricRow } from '@vibress/database';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { AnalyticsRepository, IngestEventData, DailyMetric } from '../domain/analytics';

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
