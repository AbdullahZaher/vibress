import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyTrustedPluginRelease } from "../operator-release-preflight";
import { pluginPhysicalMigrationDigest, pluginPhysicalModelDigest } from "@vibress/plugins";

const temporary: string[] = [];
const digest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibress-plugin-preflight-"));
  temporary.push(dir);
  const entry = path.join(dir, "dist", "index.mjs");
  const asset = path.join(dir, "views", "admin.html");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.mkdirSync(path.dirname(asset), { recursive: true });
  // Verifying the release must never execute JavaScript or load it via import().
  const moduleBytes = 'throw new Error("Preflight executed operator bundle");';
  const html = '<main lang="ar" dir="rtl">معتمد</main>';
  fs.writeFileSync(entry, moduleBytes);
  fs.writeFileSync(asset, html);
  const lock = path.join(dir, "trusted-plugins.json");
  const payload = {
    schemaVersion: 1,
    plugins: [{
      manifest: {
        id: "hello-public", name: "Hello Public", version: "1.0.0",
        vibressApiVersion: "1.0.0", entrypoint: "dist/index.mjs",
        capabilities: ["extension.routes.public", "extension.routes.admin", "admin.navigation"],
      },
      sha256: digest(moduleBytes),
      adminUiAssets: [{ viewId: "status", path: "views/admin.html", sha256: digest(html) }],
    }],
  };
  fs.writeFileSync(lock, JSON.stringify(payload));
  return { lock, dir, entry, asset };
}

afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("EXT-404 operator package integrity preflight", () => {
  it("verifies every pinned byte without executing arbitrary Node code", async () => {
    const f = fixture();
    await expect(verifyTrustedPluginRelease(f.lock)).resolves.toEqual([{
      pluginId: "hello-public", version: "1.0.0",
      sha256: digest('throw new Error("Preflight executed operator bundle");'),
      adminViewCount: 1,
    }]);
  });

  it("verifies optional release evidence without evaluating it or changing v1 result", async () => {
    const f = fixture();
    const lock = JSON.parse(fs.readFileSync(f.lock, "utf8"));
    const entry = lock.plugins[0];
    const evidence = {
      sbom: '{"packages":[]}',
      provenance: '{"builder":"local"}',
      plan: "",
    };
    fs.mkdirSync(path.join(f.dir, "migrations"));
    const columns = [{ name: "title", type: "text" as const, required: true }];
    const model = { key: "articles", columns,
      schemaSha256: pluginPhysicalModelDigest(columns) };
    entry.manifest.capabilities.push("extension.storage.read");
    entry.storageModels = [model];
    const migrationPlan = {
      manifestId: entry.manifest.id,
      migrationId: "0001_initial",
      packageVersion: entry.manifest.version,
      artifactSha256: entry.sha256,
      migrationSha256: pluginPhysicalMigrationDigest([model]),
      models: [model],
    };
    evidence.plan = JSON.stringify(migrationPlan);
    fs.writeFileSync(path.join(f.dir, "sbom.json"), evidence.sbom);
    fs.writeFileSync(path.join(f.dir, "provenance.json"), evidence.provenance);
    fs.writeFileSync(path.join(f.dir, "migrations", "plan.json"), evidence.plan);
    entry.release = {
      schemaVersion: 1,
      releaseId: `hello-public@1.0.0:${entry.sha256}`,
      publisher: { id: "reviewed", name: "Publisher" },
      compatibility: {
        minVibressApiVersion: "1.0.0",
        maxVibressApiVersion: "1.0.0",
        sdkAbiVersion: "1.0.0",
      },
      capabilities: entry.manifest.capabilities,
      sbom: { path: "sbom.json", sha256: digest(evidence.sbom) },
      provenance: { path: "provenance.json", sha256: digest(evidence.provenance) },
      migrationPlans: [{
        id: "0001_initial", path: "migrations/plan.json", sha256: digest(evidence.plan),
      }],
    };
    fs.writeFileSync(f.lock, JSON.stringify(lock));
    const expected = [{ pluginId: "hello-public", version: "1.0.0",
      sha256: entry.sha256, adminViewCount: 1 }];
    await expect(verifyTrustedPluginRelease(f.lock)).resolves.toEqual(expected);
    fs.appendFileSync(path.join(f.dir, "sbom.json"), " ");
    await expect(verifyTrustedPluginRelease(f.lock))
      .rejects.toThrow("APPROVED_ARTIFACT_MISMATCH");
    fs.writeFileSync(path.join(f.dir, "sbom.json"), evidence.sbom);
    fs.unlinkSync(path.join(f.dir, "provenance.json"));
    fs.symlinkSync(path.join(f.dir, "sbom.json"), path.join(f.dir, "provenance.json"));
    await expect(verifyTrustedPluginRelease(f.lock))
      .rejects.toThrow("INVALID_APPROVED_ARTIFACT");
    fs.unlinkSync(path.join(f.dir, "provenance.json"));
    fs.writeFileSync(path.join(f.dir, "provenance.json"), evidence.provenance);
    fs.appendFileSync(path.join(f.dir, "migrations", "plan.json"), " ");
    await expect(verifyTrustedPluginRelease(f.lock))
      .rejects.toThrow("APPROVED_ARTIFACT_MISMATCH");
    fs.writeFileSync(path.join(f.dir, "migrations", "plan.json"), evidence.plan);
    const changed = { ...migrationPlan, packageVersion: "2.0.0" };
    fs.writeFileSync(path.join(f.dir, "migrations", "plan.json"), JSON.stringify(changed));
    entry.release.migrationPlans[0].sha256 = digest(JSON.stringify(changed));
    fs.writeFileSync(f.lock, JSON.stringify(lock));
    await expect(verifyTrustedPluginRelease(f.lock))
      .rejects.toMatchObject({ code: "PLUGIN_MIGRATION_RELEASE_MISMATCH" });
    const wrongId = { ...migrationPlan, migrationId: "0002_other" };
    fs.writeFileSync(path.join(f.dir, "migrations", "plan.json"), JSON.stringify(wrongId));
    entry.release.migrationPlans[0].sha256 = digest(JSON.stringify(wrongId));
    fs.writeFileSync(f.lock, JSON.stringify(lock));
    await expect(verifyTrustedPluginRelease(f.lock))
      .rejects.toThrow("PLUGIN_MIGRATION_RELEASE_MISMATCH");
  });

  it("rejects invalid pinned evidence JSON even when the digest matches", async () => {
    const f = fixture();
    const lock = JSON.parse(fs.readFileSync(f.lock, "utf8"));
    const bad = "not-a-json-object";
    fs.writeFileSync(path.join(f.dir, "evidence.json"), bad);
    lock.plugins[0].release = {
      schemaVersion: 1,
      releaseId: `hello-public@1.0.0:${lock.plugins[0].sha256}`,
      publisher: { id: "reviewed", name: "Publisher" },
      compatibility: {
        minVibressApiVersion: "1.0.0",
        maxVibressApiVersion: "1.0.0",
        sdkAbiVersion: "1.0.0",
      },
      capabilities: lock.plugins[0].manifest.capabilities,
      sbom: { path: "evidence.json", sha256: digest(bad) },
    };
    fs.writeFileSync(f.lock, JSON.stringify(lock));
    await expect(verifyTrustedPluginRelease(f.lock)).rejects.toThrow();
    fs.writeFileSync(path.join(f.dir, "evidence.json"), "[]");
    lock.plugins[0].release.sbom.sha256 = digest("[]");
    fs.writeFileSync(f.lock, JSON.stringify(lock));
    await expect(verifyTrustedPluginRelease(f.lock)).rejects.toThrow("INVALID_APPROVED_JSON");
  });

  it("refuses signed metadata with a fabricated security scan result", async () => {
    const f = fixture();
    const lock = JSON.parse(fs.readFileSync(f.lock, "utf8"));
    const entry = lock.plugins[0];
    const report = JSON.stringify({
      schemaVersion: 1, artifactSha256: entry.sha256,
      reviewer: "Security", scanner: "Offline scan",
      scannedAt: "2026-10-24T12:00:00Z",
      criticalFindings: 0, highFindings: 1, decision: "approved",
    });
    fs.writeFileSync(path.join(f.dir, "security-review.json"), report);
    entry.release = {
      schemaVersion: 1, releaseId: `hello-public@1.0.0:${entry.sha256}`,
      publisher: { id: "operator", name: "Operator" },
      compatibility: {
        minVibressApiVersion: "1.0.0", maxVibressApiVersion: "1.0.0",
        sdkAbiVersion: "1.0.0",
      },
      capabilities: entry.manifest.capabilities,
      securityReview: { path: "security-review.json", sha256: digest(report) },
    };
    fs.writeFileSync(f.lock, JSON.stringify(lock));
    await expect(verifyTrustedPluginRelease(f.lock))
      .rejects.toThrow("OPERATOR_SECURITY_REVIEW_REJECTED");
  });

  it("rejects tampered bundle and Admin asset bytes", async () => {
    const f = fixture();
    fs.appendFileSync(f.entry, "\n// modified");
    await expect(verifyTrustedPluginRelease(f.lock)).rejects.toThrow("APPROVED_ARTIFACT_MISMATCH");
    const g = fixture();
    fs.appendFileSync(g.asset, "<script>alert(1)</script>");
    await expect(verifyTrustedPluginRelease(g.lock)).rejects.toThrow("APPROVED_ARTIFACT_MISMATCH");
  });

  it("rejects invalid UTF-8 and NUL HTML even with a matching operator digest", async () => {
    for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from("bad\u0000html")]) {
      const f = fixture();
      fs.writeFileSync(f.asset, bytes);
      const lock = JSON.parse(fs.readFileSync(f.lock, "utf8"));
      lock.plugins[0].adminUiAssets[0].sha256 =
        createHash("sha256").update(bytes).digest("hex");
      fs.writeFileSync(f.lock, JSON.stringify(lock));
      await expect(verifyTrustedPluginRelease(f.lock)).rejects.toThrow();
    }
  });

  it("rejects a changed or overlarge lockfile on read", async () => {
    const f = fixture();
    fs.appendFileSync(f.lock, " ".repeat(129 * 1024));
    await expect(verifyTrustedPluginRelease(f.lock)).rejects.toThrow("INVALID_LOCKFILE");
  });

  it("rejects symlinked operator content even when bytes match", async () => {
    const f = fixture();
    const outside = path.join(f.dir, "elsewhere.html");
    fs.copyFileSync(f.asset, outside);
    fs.unlinkSync(f.asset);
    fs.symlinkSync(outside, f.asset);
    await expect(verifyTrustedPluginRelease(f.lock)).rejects.toThrow("INVALID_APPROVED_ARTIFACT");
  });

  it("rejects invalid lockfile paths and malformed release metadata", async () => {
    await expect(verifyTrustedPluginRelease("relative-lock.json")).rejects.toThrow("INVALID_LOCKFILE_PATH");
    const f = fixture();
    fs.writeFileSync(f.lock, JSON.stringify({ schemaVersion: 1, plugins: [{
      manifest: { id: "../bad" }, sha256: "0".repeat(64),
    }] }));
    await expect(verifyTrustedPluginRelease(f.lock)).rejects.toThrow();
  });
});
