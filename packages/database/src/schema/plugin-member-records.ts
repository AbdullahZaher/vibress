import { pgTable, text, integer, jsonb, timestamp, uniqueIndex, index, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pluginPublicationStates, pluginPhysicalModels } from "./platform";
import { members } from "./members";

/**
 * EXT-205: dedicated Member-owned records; never shared with Staff storage.
 * The Host verifies that member.publicationId matches the bound publication
 * within each database transaction. No Member/tenant selector is part of SDK.
 */
export const pluginMemberRecords = pgTable("plugin_member_records", {
  pluginId: text("plugin_id").notNull(),
  publicationId: text("publication_id").notNull(),
  memberId: text("member_id").notNull(),
  modelKey: text("model_key").notNull(),
  recordId: text("record_id").notNull(),
  version: integer("version").notNull().default(1),
  fields: jsonb("fields").$type<Record<string, string | number | boolean | null>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  installation: foreignKey({
    name: "plugin_member_records_publication_fk",
    columns: [table.pluginId, table.publicationId],
    foreignColumns: [pluginPublicationStates.pluginId, pluginPublicationStates.publicationId],
  }).onDelete("restrict"),
  memberOwner: foreignKey({
    name: "plugin_member_records_member_scope_fk",
    columns: [table.publicationId, table.memberId],
    foreignColumns: [members.publicationId, members.id],
  }).onDelete("cascade"),
  approvedModel: foreignKey({
    name: "plugin_member_records_model_fk",
    columns: [table.pluginId, table.modelKey],
    foreignColumns: [pluginPhysicalModels.pluginId, pluginPhysicalModels.modelKey],
  }).onDelete("restrict"),
  ownerUnique: uniqueIndex("plugin_member_records_owner_key_idx")
    .on(table.pluginId, table.publicationId, table.memberId, table.modelKey, table.recordId),
  memberScope: index("plugin_member_records_publication_member_idx")
    .on(table.publicationId, table.memberId),
  validVersion: check("plugin_member_records_version_check",
    sql`${table.version} > 0`),
  validFields: check("plugin_member_records_fields_check",
    sql`jsonb_typeof(${table.fields}) = 'object'`),
}));

export type PluginMemberRecordRow = typeof pluginMemberRecords.$inferSelect;
