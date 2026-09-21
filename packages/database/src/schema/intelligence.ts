import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  jsonb,
  date,
  boolean,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { publications } from "./publications";

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull().unique(),
    eventName: text("event_name").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorType: text("actor_type"),
    actorId: text("actor_id"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    // Public web traffic dimensions (privacy-safe). Only traffic events set these.
    path: text("path"),
    visitorHash: text("visitor_hash"),
    referrerDomain: text("referrer_domain"),
    isBot: boolean("is_bot").notNull().default(false),
    context: jsonb("context"),
    properties: jsonb("properties"),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      pubOccurredIdx: index("analytics_events_pub_occurred_idx").on(
        table.publicationId,
        table.occurredAt,
      ),
      eventNameIdx: index("analytics_events_name_idx").on(table.eventName),
      occurredAtIdx: index("analytics_events_occurred_at_idx").on(
        table.occurredAt,
      ),
      entityIdx: index("analytics_events_entity_idx").on(
        table.entityType,
        table.entityId,
      ),
      // Traffic queries: distinct visitors, top content, referrers, retention.
      visitorOccurredIdx: index("analytics_events_visitor_occurred_idx").on(
        table.visitorHash,
        table.occurredAt,
      ),
      pathOccurredIdx: index("analytics_events_path_occurred_idx").on(
        table.path,
        table.occurredAt,
      ),
      referrerOccurredIdx: index("analytics_events_referrer_occurred_idx").on(
        table.referrerDomain,
        table.occurredAt,
      ),
      nameOccurredIdx: index("analytics_events_name_occurred_idx").on(
        table.eventName,
        table.occurredAt,
      ),
    };
  },
);

export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEventRow = typeof analyticsEvents.$inferInsert;

export const analyticsDailyMetrics = pgTable(
  "analytics_daily_metrics",
  {
    id: text("id").primaryKey(),
    metricDate: date("metric_date").notNull(),
    metricName: text("metric_name").notNull(),
    dimensionKey: text("dimension_key").notNull().default("total"),
    dimensionValue: text("dimension_value").notNull().default("total"),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      uniqueMetricIdx: uniqueIndex("analytics_daily_metrics_unique_idx").on(
        table.metricDate,
        table.metricName,
        table.dimensionKey,
        table.dimensionValue,
      ),
      dateIdx: index("analytics_daily_metrics_date_idx").on(table.metricDate),
    };
  },
);

export type AnalyticsDailyMetricRow = typeof analyticsDailyMetrics.$inferSelect;
export type NewAnalyticsDailyMetricRow =
  typeof analyticsDailyMetrics.$inferInsert;

export const searchDocuments = pgTable(
  "search_documents",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    title: text("title").notNull(),
    bodyText: text("body_text").notNull().default(""),
    slug: text("slug").notNull().default(""),
    url: text("url").notNull().default(""),
    searchable: boolean("searchable").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      pubEntityIdx: uniqueIndex("search_documents_pub_entity_idx").on(
        table.publicationId,
        table.entityType,
        table.entityId,
      ),
      pubSearchableIdx: index("search_documents_pub_searchable_idx").on(
        table.publicationId,
        table.searchable,
      ),
      searchableIdx: index("search_documents_searchable_idx").on(
        table.searchable,
      ),
    };
  },
);

export type SearchDocumentRow = typeof searchDocuments.$inferSelect;
export type NewSearchDocumentRow = typeof searchDocuments.$inferInsert;

export const aiAuditLogs = pgTable(
  "ai_audit_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    task: text("task").notNull().default("completion"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    status: text("status").notNull().default("success"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      userIdIdx: index("ai_audit_logs_user_id_idx").on(table.userId),
      createdAtIdx: index("ai_audit_logs_created_at_idx").on(table.createdAt),
      providerModelIdx: index("ai_audit_logs_provider_model_idx").on(
        table.provider,
        table.model,
      ),
    };
  },
);

export type AiAuditLogRow = typeof aiAuditLogs.$inferSelect;
export type NewAiAuditLogRow = typeof aiAuditLogs.$inferInsert;
