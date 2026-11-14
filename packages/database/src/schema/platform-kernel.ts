import {
  pgTable,
  text,
  timestamp,
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
