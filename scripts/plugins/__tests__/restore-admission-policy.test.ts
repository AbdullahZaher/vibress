import { describe, expect, it } from "vitest";
import { selectPluginRestoreAdmission } from "../restore-admission-policy";

const digest = "a".repeat(64);
const publicKey = "b".repeat(64);
const lockfile = "/srv/vibress/operator/trusted-plugins.json";
const strict = {
  VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY: "strict",
  VIBRESS_PLUGIN_RECOVERY_MAINTENANCE: "1",
  VIBRESS_TRUSTED_PLUGIN_LOCKFILE: lockfile,
  VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256: digest,
  VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256: publicKey,
};

describe("PLUG-OPS-02 restore admission policy", () => {
  it("retains the pre-existing bundled-only and operator lockfile workflows", () => {
    expect(selectPluginRestoreAdmission({})).toEqual({ mode: "bundled-only" });
    expect(selectPluginRestoreAdmission({
      VIBRESS_TRUSTED_PLUGIN_LOCKFILE: lockfile,
    })).toEqual({ mode: "legacy", lockfile });
    expect(selectPluginRestoreAdmission({
      VIBRESS_TRUSTED_PLUGIN_LOCKFILE: lockfile,
      VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE: "1",
    })).toEqual({ mode: "legacy", lockfile });
  });

  it("requires exact pinned signed admission for an opted-in strict restore", () => {
    expect(selectPluginRestoreAdmission(strict)).toEqual({
      mode: "strict", lockfile, expectedLockfileSha256: digest,
    });
  });

  it("fails closed before reading the database without recovery maintenance mode", () => {
    expect(() => selectPluginRestoreAdmission({
      ...strict, VIBRESS_PLUGIN_RECOVERY_MAINTENANCE: undefined,
    })).toThrow("PLUGIN_RECOVERY_MAINTENANCE_REQUIRED");
    expect(() => selectPluginRestoreAdmission({
      ...strict, VIBRESS_PLUGIN_RECOVERY_MAINTENANCE: "0",
    })).toThrow("PLUGIN_RECOVERY_MAINTENANCE_REQUIRED");
  });

  it("rejects missing or malformed lockfile pins in strict mode", () => {
    for (const patch of [
      { VIBRESS_TRUSTED_PLUGIN_LOCKFILE: undefined },
      { VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256: undefined },
      { VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256: "bad" },
      { VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256: "A".repeat(64) },
    ]) {
      expect(() => selectPluginRestoreAdmission({ ...strict, ...patch }))
        .toThrow("PLUGIN_RESTORE_APPROVAL_REQUIRED");
    }
  });

  it("requires an independently configured signer fingerprint in strict mode", () => {
    for (const expected of [undefined, "", "oops", "Z".repeat(64)]) {
      expect(() => selectPluginRestoreAdmission({
        ...strict, VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256: expected,
      })).toThrow("PLUGIN_RESTORE_TRUST_ROOT_REQUIRED");
    }
  });

  it("does not accept unknown admission policies", () => {
    expect(() => selectPluginRestoreAdmission({
      VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY: "permissive",
    })).toThrow("PLUGIN_RESTORE_ADMISSION_POLICY_INVALID");
  });

  it("does not silently downgrade pinned restore configuration without its mount", () => {
    for (const config of [
      { VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE: "1" },
      { VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256: digest },
      { VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256: publicKey },
    ]) {
      expect(() => selectPluginRestoreAdmission(config))
        .toThrow("PLUGIN_RESTORE_APPROVAL_REQUIRED");
    }
  });
});
