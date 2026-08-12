import { pgTable, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';

/**
 * Transactional outbox: one row per domain event that must be delivered to
 * downstream infrastructure (search index, analytics, webhooks). Rows are
 * written atomically with the business state change that caused them, then
 * dispatched asynchronously by the worker's OutboxDispatcherWorker.
 *
 * Fate statuses: pending -> published (delivered), failed (gave up).
 * 'delivering' is a transient claim marker, not a fate status; stale claims
 * are reclaimed by the dispatcher.
 */
export const outboxEvents = pgTable('outbox_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  availableAfter: timestamp('available_after', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    statusCreatedAtIdx: index('outbox_events_status_created_at_idx').on(table.status, table.createdAt),
    publishedAtIdx: index('outbox_events_published_at_idx').on(table.publishedAt),
  };
});

export type OutboxEventRow = typeof outboxEvents.$inferSelect;
export type NewOutboxEventRow = typeof outboxEvents.$inferInsert;