import { check, foreignKey, index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { platformApplications, platformInstallations } from "./platform-kernel";

export const platformSchemaRegistry = pgTable("platform_schema_registry", {
  installationId: text("installation_id").primaryKey().references(() => platformInstallations.id, { onDelete: "restrict" }),
  applicationId: text("application_id").notNull().references(() => platformApplications.id, { onDelete: "restrict" }),
  environment: text("environment").notNull(),
  databaseName: text("database_name").notNull(),
  operatorRole: text("operator_role").notNull(),
  runtimeRole: text("runtime_role").notNull(),
  manifest: text("manifest").notNull(),
  manifestDigest: text("manifest_digest").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  environmentCheck: check("platform_schema_registry_environment_check", sql.raw("environment IN ('test','development')")),
  digestCheck: check("platform_schema_registry_digest_check", sql.raw("manifest_digest ~ '^[0-9a-f]{64}$'")),
}));

export const platformSchemaPlans = pgTable("platform_schema_plans", {
  installationId: text("installation_id").notNull().references(() => platformSchemaRegistry.installationId, { onDelete: "restrict" }),
  planDigest: text("plan_digest").notNull(),
  expectedManifest: text("expected_manifest").notNull(),
  plan: text("plan").notNull(),
  author: text("author").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  primary: primaryKey({ columns: [table.installationId, table.planDigest] }),
  digestCheck: check("platform_schema_plans_digest_check", sql.raw("plan_digest ~ '^[0-9a-f]{64}$'")),
  authorCheck: check("platform_schema_plans_author_check", sql.raw("length(btrim(author)) > 0")),
}));

export const platformSchemaApprovals = pgTable("platform_schema_approvals", {
  installationId: text("installation_id").notNull(),
  planDigest: text("plan_digest").notNull(),
  operationId: text("operation_id").notNull(),
  approver: text("approver").notNull(),
  operatorRole: text("operator_role").notNull(),
  environment: text("environment").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, table => ({
  primary: primaryKey({ columns: [table.installationId, table.planDigest, table.operationId] }),
  planFk: foreignKey({
    name: "platform_schema_approvals_plan_fk",
    columns: [table.installationId, table.planDigest],
    foreignColumns: [platformSchemaPlans.installationId, platformSchemaPlans.planDigest],
  }).onDelete("restrict"),
  approverCheck: check("platform_schema_approvals_approver_check", sql.raw("length(btrim(approver)) > 0")),
  expiryCheck: check("platform_schema_approvals_expiry_check", sql.raw("expires_at > approved_at")),
  expiresIndex: index("platform_schema_approvals_expiry_idx").on(table.expiresAt, table.installationId),
}));

export const platformSchemaMigrationJournal = pgTable("platform_schema_migration_journal", {
  installationId: text("installation_id").notNull(),
  operationId: text("operation_id").notNull(),
  planDigest: text("plan_digest").notNull(),
  previousDigest: text("previous_digest").notNull(),
  newDigest: text("new_digest").notNull(),
  authorizationRef: text("authorization_ref").notNull(),
  operatorRole: text("operator_role").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  catalogEvidence: jsonb("catalog_evidence").notNull(),
}, table => ({
  primary: primaryKey({ columns: [table.installationId, table.operationId] }),
  approvalFk: foreignKey({
    name: "platform_schema_journal_approval_fk",
    columns: [table.installationId, table.planDigest, table.operationId],
    foreignColumns: [platformSchemaApprovals.installationId, platformSchemaApprovals.planDigest, platformSchemaApprovals.operationId],
  }).onDelete("restrict"),
  statusCheck: check("platform_schema_journal_status_check", sql.raw("status = 'COMPLETED'")),
  digestsCheck: check("platform_schema_journal_digests_check", sql.raw("previous_digest ~ '^[0-9a-f]{64}$' AND new_digest ~ '^[0-9a-f]{64}$'")),
  timesCheck: check("platform_schema_journal_times_check", sql.raw("completed_at >= started_at")),
}));
