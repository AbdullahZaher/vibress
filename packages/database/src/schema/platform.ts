import {
  pgTable,
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
 * EXT-203A: operator-reviewed extension schema migrations. No request-time
 * DDL, external SQL execution, or automatic activation. Append-only ledger.
 * Plugin deletion is restricted when an applied migration exists.
 */
export const pluginSchemaMigrations = pgTable(
  "plugin_schema_migrations",
  {
    pluginId: text("plugin_id").notNull()
      .references(() => plugins.id, { onDelete: "restrict" }),
    migrationId: text("migration_id").notNull(),
    packageVersion: text("package_version").notNull(),
    artifactSha256: text("artifact_sha256").notNull(),
    migrationSha256: text("migration_sha256").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (table) => ({
    uniqueMigration: uniqueIndex("plugin_schema_migrations_owner_id_idx")
      .on(table.pluginId, table.migrationId),
    migrationIdValid: check("plugin_schema_migrations_id_check",
      sql`${table.migrationId} ~ '^[0-9]{4}_[a-z][a-z0-9_]{0,63}$'`),
    artifactDigestValid: check("plugin_schema_migrations_artifact_sha_check",
      sql`${table.artifactSha256} ~ '^[a-f0-9]{64}$'`),
    migrationDigestValid: check("plugin_schema_migrations_migration_sha_check",
      sql`${table.migrationSha256} ~ '^[a-f0-9]{64}$'`),
    packageVersionValid: check("plugin_schema_migrations_package_version_check",
      sql`length(${table.packageVersion}) BETWEEN 1 AND 128`),
  }),
);
export type PluginSchemaMigrationRow = typeof pluginSchemaMigrations.$inferSelect;

/**
 * Namespace reservation only. EXT-203B will add reviewed typed relational
 * tables and scoped repositories. Catalog entries cannot create tables.
 */
export const pluginStorageModels = pgTable(
  "plugin_storage_models",
  {
    pluginId: text("plugin_id").notNull(),
    modelKey: text("model_key").notNull(),
    migrationId: text("migration_id").notNull(),
    schemaSha256: text("schema_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (table) => ({
    uniqueModel: uniqueIndex("plugin_storage_models_owner_key_idx")
      .on(table.pluginId, table.modelKey),
    migrationFk: foreignKey({
      name: "plugin_storage_models_migration_fk",
      columns: [table.pluginId, table.migrationId],
      foreignColumns: [pluginSchemaMigrations.pluginId, pluginSchemaMigrations.migrationId],
    }).onDelete("restrict"),
    keyValid: check("plugin_storage_models_key_check",
      sql`${table.modelKey} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    digestValid: check("plugin_storage_models_schema_sha_check",
      sql`${table.schemaSha256} ~ '^[a-f0-9]{64}$'`),
  }),
);
export type PluginStorageModelRow = typeof pluginStorageModels.$inferSelect;

/**
 * EXT-203B1: immutable owner mapping for operator-created physical
 * per-model tables; no plugin callable storage API is exposed here.
 */
export const pluginPhysicalModels = pgTable(
  "plugin_storage_physical_models",
  {
    pluginId: text("plugin_id").notNull(),
    modelKey: text("model_key").notNull(),
    tableName: text("table_name").notNull(),
    schemaSha256: text("schema_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    modelFk: foreignKey({
      name: "plugin_storage_physical_models_owner_fk",
      columns: [table.pluginId, table.modelKey],
      foreignColumns: [pluginStorageModels.pluginId, pluginStorageModels.modelKey],
    }).onDelete("restrict"),
    ownerUnique: uniqueIndex("plugin_storage_physical_models_owner_idx")
      .on(table.pluginId, table.modelKey),
    tableUnique: uniqueIndex("plugin_storage_physical_models_table_idx").on(table.tableName),
    tableNameValid: check("plugin_storage_physical_models_table_check",
      sql`${table.tableName} ~ '^ext_[a-f0-9]{40}$'`),
    schemaDigestValid: check("plugin_storage_physical_models_digest_check",
      sql`${table.schemaSha256} ~ '^[a-f0-9]{64}$'`),
  }),
);
export type PluginPhysicalModelRow = typeof pluginPhysicalModels.$inferSelect;
