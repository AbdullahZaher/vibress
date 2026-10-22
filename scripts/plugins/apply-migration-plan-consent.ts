/** Strict, side-effect-free confirmation for an offline operator schema apply. */
import type { ApprovedPluginPhysicalMigration } from "@vibress/plugins";

export function assertOperatorPhysicalMigrationConsent(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  plan: ApprovedPluginPhysicalMigration,
): void {
  if (env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE !== "1" ||
      env.VIBRESS_PLUGIN_SCHEMA_APPLY_ACK !== "1") {
    throw new Error("Quiesced maintenance and explicit operator schema approval are required");
  }
  if (args.length !== 3 ||
      args[1] !== `--confirm-manifest=${plan.manifestId}` ||
      args[2] !== `--confirm-migration-sha256=${plan.migrationSha256}`) {
    throw new Error("Exact manifest and reviewed migration SHA-256 confirmation required");
  }
}
