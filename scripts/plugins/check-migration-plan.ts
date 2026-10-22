/**
 * Operator-only, read-only signed release + physical-model migration preflight.
 * No SQL, activation, schema changes, plugin code imports or network calls.
 * Usage: VIBRESS_TRUSTED_PLUGIN_*=... pnpm exec tsx scripts/plugins/check-migration-plan.ts /absolute/plan.json
 */
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  checkOperatorPluginMigrationPlan,
  parseTrustedPluginLockfile,
  readTrustedPluginLockfile,
  verifyTrustedPluginRelease,
} from "@vibress/plugins";

const MAX_PLAN_BYTES = 64 * 1024;

async function main(): Promise<void> {
  const [planPath, ...extra] = process.argv.slice(2);
  const lockfilePath = process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE;
  if (!planPath || extra.length || !path.isAbsolute(planPath) ||
      !lockfilePath || !path.isAbsolute(lockfilePath) ||
      process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE !== "1" ||
      !process.env.VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE ||
      !process.env.VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE) {
    throw new Error("Signed operator release and absolute migration plan are required");
  }
  const info = await lstat(planPath);
  if (!info.isFile() || info.isSymbolicLink() ||
      info.size === 0 || info.size > MAX_PLAN_BYTES) {
    throw new Error("Invalid bounded operator migration plan file");
  }
  const bytes = await readFile(planPath);
  if (!bytes.byteLength || bytes.byteLength > MAX_PLAN_BYTES) {
    throw new Error("Invalid operator migration plan size");
  }
  const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (utf8.includes("\u0000")) throw new Error("Invalid migration plan text");
  const plan: unknown = JSON.parse(utf8);

  // Reuse the production preflight: verify signature, manifest, hashes,
  // symlink boundaries and the exact final ESM bytes, without executing them.
  const verified = await verifyTrustedPluginRelease(lockfilePath);
  const releases = parseTrustedPluginLockfile(
    await readTrustedPluginLockfile(lockfilePath),
  );
  // Parse the plan with the same production runtime contract before using its
  // manifest ID to select the signed release. No model is admitted by lookup.
  if (!plan || typeof plan !== "object" || Array.isArray(plan) ||
      !("manifestId" in plan) || typeof plan.manifestId !== "string") {
    throw new Error("Invalid operator migration plan");
  }
  const release = releases.get(plan.manifestId);
  if (!release || !verified.some((item) =>
    item.pluginId === release.manifest.id && item.version === release.manifest.version &&
    item.sha256 === release.sha256)) {
    throw new Error("Verified operator plugin release not found");
  }
  const checked = checkOperatorPluginMigrationPlan(plan, release);
  // Identifiers only, never principal IDs, secrets, paths or arbitrary model data.
  console.info(`Migration plan verified for ${checked.manifestId}: ${checked.migrationId} (${checked.models.length} models). No migration applied.`);
}

void main().catch(() => {
  console.error("Plugin migration plan preflight rejected; no changes made");
  process.exitCode = 1;
});
