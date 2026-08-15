import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const userPasskeys = pgTable(
  "user_passkeys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: jsonb("transports").default([]),
    deviceLabel: text("device_label"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCredentialIdx: uniqueIndex("user_passkeys_user_cred_idx").on(
      table.userId,
      table.credentialId,
    ),
  }),
);

export type UserPasskeyRow = typeof userPasskeys.$inferSelect;
export type NewUserPasskeyRow = typeof userPasskeys.$inferInsert;

export const userDevices = pgTable(
  "user_devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    deviceType: text("device_type").default("desktop"), // "desktop" | "mobile" | "tablet"
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userSessionIdx: index("user_devices_user_session_idx").on(table.userId, table.sessionId),
  }),
);

export type UserDeviceRow = typeof userDevices.$inferSelect;
export type NewUserDeviceRow = typeof userDevices.$inferInsert;

export const ssoProviders = pgTable(
  "sso_providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(), // "saml" | "oidc"
    issuer: text("issuer"),
    clientId: text("client_id"),
    clientSecret: text("client_secret"),
    authorizationUrl: text("authorization_url"),
    tokenUrl: text("token_url"),
    userInfoUrl: text("user_info_url"),
    samlMetadataXml: text("saml_metadata_xml"),
    domainMatch: text("domain_match"), // e.g. "acme.com"
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nameIdx: index("sso_providers_name_idx").on(table.name),
  }),
);

export type SsoProviderRow = typeof ssoProviders.$inferSelect;
export type NewSsoProviderRow = typeof ssoProviders.$inferInsert;

export const scimTokens = pgTable(
  "scim_tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scopes: jsonb("scopes").default(["users:read", "users:write"]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("scim_tokens_hash_idx").on(table.tokenHash),
  }),
);

export type ScimTokenRow = typeof scimTokens.$inferSelect;
export type NewScimTokenRow = typeof scimTokens.$inferInsert;

export const mfaEnforcements = pgTable(
  "mfa_enforcements",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    enforceForAll: boolean("enforce_for_all").notNull().default(false),
    enforceForRoles: jsonb("enforce_for_roles").default(["owner", "admin"]),
    gracePeriodDays: integer("grace_period_days").notNull().default(7),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type MfaEnforcementRow = typeof mfaEnforcements.$inferSelect;
export type NewMfaEnforcementRow = typeof mfaEnforcements.$inferInsert;
