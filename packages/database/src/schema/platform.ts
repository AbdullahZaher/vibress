import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

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

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: text("id").primaryKey(),
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
});

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
