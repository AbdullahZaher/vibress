/**
 * Operator-only signed migration-plan admission. Shared by read-only preflight
 * and explicit schema-apply commands; neither imports or executes plugin JS.
 */
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  checkOperatorPluginMigrationPlan,
  parseTrustedPluginLockfile,
  readTrustedPluginLockfile,
  verifyTrustedPluginRelease,
  type ApprovedPluginPhysicalMigration,
} from "@vibress/plugins";

const MAX_PLAN_BYTES = 64 * 1024;

export async function readVerifiedOperatorMigrationPlan(
  planPath: string,
  lockfilePath: string | undefined = process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE,
): Promise<ApprovedPluginPhysicalMigration> {
  if (!path.isAbsolute(planPath) || !lockfilePath ||
      !path.isAbsolute(lockfilePath) ||
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

  // Verify ALL final approved bytes using the production preflight. Its
  // signature check is reused; never trust the extension's own checksum.
  const verified = await verifyTrustedPluginRelease(lockfilePath);
  const releases = parseTrustedPluginLockfile(
    await readTrustedPluginLockfile(lockfilePath),
  );
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
  return checkOperatorPluginMigrationPlan(plan, release);
}
