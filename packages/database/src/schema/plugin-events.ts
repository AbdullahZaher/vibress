import {
  pgTable, text, timestamp, jsonb, uniqueIndex, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { publications } from "./publications";
import { plugins } from "./platform";

/** Durable admission, NOT proof of exactly-once execution.
 * Rows remain after BullMQ retention and block reuse of the event ID.
 * Restrict deletion so uninstall/tenant deletion cannot silently erase work. */
export const pluginEventReceipts = pgTable("plugin_event_receipts", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  pluginId: text("plugin_id").notNull()
    .references(() => plugins.id, { onDelete: "restrict" }),
  publicationId: text("publication_id").notNull()
    .references(() => publications.id, { onDelete: "cascade" }),
  envelopeHash: text("envelope_hash").notNull(),
  envelope: jsonb("envelope").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
}, (t) => ({
  identity: uniqueIndex("plugin_event_receipts_scope_event_idx")
    .on(t.publicationId, t.pluginId, t.eventId),
  pending: index("plugin_event_receipts_status_created_idx")
    .on(t.status, t.createdAt),
  validHash: check("plugin_event_receipts_sha_check",
    sql`${t.envelopeHash} ~ '^[a-f0-9]{64}$'`),
  validStatus: check("plugin_event_receipts_status_check",
    sql`${t.status} IN ('pending', 'dispatching', 'queued', 'executed', 'retired')`),
}));

export type PluginEventReceiptRow = typeof pluginEventReceipts.$inferSelect;
