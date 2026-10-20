import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  jsonb,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { publications } from "./publications";

export const integrations = pgTable("integrations", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  config: jsonb("config").notNull().default({}),
  encryptedSecrets: jsonb("encrypted_secrets"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type IntegrationRow = typeof integrations.$inferSelect;
export type NewIntegrationRow = typeof integrations.$inferInsert;

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: jsonb("scopes").notNull().default([]),
    integrationId: text("integration_id").references(() => integrations.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      prefixIdx: index("api_keys_prefix_idx").on(table.prefix),
    };
  },
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secretEncrypted: text("secret_encrypted"),
    enabled: boolean("enabled").notNull().default(true),
    eventTypes: jsonb("event_types").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      publicationIdIdx: index("webhook_endpoints_publication_id_idx").on(
        table.publicationId,
      ),
    };
  },
);

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpointRow = typeof webhookEndpoints.$inferInsert;

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    responseStatus: integer("response_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      endpointIdx: index("webhook_deliveries_endpoint_idx").on(
        table.endpointId,
      ),
      statusIdx: index("webhook_deliveries_status_idx").on(table.status),
      uniqueEndpointEventIdx: uniqueIndex(
        "webhook_deliveries_endpoint_event_idx",
      ).on(table.endpointId, table.eventId),
    };
  },
);

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDeliveryRow = typeof webhookDeliveries.$inferInsert;

export const plugins = pgTable("plugins", {
  id: text("id").primaryKey(),
  manifestId: text("manifest_id").notNull().unique(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  vibressApiVersion: text("vibress_api_version").notNull(),
  description: text("description"),
  entrypoint: text("entrypoint").notNull(),
  capabilities: jsonb("capabilities").notNull().default([]),
  hooks: jsonb("hooks").notNull().default([]),
  settingsSchema: jsonb("settings_schema").notNull().default({}),
  status: text("status").notNull().default("registered"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PluginRow = typeof plugins.$inferSelect;
export type NewPluginRow = typeof plugins.$inferInsert;

export const pluginSettings = pgTable(
  "plugin_settings",
  {
    id: text("id").primaryKey(),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value"),
    encryptedValue: text("encrypted_value"),
    isSecret: boolean("is_secret").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      uniquePluginKeyIdx: uniqueIndex("plugin_settings_plugin_key_idx").on(
        table.pluginId,
        table.key,
      ),
    };
  },
);

export type PluginSettingRow = typeof pluginSettings.$inferSelect;
export type NewPluginSettingRow = typeof pluginSettings.$inferInsert;

/**
 * Publication activation is additive: legacy global plugin status/settings
 * are preserved. An absent row means an external plugin is disabled here.
 */
export const pluginPublicationStates = pgTable(
  "plugin_publication_states",
  {
    pluginId: text("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "restrict" }),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pluginPublicationUniqueIdx: uniqueIndex("plugin_pub_states_plugin_publication_idx")
      .on(table.pluginId, table.publicationId),
    publicationIdx: index("plugin_pub_states_publication_idx").on(table.publicationId),
  }),
);

export type PluginPublicationStateRow = typeof pluginPublicationStates.$inferSelect;

/**
 * Scoped extension settings: independent from legacy global plugin_settings.
 * Secret values are ciphertext only; all lookups bind both IDs.
 */
export const pluginPublicationSettings = pgTable(
  "plugin_publication_settings",
  {
    id: text("id").primaryKey(),
    pluginId: text("plugin_id").notNull(),
    publicationId: text("publication_id").notNull(),
    key: text("key").notNull(),
    value: text("value"),
    encryptedValue: text("encrypted_value"),
    isSecret: boolean("is_secret").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scopedOwnerFk: foreignKey({
      name: "plugin_pub_settings_owner_fk",
      columns: [table.pluginId, table.publicationId],
      foreignColumns: [pluginPublicationStates.pluginId, pluginPublicationStates.publicationId],
    }).onDelete("cascade"),
    uniqueScopedSetting: uniqueIndex("plugin_pub_settings_unique_idx")
      .on(table.pluginId, table.publicationId, table.key),
    publicationSettingsIdx: index("plugin_pub_settings_publication_idx")
      .on(table.publicationId),
    validSecretStorage: check(
      "plugin_pub_settings_value_check",
      sql`(${table.isSecret} = true AND ${table.value} IS NULL AND ${table.encryptedValue} IS NOT NULL)
        OR (${table.isSecret} = false AND ${table.encryptedValue} IS NULL)`,
    ),
  }),
);

export type PluginPublicationSettingRow = typeof pluginPublicationSettings.$inferSelect;

/**
 * EXT-203: host-owned plugin model descriptors and data records.
 * The model FK prevents cross-plugin model spoofing; publication FK ensures
 * records from different sites never share a storage namespace. Disabling
 * a plugin does NOT delete records. There is no raw SQL plugin interface.
 */
export const pluginDataModels = pgTable("plugin_data_models", {
  pluginId: text("plugin_id").notNull().references(() => plugins.id, { onDelete: "restrict" }),
  modelId: text("model_id").notNull(),
  schemaHash: text("schema_hash").notNull(),
  fieldSchema: jsonb("field_schema").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  primary: primaryKey({ name: "plugin_data_models_pk", columns: [table.pluginId, table.modelId] }),
  nameCheck: check("plugin_data_model_name_check", sql`${table.modelId} ~ '^[a-z][a-z0-9-]{0,63}$'`),
  hashCheck: check("plugin_data_model_hash_check", sql`${table.schemaHash} ~ '^[a-f0-9]{64}$'`),
  schemaCheck: check("plugin_data_model_schema_check", sql`jsonb_typeof(${table.fieldSchema}) = 'object'`),
}));

export const pluginDataMigrationLedger = pgTable("plugin_data_migration_ledger", {
  pluginId: text("plugin_id").notNull().references(() => plugins.id, { onDelete: "restrict" }),
  migrationId: text("migration_id").notNull(),
  checksum: text("checksum").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  primary: primaryKey({
    name: "plugin_data_migration_ledger_pk", columns: [table.pluginId, table.migrationId],
  }),
  idCheck: check("plugin_data_migration_id_check", sql`${table.migrationId} ~ '^[a-z0-9][a-z0-9_-]{0,99}$'`),
  checksumCheck: check("plugin_data_migration_checksum_check", sql`${table.checksum} ~ '^[a-f0-9]{64}$'`),
}));

