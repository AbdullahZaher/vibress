/**
 * Read-only disaster-recovery preflight policy.
 *
 * This selector does not inspect files or query the database. It prevents
 * strict operators from accidentally checking a weaker release profile
 * than their API/Worker will accept, while preserving legacy v1 installs.
 */
export interface PluginRestoreAdmissionEnvironment {
  readonly VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY?: string | undefined;
  readonly VIBRESS_TRUSTED_PLUGIN_LOCKFILE?: string | undefined;
  readonly VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE?: string | undefined;
  readonly VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256?: string | undefined;
  readonly VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256?: string | undefined;
  readonly VIBRESS_PLUGIN_RECOVERY_MAINTENANCE?: string | undefined;
}

export type PluginRestoreAdmission =
  | { readonly mode: "bundled-only" }
  | { readonly mode: "legacy"; readonly lockfile: string }
  | {
      readonly mode: "strict";
      readonly lockfile: string;
      readonly expectedLockfileSha256: string;
    };

const SHA256 = /^[a-f0-9]{64}$/;

export function selectPluginRestoreAdmission(
  env: PluginRestoreAdmissionEnvironment,
): PluginRestoreAdmission {
  const policy = env.VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY;
  if (policy !== undefined && policy !== "strict") {
    throw new Error("PLUGIN_RESTORE_ADMISSION_POLICY_INVALID");
  }

  const lockfile = env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE;
  const expectedDigest = env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256;
  const expectedKey = env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256;

  if (policy === "strict") {
    // Keep strict restore checks consistent with the queue recovery tool:
    // normal API/Worker plugin execution must remain disabled throughout DR.
    if (env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE !== "1") {
      throw new Error("PLUGIN_RECOVERY_MAINTENANCE_REQUIRED");
    }
    if (!lockfile || !expectedDigest || !SHA256.test(expectedDigest)) {
      throw new Error("PLUGIN_RESTORE_APPROVAL_REQUIRED");
    }
    if (!expectedKey || !SHA256.test(expectedKey)) {
      throw new Error("PLUGIN_RESTORE_TRUST_ROOT_REQUIRED");
    }
    return { mode: "strict", lockfile, expectedLockfileSha256: expectedDigest };
  }

  // An explicit deployment pin, even outside strict mode, must not silently
  // degrade to a clean "bundled-only" restore result without a release mount.
  if (!lockfile) {
    if (env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE === "1" ||
        expectedDigest !== undefined || expectedKey !== undefined) {
      throw new Error("PLUGIN_RESTORE_APPROVAL_REQUIRED");
    }
    return { mode: "bundled-only" };
  }
  return { mode: "legacy", lockfile };
}
