import { describe, expect, it } from "vitest";
import { pluginPhysicalMigrationDigest, pluginPhysicalModelDigest } from "../src/application/plugin-storage-migrations";
import { checkOperatorPluginMigrationPlan } from "../src/application/operator-migration-plan-preflight";

const oneColumns = [{ name: "course_key", type: "text", required: true }] as const;
const twoColumns = [{ name: "completed_at", type: "timestamptz", required: true }] as const;
const models = [
  { key: "enrollments", columns: oneColumns, schemaSha256: pluginPhysicalModelDigest(oneColumns) },
  { key: "completions", columns: twoColumns, schemaSha256: pluginPhysicalModelDigest(twoColumns) },
];
const approved = {
  manifest: { id: "vibress-lms-pilot", version: "0.1.0-dev.0" },
  sha256: "a".repeat(64),
  storageModels: models,
};
const plan = {
  manifestId: approved.manifest.id,
  migrationId: "0001_lms_pilot",
  packageVersion: approved.manifest.version,
  artifactSha256: approved.sha256,
  migrationSha256: pluginPhysicalMigrationDigest(models),
  models,
};

function rejected(candidate: unknown, release = approved, code?: string) {
  try {
    checkOperatorPluginMigrationPlan(candidate, release);
    throw new Error("Unexpectedly accepted untrusted migration plan");
  } catch (error) {
    expect(error).toMatchObject({ code: code ?? expect.any(String) });
  }
}

describe("signed operator physical-model plan dry run", () => {
  it("accepts matching ordered migration metadata without side effects", () => {
    expect(checkOperatorPluginMigrationPlan(plan, approved)).toMatchObject(plan);
  });
  it("rejects a plan for another plugin or changed version", () => {
    rejected({ ...plan, manifestId: "foreign-plugin" }, approved, "PLUGIN_MIGRATION_RELEASE_MISMATCH");
    rejected({ ...plan, packageVersion: "100.0.0" }, approved, "PLUGIN_MIGRATION_RELEASE_MISMATCH");
  });
  it("rejects artifact substitution and replay for another signed release", () => {
    rejected({ ...plan, artifactSha256: "b".repeat(64) }, approved,
      "PLUGIN_MIGRATION_RELEASE_MISMATCH");
    rejected(plan, { ...approved, sha256: "b".repeat(64) },
      "PLUGIN_MIGRATION_RELEASE_MISMATCH");
  });
  it("rejects unapproved model additions and altered columns", () => {
    const rogue = [{ name: "secret", type: "text", required: false }] as const;
    const extra = { key: "secrets", columns: rogue,
      schemaSha256: pluginPhysicalModelDigest(rogue) };
    const expanded = [...models, extra];
    rejected({ ...plan, models: expanded,
      migrationSha256: pluginPhysicalMigrationDigest(expanded) }, approved,
    "PLUGIN_MIGRATION_RELEASE_MISMATCH");
    const swapped = [models[1]!, models[0]!];
    rejected({ ...plan, models: swapped,
      migrationSha256: pluginPhysicalMigrationDigest(swapped) }, approved,
    "PLUGIN_MIGRATION_RELEASE_MISMATCH");
  });
  it("rejects incorrect physical model digest and migration hash", () => {
    rejected({ ...plan, migrationSha256: "b".repeat(64) }, approved,
      "PLUGIN_MIGRATION_CHECKSUM_CONFLICT");
    rejected({ ...plan, models: [{ ...models[0]!, schemaSha256: "a".repeat(64) }, models[1]] },
      approved, "PLUGIN_MIGRATION_CHECKSUM_CONFLICT");
  });
  it("denies extra fields, malformed identifiers, raw SQL and forged selectors", () => {
    rejected({ ...plan, publicationId: "foreign" }, approved, "PLUGIN_MIGRATION_INVALID");
    rejected({ ...plan, sql: "DROP TABLE members" }, approved, "PLUGIN_MIGRATION_INVALID");
    rejected({ ...plan, models: [{ ...models[0], columns: [
      { name: "member_id", type: "text", required: true, sql: "DROP TABLE members" },
    ] }, models[1]] }, approved, "PLUGIN_MIGRATION_INVALID");
    rejected({ ...plan, migrationId: "../traversal" }, approved, "PLUGIN_MIGRATION_INVALID");
  });
  it("denies missing, huge or unexpected plan shapes", () => {
    rejected(null, approved, "PLUGIN_MIGRATION_INVALID");
    rejected({ ...plan, models: [] }, approved, "PLUGIN_MIGRATION_INVALID");
    rejected({ ...plan, models: Array.from({ length: 17 }, () => models[0]) },
      approved, "PLUGIN_MIGRATION_INVALID");
  });
});
