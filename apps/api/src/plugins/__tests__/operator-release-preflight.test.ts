import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyTrustedPluginRelease } from "../operator-release-preflight";

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

  it("rejects tampered bundle and Admin asset bytes", async () => {
    const f = fixture();
    fs.appendFileSync(f.entry, "\n// modified");
    await expect(verifyTrustedPluginRelease(f.lock)).rejects.toThrow("APPROVED_ARTIFACT_MISMATCH");
    const g = fixture();
    fs.appendFileSync(g.asset, "<script>alert(1)</script>");
    await expect(verifyTrustedPluginRelease(g.lock)).rejects.toThrow("APPROVED_ARTIFACT_MISMATCH");
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
