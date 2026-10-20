import { describe, expect, it, vi } from "vitest";
import {
  PluginStorageMigrationError,
  PluginStorageMigrationService,
  validateApprovedPluginCatalogMigration,
  type ApprovedPluginCatalogMigration,
  type PluginStorageMigrationRepository,
} from "../src/application/plugin-storage-migrations";

const fixture: ApprovedPluginCatalogMigration = {
  manifestId: "vibress-lms",
  migrationId: "0001_courses",
  packageVersion: "0.1.0",
  artifactSha256: "a".repeat(64),
  migrationSha256: "b".repeat(64),
  models: [{ key: "courses", schemaSha256: "c".repeat(64) }],
};

describe("EXT-203A operator-reviewed catalog migration boundary", () => {
  it("rejects bad identifiers, digests, duplicate namespaces and unbounded declarations", async () => {
    const repo: PluginStorageMigrationRepository = {
      applyApproved: vi.fn(async () => "applied" as const),
    };
    const service = new PluginStorageMigrationService(repo);
    const invalid: ApprovedPluginCatalogMigration[] = [
      { ...fixture, manifestId: "../outside" },
      { ...fixture, migrationId: "0001_../outside" },
      { ...fixture, artifactSha256: "not-a-digest" },
      { ...fixture, packageVersion: "   " },
      { ...fixture, packageVersion: "x".repeat(129) },
      { ...fixture, models: [
        fixture.models[0]!, fixture.models[0]!,
      ] },
      { ...fixture, models: [{ key: "courses/subpath", schemaSha256: "a".repeat(64) }] },
      { ...fixture, models: Array.from({ length: 33 }, (_, i) => ({
        key: `model_${i}`, schemaSha256: "a".repeat(64),
      })) },
    ];
    for (const input of invalid) {
      await expect(service.registerApprovedCatalog(input))
        .rejects.toMatchObject({ code: "PLUGIN_MIGRATION_INVALID" });
    }
    // Runtime validation must reject malformed JS callers despite TS types.
    const malformed = { ...fixture };
    Reflect.set(malformed, "packageVersion", 42);
    await expect(service.registerApprovedCatalog(malformed))
      .rejects.toMatchObject({ code: "PLUGIN_MIGRATION_INVALID" });
    Reflect.set(malformed, "packageVersion", fixture.packageVersion);
    Reflect.set(malformed, "artifactSha256", 42);
    await expect(service.registerApprovedCatalog(malformed))
      .rejects.toMatchObject({ code: "PLUGIN_MIGRATION_INVALID" });
    expect(repo.applyApproved).not.toHaveBeenCalled();
    expect(validateApprovedPluginCatalogMigration(fixture)).toBe(fixture);
  });

  it("never executes operator code or SQL itself; delegates only validated catalog data", async () => {
    const repo: PluginStorageMigrationRepository = {
      applyApproved: vi.fn(async () => "applied" as const),
    };
    const service = new PluginStorageMigrationService(repo);
    expect(await service.registerApprovedCatalog(fixture)).toBe("applied");
    expect(repo.applyApproved).toHaveBeenCalledOnce();
    expect(repo.applyApproved).toHaveBeenCalledWith(fixture);
    expect(new PluginStorageMigrationError("PLUGIN_MIGRATION_INVALID", "invalid").code)
      .toBe("PLUGIN_MIGRATION_INVALID");
  });
});
