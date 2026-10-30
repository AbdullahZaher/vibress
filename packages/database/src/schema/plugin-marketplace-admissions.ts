import { sql } from "drizzle-orm";
import {
  pgTable, text, bigint, boolean, jsonb, timestamp, check, index,
} from "drizzle-orm/pg-core";
import { plugins } from "./platform";

/**
 * M8.8: durable, operator-controlled marketplace release admission.
 * Missing rows intentionally mean DENIED; old installs are not backfilled.
 * The full grant is a versioned JSON document validated by the domain.
 */
export const pluginMarketplaceAdmissions = pgTable(
  "plugin_marketplace_admissions",
  {
    pluginId: text("plugin_id").primaryKey()
      .references(() => plugins.id, { onDelete: "restrict" }),
    publisherId: text("publisher_id"),
    policyRevision: bigint("policy_revision", { mode: "number" }).notNull(),
    admission: jsonb("admission").notNull(),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    publisherIdx: index("plugin_marketplace_admissions_publisher_idx").on(t.publisherId),
    positiveRevision: check("plugin_marketplace_admissions_revision_check",
      sql`${t.policyRevision} > 0`),
    objectAdmission: check("plugin_marketplace_admissions_json_check",
      sql`jsonb_typeof(${t.admission}) = 'object'`),
  }),
);

export type PluginMarketplaceAdmissionRow = typeof pluginMarketplaceAdmissions.$inferSelect;

/** Persistent publisher-level deny list; never cleared by plugin reinstalls. */
export const pluginMarketplacePublisherRevocations = pgTable(
  "plugin_marketplace_publisher_revocations",
  {
    publisherId: text("publisher_id").primaryKey(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
    reason: text("reason"),
    operatorUserId: text("operator_user_id").notNull(),
  },
);

export type PluginMarketplacePublisherRevocationRow =
  typeof pluginMarketplacePublisherRevocations.$inferSelect;
