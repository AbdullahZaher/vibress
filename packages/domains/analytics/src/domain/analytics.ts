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

export interface AnalyticsRepository {
  ingest(data: IngestEventData): Promise<void>;
  findEvent(eventId: string): Promise<boolean>;
  upsertDailyMetric(metric: { metricDate: string; metricName: string; dimensionKey: string; dimensionValue: string; count: number }): Promise<void>;
  getDailyMetrics(metricName: string, from: string, to: string): Promise<DailyMetric[]>;
  listEventNames(from: string, to: string): Promise<string[]>;
  rebuildDay(metricDate: string, events: IngestEventData[]): Promise<void>;
}
