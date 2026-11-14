import {
  boolean,
  pgTable,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";

/**
 * Universal platform kernel records. These are additive and independent of the
 * CMS publication model: a Publication is not an Application or a Tenant.
 */
export const platformApplications = pgTable("platform_applications", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const platformInstallations = pgTable(
  "platform_installations",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => platformApplications.id, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    artifactDigest: text("artifact_digest"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    applicationIdx: index("platform_installations_application_idx").on(
      table.applicationId,
    ),
  }),
);

export const platformTenants = pgTable(
  "platform_tenants",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => platformApplications.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    applicationIdx: index("platform_tenants_application_idx").on(
      table.applicationId,
    ),
    idApplicationUnique: uniqueIndex("platform_tenants_id_application_idx").on(
      table.id,
      table.applicationId,
    ),
  }),
);

/**
 * Reference tenant-owned resource used to prove RLS behavior. Generated CRM
 * resources follow the same shape: a tenant id plus a composite foreign key to
 * the owning application.
 */
export const platformCrmCustomers = pgTable(
  "platform_crm_customers",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index("platform_crm_customers_tenant_idx").on(
      table.applicationId,
      table.tenantId,
    ),
    tenantForeignKey: foreignKey({
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [platformTenants.id, platformTenants.applicationId],
      name: "platform_crm_customers_tenant_fk",
    }).onDelete("cascade"),
  }),
);

export type PlatformApplicationRow = typeof platformApplications.$inferSelect;
export type PlatformInstallationRow = typeof platformInstallations.$inferSelect;
export type PlatformTenantRow = typeof platformTenants.$inferSelect;
export type PlatformCrmCustomerRow = typeof platformCrmCustomers.$inferSelect;

/**
 * Operator-owned registry of the serializable application manifest. Handler
 * code is never persisted: `manifest_digest` proves that the code deployed at
 * boot still matches what was registered.
 */
export const platformApplicationRegistrations = pgTable(
  "platform_application_registrations",
  {
    applicationId: text("application_id")
      .primaryKey()
      .references(() => platformApplications.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    manifest: jsonb("manifest").notNull(),
    manifestDigest: text("manifest_digest").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/**
 * Append-only record of registry mutations. Each row names the actor and the
 * digests before/after, so a drift update is attributable rather than only
 * detected. The foreign key restricts application deletion: audit rows are not
 * silently cascaded away with the application they describe.
 */
export const platformApplicationRegistryChanges = pgTable(
  "platform_application_registry_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => platformApplications.id, { onDelete: "restrict" }),
    changeKind: text("change_kind").notNull(),
    actor: text("actor").notNull(),
    previousDigest: text("previous_digest"),
    newDigest: text("new_digest").notNull(),
    previousVersion: text("previous_version"),
    newVersion: text("new_version").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    applicationRecordedIdx: index(
      "platform_application_registry_changes_app_idx",
    ).on(table.applicationId, table.recordedAt),
  }),
);

export type PlatformApplicationRegistryChangeRow =
  typeof platformApplicationRegistryChanges.$inferSelect;

/**
 * Principal membership directory. It is read before a verified tenant scope
 * exists, so it is not RLS-protected and the tenant runtime role has no
 * access to it; membership lookups belong to an auth service, not tenant code.
 */
export const platformMemberships = pgTable(
  "platform_memberships",
  {
    applicationId: text("application_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    principalId: text("principal_id").notNull(),
    active: boolean("active").notNull().default(true),
    roles: text("roles").array().notNull(),
    permissions: text("permissions").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({
      columns: [table.applicationId, table.tenantId, table.principalId],
    }),
    tenantForeignKey: foreignKey({
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [platformTenants.id, platformTenants.applicationId],
      name: "platform_memberships_tenant_fk",
    }).onDelete("cascade"),
    principalIdx: index("platform_memberships_principal_idx").on(
      table.applicationId,
      table.principalId,
    ),
  }),
);

export type PlatformApplicationRegistrationRow =
  typeof platformApplicationRegistrations.$inferSelect;
export type PlatformMembershipRow = typeof platformMemberships.$inferSelect;