export const pluginDataRecords = pgTable("plugin_data_records", {
  pluginId: text("plugin_id").notNull(),
  publicationId: text("publication_id").notNull()
    .references(() => publications.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  recordId: text("record_id").notNull(),
  version: integer("version").notNull().default(1),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  primary: primaryKey({
    name: "plugin_data_records_pk",
    columns: [table.pluginId, table.publicationId, table.modelId, table.recordId],
  }),
  modelFk: foreignKey({
    name: "plugin_data_records_model_fk",
    columns: [table.pluginId, table.modelId],
    foreignColumns: [pluginDataModels.pluginId, pluginDataModels.modelId],
  }).onDelete("restrict"),
  versionCheck: check("plugin_data_records_version_check", sql`${table.version} > 0`),
  idCheck: check("plugin_data_records_id_check", sql`length(${table.recordId}) BETWEEN 1 AND 128`),
  payloadCheck: check("plugin_data_records_payload_check", sql`jsonb_typeof(${table.data}) = 'object'`),
  scopedListIdx: index("plugin_data_records_pub_model_idx")
    .on(table.publicationId, table.pluginId, table.modelId, table.createdAt, table.recordId),
}));

export type PluginDataModelRow = typeof pluginDataModels.$inferSelect;
export type PluginDataRecordRow = typeof pluginDataRecords.$inferSelect;
export type PluginDataMigrationRow = typeof pluginDataMigrationLedger.$inferSelect;
