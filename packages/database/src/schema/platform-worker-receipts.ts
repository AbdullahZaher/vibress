import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { platformInstallations, platformTenants } from "./platform-kernel";

/**
 * Atomic Worker SQL receipts. App-owned SQL effects and this INSERT must
 * commit in the SAME tenant Unit of Work. No automatic role privileges.
 */
export const platformWorkerEffectReceipts = pgTable(
  "platform_worker_effect_receipts",
  {
    installationId: text("installation_id").notNull(),
    applicationId: text("application_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    nonce: text("nonce").notNull(),
    principalId: text("principal_id").notNull(),
    jobType: text("job_type").notNull(),
    schemaRevision: text("schema_revision").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    identity: primaryKey({
      name: "platform_worker_effect_receipts_pk",
      columns: [
        table.installationId,
        table.applicationId,
        table.tenantId,
        table.nonce,
      ],
    }),
    installationFk: foreignKey({
      name: "platform_worker_effect_receipts_installation_fk",
      columns: [table.installationId, table.applicationId],
      foreignColumns: [platformInstallations.id, platformInstallations.applicationId],
    }).onDelete("restrict"),
    tenantFk: foreignKey({
      name: "platform_worker_effect_receipts_tenant_fk",
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [platformTenants.id, platformTenants.applicationId],
    }).onDelete("restrict"),
    tenantIndex: index("platform_worker_effect_receipts_tenant_idx").on(
      table.applicationId,
      table.tenantId,
    ),
    nonceCheck: check(
      "platform_worker_effect_receipts_nonce_check",
      sql`octet_length(${table.nonce}) BETWEEN 1 AND 256`,
    ),
    digestCheck: check(
      "platform_worker_effect_receipts_digest_check",
      sql`${table.payloadDigest} ~ '^[a-f0-9]{64}$'`,
    ),
  }),
);

export type PlatformWorkerEffectReceiptRow =
  typeof platformWorkerEffectReceipts.$inferSelect;
