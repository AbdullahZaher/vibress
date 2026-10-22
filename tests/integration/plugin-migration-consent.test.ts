import { describe, expect, it } from "vitest";
import { pluginPhysicalMigrationDigest, pluginPhysicalModelDigest } from "../../packages/domains/plugins/src/application/plugin-storage-migrations";
import { assertOperatorPhysicalMigrationConsent } from "../../scripts/plugins/apply-migration-plan-consent";

const columns = [
  { name: "course_key", type: "text", required: true },
  { name: "state", type: "text", required: true },
] as const;
const model = { key: "enrollments", columns,
  schemaSha256: pluginPhysicalModelDigest(columns) };
const plan = {
  manifestId: "vibress-lms-pilot", migrationId: "0001_lms_pilot",
  packageVersion: "0.1.0-dev.0", artifactSha256: "a".repeat(64),
  models: [model], migrationSha256: pluginPhysicalMigrationDigest([model]),
};
const args = ["/operator/approved-plan.json",
  `--confirm-manifest=${plan.manifestId}`,
  `--confirm-migration-sha256=${plan.migrationSha256}`];
const approved = { VIBRESS_PLUGIN_RECOVERY_MAINTENANCE: "1",
  VIBRESS_PLUGIN_SCHEMA_APPLY_ACK: "1" };

describe("offline-only operator physical schema admission", () => {
  it("admits only exact operator maintenance+plan confirmations", () => {
    expect(() => assertOperatorPhysicalMigrationConsent(args, approved, plan)).not.toThrow();
  });
  it("rejects a missing maintenance flag or explicit approval", () => {
    for (const env of [{},
      { VIBRESS_PLUGIN_RECOVERY_MAINTENANCE: "1" },
      { VIBRESS_PLUGIN_SCHEMA_APPLY_ACK: "1" },
      { ...approved, VIBRESS_PLUGIN_SCHEMA_APPLY_ACK: "yes" }]) {
      expect(() => assertOperatorPhysicalMigrationConsent(args, env, plan)).toThrow();
    }
  });
  it("rejects incorrect manifest, migration digest and extra arguments", () => {
    for (const candidate of [
      args.slice(0, 2),
      [...args, "--force"],
      [args[0]!, "--confirm-manifest=other-plugin", args[2]!],
      [args[0]!, args[1]!, `--confirm-migration-sha256=${"b".repeat(64)}`],
      [args[0]!, args[2]!, args[1]!],
    ]) {
      expect(() => assertOperatorPhysicalMigrationConsent(candidate, approved, plan)).toThrow();
    }
  });
  it("rejects an apparently valid command for a changed migration", () => {
    const modified = { ...plan, migrationSha256: "b".repeat(64) };
    expect(() => assertOperatorPhysicalMigrationConsent(args, approved, modified)).toThrow();
    expect(() => assertOperatorPhysicalMigrationConsent(args,
      approved, { ...plan, manifestId: "another-plugin" })).toThrow();
  });
});
