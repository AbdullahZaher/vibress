/**
 * EXT-504: OFFLINE OPERATOR ONLY. Applies an independently approved physical
 * model migration through the existing transaction/ledger repository.
 * The separate check-migration-plan.ts remains unconditionally read-only.
 *
 * Quiesce ALL API/Worker replicas, take a verified signed backup, and mount
 * immutable signed operator release bytes before invoking this CLI.
 * Never run this from HTTP, an extension, or a live serving replica.
 */
import { closeDbPool } from "@vibress/database";
import {
  DrizzlePluginStorageMigrationRepository,
  PluginPhysicalSchemaMigrationService,
} from "@vibress/plugins";
import { readVerifiedOperatorMigrationPlan } from "./read-verified-migration-plan";
import { assertOperatorPhysicalMigrationConsent } from "./apply-migration-plan-consent";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Refuse unwanted flags and avoid even a signed filesystem read unless
  // the operator explicitly opted in to a quiesced schema change.
  if (process.env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE !== "1" ||
      process.env.VIBRESS_PLUGIN_SCHEMA_APPLY_ACK !== "1" ||
      args.length !== 3 || !args[0]) {
    throw new Error("Quiesced operator schema-change approval and three arguments required");
  }
  const plan = await readVerifiedOperatorMigrationPlan(args[0]);
  assertOperatorPhysicalMigrationConsent(args, process.env, plan);
  // The repository independently checks registered/inactive lifecycle,
  // installed version, forward-only migration ledger, model ownership, and
  // serializes concurrent attempts with a transaction-scoped advisory lock.
  const service = new PluginPhysicalSchemaMigrationService(
    new DrizzlePluginStorageMigrationRepository(),
  );
  const result = await service.applyApprovedPhysical(plan);
  console.info(`Operator migration ${result}: ${plan.manifestId} ${plan.migrationId}.`);
}

void main().catch(() => {
  // No DB connection URI, private filesystem paths, secrets or payloads.
  console.error("Operator physical schema migration rejected; inspect protected operator logs");
  process.exitCode = 1;
}).finally(async () => {
  await closeDbPool();
});
