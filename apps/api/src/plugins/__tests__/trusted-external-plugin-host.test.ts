import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SDK_VERSION } from "@vibress/plugin-sdk";
import type { Plugin } from "@vibress/plugins";
import { TrustedExternalPluginHost, parseTrustedPluginLockfile } from "../trusted-external-plugin-host";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const manifest = {
  id: "operator-approved",
  name: "Approved plugin",
  version: "1.0.0",
  vibressApiVersion: SDK_VERSION,
  entrypoint: "dist/plugin.mjs",
  capabilities: ["events.subscribe"],
  hooks: ["onEvent"],
};
function plugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    id: "p1", manifestId: manifest.id, name: manifest.name,
    version: manifest.version, vibressApiVersion: manifest.vibressApiVersion,
    entrypoint: manifest.entrypoint, description: null,
    capabilities: [...manifest.capabilities], hooks: [...manifest.hooks],
    settingsSchema: {}, status: "registered",
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibress-approved-"));
  dirs.push(dir);
  await mkdir(path.join(dir, "dist"));
  const source = "export default { async activate() {}, async deactivate() {} };\n";
  const moduleFile = path.join(dir, manifest.entrypoint);
  const lockfile = path.join(dir, "trusted.json");
  await writeFile(moduleFile, source);
  const hash = createHash("sha256").update(source).digest("hex");
  await writeFile(lockfile, JSON.stringify({
    schemaVersion: 1, plugins: [{ manifest, sha256: hash }],
  }));
  return { dir, moduleFile, lockfile };
}
describe("TrustedExternalPluginHost", () => {
  it("preserves bundled-only defaults when opt-in is absent", async () => {
    expect(await new TrustedExternalPluginHost("").loadModule(plugin())).toBeNull();
  });

  it("loads a pinned operator-controlled ESM module", async () => {
    const f = await fixture();
    const loaded = await new TrustedExternalPluginHost(f.lockfile).loadModule(plugin());
    expect(loaded?.activate).toBeTypeOf("function");
  });

  it("rejects modified code before evaluating it", async () => {
    const f = await fixture();
    await writeFile(f.moduleFile, "globalThis.__untrusted = true; export default { activate() {} };");
    await expect(new TrustedExternalPluginHost(f.lockfile).loadModule(plugin()))
      .rejects.toThrow(/checksum mismatch/);
    expect((globalThis as { __untrusted?: boolean }).__untrusted).toBeUndefined();
  });

  it("rejects capabilities or versions that differ from operator manifest", async () => {
    const f = await fixture();
    const host = new TrustedExternalPluginHost(f.lockfile);
    await expect(host.loadModule(plugin({ version: "2.0.0" })))
      .rejects.toThrow(/metadata differs/);
    await expect(host.loadModule(plugin({ capabilities: ["events.subscribe", "content.write"] })))
      .rejects.toThrow(/metadata differs/);
  });

  it("rejects duplicate IDs, path traversal and invalid checksums", () => {
    const entry = { manifest, sha256: "a".repeat(64) };
    expect(() => parseTrustedPluginLockfile({ schemaVersion: 1, plugins: [entry, entry] }))
      .toThrow(/Duplicate/);
    expect(() => parseTrustedPluginLockfile({
      schemaVersion: 1,
      plugins: [{ ...entry, manifest: { ...manifest, entrypoint: "../escape.mjs" } }],
    })).toThrow(/entrypoint/);
    expect(() => parseTrustedPluginLockfile({
      schemaVersion: 1,
      plugins: [{ manifest, sha256: "invalid" }],
    })).toThrow();
  });

  it("lists only pinned manifests and rejects a symlinked operator lockfile", async () => {
    const f = await fixture();
    const approved = await new TrustedExternalPluginHost(f.lockfile).listTrustedManifests();
    expect(approved.map((m) => m.id)).toEqual([manifest.id]);
    const linked = path.join(f.dir, "lock-symlink.json");
    await symlink(f.lockfile, linked);
    await expect(new TrustedExternalPluginHost(linked).listTrustedManifests())
      .rejects.toThrow(/lockfile/);
  });

  it("rejects a symlinked module even if its contents match", async () => {
    const f = await fixture();
    const target = path.join(f.dir, "copy.mjs");
    await writeFile(target, "export default { activate() {} };");
    await rm(f.moduleFile);
    await symlink(target, f.moduleFile);
    await expect(new TrustedExternalPluginHost(f.lockfile).loadModule(plugin()))
      .rejects.toThrow(/not a regular approved file/);
  });
});
