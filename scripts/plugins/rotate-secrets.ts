import { closeDbPool } from "@vibress/database";
import { assertPluginSecretRotationReady } from "@vibress/security";
import { rotatePluginSecretRows } from "./rotate-secret-rows";

/**
 * PLUG-OPS-05 operator-only, resumable PostgreSQL ciphertext migration.
 * Default is read-only dry-run; --apply requires explicit maintenance state.
 * NEVER print secret values, ciphertext, tenant IDs, setting keys or errors.
 * A conditional compare-and-swap protects concurrent change/revocation.
 *
 * Must run with normal API + Worker replicas quiesced and a verified backup.
 * This tool does not modify the system's primary VIBRESS_ENCRYPTION_KEY.
 */
async function main(): Promise<void> {
  if (process.env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE !== "1" ||
      process.env.VIBRESS_PLUGIN_SECRET_ROTATION_MAINTENANCE !== "1") {
    throw new Error("PLUGIN_SECRET_ROTATION_MAINTENANCE_REQUIRED");
  }
  assertPluginSecretRotationReady();

  const apply = process.argv.slice(2);
  if (apply.length > 1 || (apply.length === 1 && apply[0] !== "--apply")) {
    throw new Error("PLUGIN_SECRET_ROTATION_ARGUMENT_INVALID");
  }
  const write = apply.length === 1;
  if (write && process.env.VIBRESS_PLUGIN_SECRET_ROTATION_APPLY !== "1") {
    throw new Error("PLUGIN_SECRET_ROTATION_APPROVAL_REQUIRED");
  }

  const rawLimit = process.env.VIBRESS_PLUGIN_SECRET_ROTATION_SCAN_LIMIT ?? "100000";
  if (!/^[1-9][0-9]{0,5}$/.test(rawLimit) || Number(rawLimit) > 100000) {
    throw new Error("PLUGIN_SECRET_ROTATION_SCAN_LIMIT_INVALID");
  }
  const maxRows = Number(rawLimit);
  const result = await rotatePluginSecretRows({ apply: write, maxRows });
  // No tenant IDs, keys or contents in stdout. Retain logs in operator custody.
  console.info("Plugin secret key-version migration", {
    mode: write ? "apply" : "dry-run", ...result,
  });
}

void main().catch(() => {
  console.error("Plugin secret rotation verification failed; retain previous keys and maintenance mode");
  process.exitCode = 1;
}).finally(async () => {
  await closeDbPool();
});
