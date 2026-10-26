import {
  pgTable, text, timestamp, integer, jsonb, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { plugins } from "./platform";

/** Operator-only inert staging; activation/fleet changes are NOT implied. */
export const pluginUpgradePlans = pgTable("plugin_upgrade_plans", {
  id: text("id").primaryKey(),
  pluginId: text("plugin_id").notNull().references(() => plugins.id, { onDelete: "restrict" }),
  manifestId: text("manifest_id").notNull(),
  fromVersion: text("from_version").notNull(),
  toVersion: text("to_version").notNull(),
  fromArtifactSha256: text("from_artifact_sha256").notNull(),
  toArtifactSha256: text("to_artifact_sha256").notNull(),
  fromLockfileSha256: text("from_lockfile_sha256").notNull(),
  toLockfileSha256: text("to_lockfile_sha256").notNull(),
  fromSignerSha256: text("from_signer_sha256").notNull(),
  toSignerSha256: text("to_signer_sha256").notNull(),
  capabilitiesAdded: jsonb("capabilities_added").$type<string[]>().notNull().default([]),
  capabilitiesRemoved: jsonb("capabilities_removed").$type<string[]>().notNull().default([]),
  planSha256: text("plan_sha256").notNull(),
  status: text("status").notNull().default("staged"),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  active: uniqueIndex("plugin_upgrade_plans_active_owner_idx").on(table.pluginId)
    .where(sql`${table.status} NOT IN ('aborted', 'completed')`),
  ownerCreated: index("plugin_upgrade_plans_owner_created_idx")
    .on(table.pluginId, table.createdAt),
  validStatus: check("plugin_upgrade_plans_status_check",
    sql`${table.status} IN ('staged', 'preflighted', 'approved', 'quiesced', 'migrated', 'activated', 'observed', 'completed', 'aborted')`),
  validRevision: check("plugin_upgrade_plans_revision_check", sql`${table.revision} > 0`),
  validDigests: check("plugin_upgrade_plans_digests_check", sql`
    ${table.fromArtifactSha256} ~ '^[a-f0-9]{64}$' AND
    ${table.toArtifactSha256} ~ '^[a-f0-9]{64}$' AND
    ${table.fromLockfileSha256} ~ '^[a-f0-9]{64}$' AND
    ${table.toLockfileSha256} ~ '^[a-f0-9]{64}$' AND
    ${table.fromSignerSha256} ~ '^[a-f0-9]{64}$' AND
    ${table.toSignerSha256} ~ '^[a-f0-9]{64}$' AND
    ${table.planSha256} ~ '^[a-f0-9]{64}$'`),
}));
export type PluginUpgradePlanRow = typeof pluginUpgradePlans.$inferSelect;
