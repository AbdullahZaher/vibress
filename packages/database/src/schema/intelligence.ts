import { pgTable, text, timestamp, integer, index, uniqueIndex, jsonb, date, boolean } from 'drizzle-orm/pg-core';
import { users } from './users';
import { members } from './members';

export const analyticsEvents = pgTable('analytics_events', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull().unique(),
  eventName: text('event_name').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  actorType: text('actor_type'),
  actorId: text('actor_id'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  // Public web traffic dimensions (privacy-safe). Only traffic events set these.
  path: text('path'),
  visitorHash: text('visitor_hash'),
  referrerDomain: text('referrer_domain'),
  isBot: boolean('is_bot').notNull().default(false),
  context: jsonb('context'),
  properties: jsonb('properties'),
  schemaVersion: integer('schema_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    eventNameIdx: index('analytics_events_name_idx').on(table.eventName),
    occurredAtIdx: index('analytics_events_occurred_at_idx').on(table.occurredAt),
    entityIdx: index('analytics_events_entity_idx').on(table.entityType, table.entityId),
    // Traffic queries: distinct visitors, top content, referrers, retention.
    visitorOccurredIdx: index('analytics_events_visitor_occurred_idx').on(table.visitorHash, table.occurredAt),
    pathOccurredIdx: index('analytics_events_path_occurred_idx').on(table.path, table.occurredAt),
    referrerOccurredIdx: index('analytics_events_referrer_occurred_idx').on(table.referrerDomain, table.occurredAt),
    nameOccurredIdx: index('analytics_events_name_occurred_idx').on(table.eventName, table.occurredAt),
  };
});

export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEventRow = typeof analyticsEvents.$inferInsert;

export const analyticsDailyMetrics = pgTable('analytics_daily_metrics', {
  id: text('id').primaryKey(),
  metricDate: date('metric_date').notNull(),
  metricName: text('metric_name').notNull(),
  dimensionKey: text('dimension_key').notNull().default('total'),
  dimensionValue: text('dimension_value').notNull().default('total'),
  count: integer('count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    uniqueMetricIdx: uniqueIndex('analytics_daily_metrics_unique_idx').on(table.metricDate, table.metricName, table.dimensionKey, table.dimensionValue),
    dateIdx: index('analytics_daily_metrics_date_idx').on(table.metricDate),
  };
});

export type AnalyticsDailyMetricRow = typeof analyticsDailyMetrics.$inferSelect;
export type NewAnalyticsDailyMetricRow = typeof analyticsDailyMetrics.$inferInsert;

export const searchDocuments = pgTable('search_documents', {
  id: text('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  title: text('title').notNull(),
  bodyText: text('body_text').notNull().default(''),
  slug: text('slug').notNull().default(''),
  url: text('url').notNull().default(''),
  searchable: boolean('searchable').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    uniqueEntityIdx: uniqueIndex('search_documents_entity_idx').on(table.entityType, table.entityId),
    searchableIdx: index('search_documents_searchable_idx').on(table.searchable),
  };
});

export type SearchDocumentRow = typeof searchDocuments.$inferSelect;
export type NewSearchDocumentRow = typeof searchDocuments.$inferInsert;

export const automations = pgTable('automations', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  triggerEvent: text('trigger_event').notNull(),
  conditions: jsonb('conditions').notNull().default([]),
  actions: jsonb('actions').notNull().default([]),
  status: text('status').notNull().default('draft'),
  version: integer('version').notNull().default(1),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    statusTriggerIdx: index('automations_status_trigger_idx').on(table.status, table.triggerEvent),
  };
});

export type AutomationRow = typeof automations.$inferSelect;
export type NewAutomationRow = typeof automations.$inferInsert;

export const automationVersions = pgTable('automation_versions', {
  id: text('id').primaryKey(),
  automationId: text('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  definition: jsonb('definition').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    uniqueVersionIdx: uniqueIndex('automation_versions_unique_idx').on(table.automationId, table.version),
  };
});

export type AutomationVersionRow = typeof automationVersions.$inferSelect;
export type NewAutomationVersionRow = typeof automationVersions.$inferInsert;

export const automationRuns = pgTable('automation_runs', {
  id: text('id').primaryKey(),
  automationId: text('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  runKey: text('run_key').notNull(),
  triggerEvent: text('trigger_event').notNull(),
  eventPayload: jsonb('event_payload'),
  status: text('status').notNull().default('pending'),
  depth: integer('depth').notNull().default(0),
  correlationId: text('correlation_id'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    automationIdx: index('automation_runs_automation_idx').on(table.automationId),
    runKeyIdx: index('automation_runs_run_key_idx').on(table.runKey),
    statusIdx: index('automation_runs_status_idx').on(table.status),
    uniqueRunKeyIdx: uniqueIndex('automation_runs_unique_run_key_idx').on(table.automationId, table.runKey),
  };
});

export type AutomationRunRow = typeof automationRuns.$inferSelect;
export type NewAutomationRunRow = typeof automationRuns.$inferInsert;

export const automationRunSteps = pgTable('automation_run_steps', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => automationRuns.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  actionType: text('action_type').notNull(),
  status: text('status').notNull().default('pending'),
  result: jsonb('result'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    uniqueRunStepIdx: uniqueIndex('automation_run_steps_unique_idx').on(table.runId, table.stepIndex),
    runIdx: index('automation_run_steps_run_idx').on(table.runId),
  };
});

export type AutomationRunStepRow = typeof automationRunSteps.$inferSelect;
export type NewAutomationRunStepRow = typeof automationRunSteps.$inferInsert;
