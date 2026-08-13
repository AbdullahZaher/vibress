export const ANALYTICS_SCHEMA_VERSION = 1;

export const ALLOWED_EVENT_NAMES = [
  'post.view',
  'page.view',
  'member.signup',
  'subscription.started',
  'subscription.cancelled',
  'newsletter.sent',
  'newsletter.delivered',
  'comment.created',
  'recommendation.clicked',
  'member.created',
  'subscription.activated',
] as const;

export type AllowedEventName = (typeof ALLOWED_EVENT_NAMES)[number];

export interface AnalyticsEvent {
  id: string;
  eventId: string;
  eventName: string;
  occurredAt: Date;
  actorType: string | null;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  context: Record<string, unknown> | null;
  properties: Record<string, unknown> | null;
  schemaVersion: number;
  createdAt: Date;
}

export interface IngestEventData {
  eventId: string;
  eventName: string;
  occurredAt?: Date | undefined;
  actorType?: string | null | undefined;
  actorId?: string | null | undefined;
  entityType?: string | null | undefined;
  entityId?: string | null | undefined;
  /** Public web traffic dimensions (privacy-safe). Only traffic events set these. */
  path?: string | null | undefined;
  visitorHash?: string | null | undefined;
  referrerDomain?: string | null | undefined;
  isBot?: boolean | null | undefined;
  context?: Record<string, unknown> | null | undefined;
  properties?: Record<string, unknown> | null | undefined;
}

export interface DailyMetric {
  id: string;
  metricDate: string;
  metricName: string;
  dimensionKey: string;
  dimensionValue: string;
  count: number;
}

export interface TrafficTopRow {
  key: string;
  views: number;
}

export interface AnalyticsRepository {
  ingest(data: IngestEventData): Promise<void>;
  findEvent(eventId: string): Promise<boolean>;
  upsertDailyMetric(metric: { metricDate: string; metricName: string; dimensionKey: string; dimensionValue: string; count: number }): Promise<void>;
  getDailyMetrics(metricName: string, from: string, to: string): Promise<DailyMetric[]>;
  listEventNames(from: string, to: string): Promise<string[]>;
  rebuildDay(metricDate: string, events: IngestEventData[]): Promise<void>;

  /** Total non-bot traffic view events in a range, grouped by day (from daily metrics). */
  getTrafficViewsByDay(from: string, to: string): Promise<Array<{ date: string; views: number }>>;
  /** COUNT(DISTINCT visitor_hash) over raw non-bot traffic events in a range. */
  countDistinctVisitors(from: Date, to: Date): Promise<number>;
  /** COUNT(DISTINCT visitor_hash) grouped by UTC day over raw non-bot traffic events. */
  countDistinctVisitorsByDay(from: Date, to: Date): Promise<Array<{ date: string; visitors: number }>>;
  /** Top content paths by non-bot views, optionally filtered to one entity type. */
  getTopTrafficPaths(from: Date, to: Date, entityType?: string | null, limit?: number): Promise<TrafficTopRow[]>;
  /** Top referrer domains by non-bot views ('direct' bucket for null referrer). */
  getTopTrafficReferrers(from: Date, to: Date, limit?: number): Promise<TrafficTopRow[]>;
  /** Deletes traffic raw events older than `before` (retention). Returns deleted count. */
  deleteTrafficEventsBefore(before: Date): Promise<number>;
}
