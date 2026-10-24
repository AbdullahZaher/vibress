import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SDK_VERSION } from "@vibress/plugin-sdk";
import { pluginPhysicalModelDigest, type Plugin } from "@vibress/plugins";
import { TrustedExternalPluginHost, parseTrustedPluginLockfile } from "../trusted-external-plugin-host";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
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
/** A separately pinned, independently built Admin HTML asset. */
async function approvedAdminUiFixture() {
  const f = await fixture();
  const manifestWithUi = {
    ...manifest, capabilities: ["admin.navigation", "extension.routes.admin"],
  };
  const assetPath = path.join(f.dir, "dist", "admin", "courses.html");
  await mkdir(path.dirname(assetPath), { recursive: true });
  const html = '<main lang="ar" dir="rtl"><button type="button">دورات</button></main>';
  await writeFile(assetPath, html, "utf8");
  const lockfileData = {
    schemaVersion: 1,
    plugins: [{
      manifest: manifestWithUi,
      sha256: createHash("sha256").update(await readFile(f.moduleFile)).digest("hex"),
      adminUiAssets: [{
        viewId: "courses", path: "dist/admin/courses.html",
        sha256: createHash("sha256").update(html).digest("hex"),
      }],
    }],
  };
  await writeFile(f.lockfile, JSON.stringify(lockfileData));
  return {
    ...f, html, assetPath, lockfileData,
    installed: plugin({ capabilities: manifestWithUi.capabilities }),
  };
}


function releaseMetadata(hash: string) {
  return {
    schemaVersion: 1,
    releaseId: `${manifest.id}@${manifest.version}:${hash}`,
    publisher: { id: "reviewed-publisher", name: "Reviewed Publisher" },
    compatibility: {
      minVibressApiVersion: SDK_VERSION,
      maxVibressApiVersion: SDK_VERSION,
      sdkAbiVersion: SDK_VERSION,
    },
    capabilities: [...manifest.capabilities],
    sbom: { path: "sbom.json", sha256: "a".repeat(64) },
    provenance: { path: "provenance.json", sha256: "b".repeat(64) },
    migrationPlans: [{ id: "0001_initial", path: "migrations/initial.json",
      sha256: "c".repeat(64) }],
  };
}

describe("TrustedExternalPluginHost", () => {
  it("checks approved bytes without importing the module at registration time", async () => {
    const f = await fixture();
    const { BundledPluginHost } = await import("../plugin-host");
    const host = new BundledPluginHost(new TrustedExternalPluginHost(f.lockfile));
    await expect(host.verifyOperatorRegistration()).resolves.toBeUndefined();
    await writeFile(f.moduleFile, "throw new Error('changed');");
    await expect(host.verifyOperatorRegistration())
      .rejects.toThrow("APPROVED_ARTIFACT_MISMATCH");
  });

  it("preserves bundled-only defaults when opt-in is absent", async () => {
    expect(await new TrustedExternalPluginHost("").loadModule(plugin())).toBeNull();
  });

  it("discovers exact manifest capabilities and truthfully reports signed and unsigned approvals", async () => {
    const f = await fixture();
    const host = new TrustedExternalPluginHost(f.lockfile);
    await expect(host.listTrustedCatalog()).resolves.toEqual([
      { manifest, signatureVerified: false,
        approvalId: expect.stringMatching(/^operator-approved@1\.0\.0:[a-f0-9]{64}$/) },
    ]);
    const initialApprovalId = (await host.listTrustedCatalog())[0]?.approvalId;
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const keyPath = path.join(f.dir, "operator.pub");
    const signaturePath = path.join(f.dir, "operator.sig");
    await writeFile(keyPath, publicKey.export({ format: "pem", type: "spki" }));
    await writeFile(signaturePath,
      sign(null, await readFile(f.lockfile), privateKey).toString("base64") + "\n");
    vi.stubEnv("VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE", keyPath);
    vi.stubEnv("VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE", signaturePath);
    await expect(host.listTrustedCatalog()).resolves.toEqual([
      { manifest, signatureVerified: true, approvalId: initialApprovalId },
    ]);
    await writeFile(f.lockfile, (await readFile(f.lockfile, "utf8")) + " ");
    await expect(host.listTrustedCatalog()).rejects.toThrow(/signature verification failed/);
  });

  it("keeps legacy v1 manifests with nonstandard versions discoverable", async () => {
    const f = await fixture();
    const lock = JSON.parse(await readFile(f.lockfile, "utf8"));
    lock.plugins[0].manifest.version = "operator reviewed build 1";
    await writeFile(f.lockfile, JSON.stringify(lock));
    await expect(new TrustedExternalPluginHost(f.lockfile).listTrustedCatalog())
      .resolves.toEqual([{
        manifest: { ...manifest, version: "operator reviewed build 1" },
        signatureVerified: false,
      }]);
  });

  it("projects a versioned SHA-bound operator release without importing executable code", async () => {
    const f = await fixture();
    const lock = JSON.parse(await readFile(f.lockfile, "utf8"));
    const hash: string = lock.plugins[0].sha256;
    const release = releaseMetadata(hash);
    lock.plugins[0].release = release;
    await writeFile(f.lockfile, JSON.stringify(lock));
    const host = new TrustedExternalPluginHost(f.lockfile);
    await expect(host.listTrustedCatalog()).resolves.toEqual([{
      manifest, signatureVerified: false,
      approvalId: expect.stringMatching(/^operator-approved@1\.0\.0:[a-f0-9]{64}$/),
      release: {
        releaseId: release.releaseId,
        publisher: release.publisher,
        artifactSha256: hash,
        compatibility: release.compatibility,
        hasSbom: true, hasProvenance: true,
        migrationPlanIds: ["0001_initial"],
      },
    }]);
    expect(parseTrustedPluginLockfile(lock).get(manifest.id)?.release?.releaseId)
      .toBe(release.releaseId);
    expect((await host.listTrustedCatalog())[0]?.approvalId).not.toBe(release.releaseId);
  });

  it("invalidates approval identity when reviewed metadata changes but ESM bytes do not", async () => {
    const f = await fixture();
    const host = new TrustedExternalPluginHost(f.lockfile);
    const first = (await host.listTrustedCatalog())[0]?.approvalId;
    const lock = JSON.parse(await readFile(f.lockfile, "utf8"));
    const esmHash = lock.plugins[0].sha256;
    lock.plugins[0].manifest.description = "Operator revised approved metadata";
    await writeFile(f.lockfile, JSON.stringify(lock));
    const second = (await host.listTrustedCatalog())[0]?.approvalId;
    expect(first).toMatch(/^[a-z0-9-]+@1\.0\.0:[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(lock.plugins[0].sha256).toBe(esmHash);
    expect((await host.listTrustedCatalog())[0]?.manifest.description)
      .toBe("Operator revised approved metadata");
  });

  it("rejects substituted release identities, ABI, capabilities and unsafe evidence paths", () => {
    const sha256 = "a".repeat(64);
    const entry = { manifest, sha256, release: releaseMetadata(sha256) };
    const valid = { schemaVersion: 1, plugins: [entry] };
    expect(() => parseTrustedPluginLockfile(valid)).not.toThrow();
    const invalid = [
      { ...entry.release, releaseId: "other@1.0.0:" + sha256 },
      { ...entry.release, compatibility: { ...entry.release.compatibility,
        sdkAbiVersion: "2.0.0" } },
      { ...entry.release, compatibility: { ...entry.release.compatibility,
        maxVibressApiVersion: "2.0.0" } },
      { ...entry.release, capabilities: ["content.write"] },
      { ...entry.release, sbom: { path: "../leak.json", sha256 } },
      { ...entry.release, provenance: { path: "https://site/sbom.json", sha256 } },
      { ...entry.release, migrationPlans: [
        { id: "0001_initial", path: "a.json", sha256 },
        { id: "0001_initial", path: "b.json", sha256 },
      ] },
      { ...entry.release, provenance: { path: "sbom.json", sha256 } },
    ];
    for (const release of invalid) {
      expect(() => parseTrustedPluginLockfile({
        schemaVersion: 1, plugins: [{ ...entry, release }],
      })).toThrow();
    }
  });

  it("loads a pinned operator-controlled ESM module", async () => {
    const f = await fixture();
    const loaded = await new TrustedExternalPluginHost(f.lockfile).loadModule(plugin());
    expect(loaded?.activate).toBeTypeOf("function");
  });

  it("rejects a different signed release before evaluating ESM top-level code", async () => {
    const f = await fixture();
    const hash = createHash("sha256").update(await readFile(f.moduleFile)).digest("hex");
    const admittedKey = JSON.stringify(["p1", manifest.version, manifest.entrypoint, hash]);
    const replacement = "globalThis.__replacedModuleExecuted = true; export default { activate() {} };";
    await writeFile(f.moduleFile, replacement);
    await writeFile(f.lockfile, JSON.stringify({ schemaVersion: 1, plugins: [{
      manifest, sha256: createHash("sha256").update(replacement).digest("hex"),
    }] }));
    try {
      await expect(new TrustedExternalPluginHost(f.lockfile).loadModule(plugin(), admittedKey))
        .rejects.toMatchObject({ code: "PLUGIN_RESTART_REQUIRED" });
      expect((globalThis as { __replacedModuleExecuted?: boolean }).__replacedModuleExecuted)
        .toBeUndefined();
    } finally {
      delete (globalThis as { __replacedModuleExecuted?: boolean }).__replacedModuleExecuted;
    }
  });

  it("loads unchanged signed release bytes with an expected identity", async () => {
    const f = await fixture();
    const hash = createHash("sha256").update(await readFile(f.moduleFile)).digest("hex");
    const key = JSON.stringify(["p1", manifest.version, manifest.entrypoint, hash]);
    expect((await new TrustedExternalPluginHost(f.lockfile).loadModule(plugin(), key))?.activate)
      .toBeTypeOf("function");
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
    await expect(host.loadModule(plugin({ settingsSchema: { token: { type: "string", secret: false } } })))
      .rejects.toThrow(/metadata differs/);
    await expect(host.loadModule(plugin({ name: "spoofed" })))
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

  it("loads only operator-approved model schemas and rejects forged digests/owners", async () => {
    const f = await fixture();
    const columns = [{ name: "title", type: "text", required: true }] as const;
    const model = {
      key: "courses", columns, schemaSha256: pluginPhysicalModelDigest(columns),
    };
    const privilegedManifest = {
      ...manifest, capabilities: [...manifest.capabilities, "extension.storage.read"],
    };
    const approved = { schemaVersion: 1, plugins: [{
      manifest: privilegedManifest, sha256: "a".repeat(64), storageModels: [model],
    }] };
    await writeFile(f.lockfile, JSON.stringify(approved));
    const host = new TrustedExternalPluginHost(f.lockfile);
    const installed = plugin({ capabilities: privilegedManifest.capabilities });
    expect(await host.getApprovedStorageModels(installed)).toEqual([model]);
    expect(await host.getApprovedAudienceReadModels(installed, "public")).toBeNull();
    const originalApproval = (await host.listTrustedCatalog())[0]?.approvalId;
    await writeFile(f.lockfile, JSON.stringify({
      ...approved, plugins: [{ ...approved.plugins[0],
        publicReadModels: ["courses"], memberReadModels: [] }],
    }));
    expect(await host.getApprovedAudienceReadModels(installed, "public")).toEqual(["courses"]);
    expect(await host.getApprovedAudienceReadModels(installed, "member")).toEqual([]);
    // Access rules change without changing ESM: the approval identity must.
    expect((await host.listTrustedCatalog())[0]?.approvalId).not.toBe(originalApproval);
    expect(() => parseTrustedPluginLockfile({
      ...approved, plugins: [{ ...approved.plugins[0], publicReadModels: ["other"] }],
    })).toThrow(/allowlist/);
    expect(() => parseTrustedPluginLockfile({
      ...approved, plugins: [{ ...approved.plugins[0], publicReadModels: ["courses", "courses"] }],
    })).toThrow(/allowlist/);
    const indexed = { ...model, indexedTextFields: ["title"] };
    expect(parseTrustedPluginLockfile({
      ...approved, plugins: [{ ...approved.plugins[0], storageModels: [indexed] }],
    }).get(privilegedManifest.id)?.storageModels).toEqual([indexed]);
    expect(() => parseTrustedPluginLockfile({
      ...approved, plugins: [{ ...approved.plugins[0],
        storageModels: [{ ...model, indexedTextFields: ["missing"] }] }],
    })).toThrow(/index/);
    expect(() => parseTrustedPluginLockfile({
      ...approved, plugins: [{ ...approved.plugins[0],
        storageModels: [{ ...model, indexedTextFields: ["title", "title"] }] }],
    })).toThrow(/index/);
    await expect(host.getApprovedStorageModels(plugin())).rejects.toThrow(/operator-approved storage manifest/);
    expect(() => parseTrustedPluginLockfile({
      ...approved, plugins: [{ ...approved.plugins[0],
        storageModels: [{ ...model, schemaSha256: "b".repeat(64) }] }],
    })).toThrow(/digest/);
    expect(() => parseTrustedPluginLockfile({
      ...approved, plugins: [{ ...approved.plugins[0], storageModels: [model, model] }],
    })).toThrow(/Duplicate approved/);
    expect(() => parseTrustedPluginLockfile({
      ...approved, plugins: [{ ...approved.plugins[0], manifest,
        storageModels: [model] }],
    })).toThrow(/capability/);
    expect(() => parseTrustedPluginLockfile({
      ...approved, plugins: [{ ...approved.plugins[0],
        storageModels: [{ ...model, columns: [{
          name: "publication_id", type: "text", required: true,
        }] }] }],
    })).toThrow();
  });

  it("keeps legacy v1 trusted lockfiles valid without storage approval", async () => {
    const f = await fixture();
    const host = new TrustedExternalPluginHost(f.lockfile);
    expect(await host.getApprovedStorageModels(plugin())).toEqual([]);
    expect(await host.listTrustedManifests()).toHaveLength(1);
  });
});

describe("EXT-301B1 operator-pinned Admin UI asset admission", () => {
  it("keeps all legacy lockfiles valid and returns no asset when not approved", async () => {
    const f = await fixture();
    expect(await new TrustedExternalPluginHost(f.lockfile)
      .readApprovedAdminUiAsset(plugin(), "courses")).toBeNull();
    expect(parseTrustedPluginLockfile({
      schemaVersion: 1,
      plugins: [{ manifest, sha256: "a".repeat(64) }],
    }).get(manifest.id)?.adminUiAssets).toEqual([]);
  });

  it("verifies separately pinned HTML bytes on every read, preserving UTF-8 and RTL", async () => {
    const f = await approvedAdminUiFixture();
    const host = new TrustedExternalPluginHost(f.lockfile);
    expect(await host.readApprovedAdminUiAsset(f.installed, "courses")).toBe(f.html);
    expect(await host.readApprovedAdminUiAsset(f.installed, "missing")).toBeNull();
    await writeFile(f.assetPath, "<h1>modified</h1>");
    await expect(host.readApprovedAdminUiAsset(f.installed, "courses"))
      .rejects.toThrow(/checksum mismatch/);
  });

  it("rejects unexpected plugin metadata and malformed view identifiers", async () => {
    const f = await approvedAdminUiFixture();
    const host = new TrustedExternalPluginHost(f.lockfile);
    await expect(host.readApprovedAdminUiAsset(plugin(), "courses"))
      .rejects.toThrow(/operator-approved Admin UI manifest/);
    await expect(host.readApprovedAdminUiAsset(f.installed, "../courses"))
      .rejects.toThrow(/identifier/);
  });

  it("rejects duplicate IDs, duplicate files, missing capabilities, and unsafe paths", async () => {
    const f = await approvedAdminUiFixture();
    const entry = f.lockfileData.plugins[0]!;
    const asset = entry.adminUiAssets[0]!;
    const parseAssets = (assets: unknown, capabilities = entry.manifest.capabilities) =>
      parseTrustedPluginLockfile({
        schemaVersion: 1,
        plugins: [{ ...entry, manifest: { ...entry.manifest, capabilities }, adminUiAssets: assets }],
      });
    expect(() => parseAssets([asset, asset])).toThrow(/Duplicate/);
    expect(() => parseAssets([asset, { ...asset, viewId: "extra" }])).toThrow(/Duplicate/);
    expect(() => parseAssets([asset], ["events.subscribe"])).toThrow(/capabilities/);
    for (const unsafe of ["../escape.html", "/absolute.html", "https://evil.test/x.html",
      "dir\\\\escape.html", "dist/./x.html", "ui.mjs", "a.html?x=1"]) {
      expect(() => parseAssets([{ ...asset, path: unsafe }])).toThrow();
    }
    expect(() => parseAssets([{ ...asset, sha256: "invalid" }])).toThrow();
    expect(() => parseAssets(Array.from({ length: 9 }, (_, i) => ({
      ...asset, viewId: `item-${i}`, path: `dist/item-${i}.html`,
    })))).toThrow();
  });

  it("rejects symbolic-link targets, directory escapes, and oversized HTML assets", async () => {
    const f = await approvedAdminUiFixture();
    const host = new TrustedExternalPluginHost(f.lockfile);
    const target = path.join(f.dir, "trusted-copy.html");
    await writeFile(target, f.html);
    await rm(f.assetPath);
    await symlink(target, f.assetPath);
    await expect(host.readApprovedAdminUiAsset(f.installed, "courses"))
      .rejects.toThrow(/regular file/);

    await rm(f.assetPath);
    await writeFile(f.assetPath, "x".repeat(256 * 1024 + 1));
    await expect(host.readApprovedAdminUiAsset(f.installed, "courses"))
      .rejects.toThrow(/regular file/);

    const outside = await mkdtemp(path.join(os.tmpdir(), "vibress-external-ui-"));
    dirs.push(outside);
    await writeFile(path.join(outside, "courses.html"), f.html);
    await rm(path.dirname(f.assetPath), { recursive: true });
    await symlink(outside, path.dirname(f.assetPath));
    await expect(host.readApprovedAdminUiAsset(f.installed, "courses"))
      .rejects.toThrow(/escapes/);
  });

  it("rejects binary HTML and opt-in artifacts from symlinked lockfiles", async () => {
    const f = await approvedAdminUiFixture();
    const host = new TrustedExternalPluginHost(f.lockfile);
    const bytes = Buffer.from([0xc3, 0x28]);
    await writeFile(f.assetPath, bytes);
    f.lockfileData.plugins[0]!.adminUiAssets[0]!.sha256 =
      createHash("sha256").update(bytes).digest("hex");
    await writeFile(f.lockfile, JSON.stringify(f.lockfileData));
    await expect(host.readApprovedAdminUiAsset(f.installed, "courses"))
      .rejects.toThrow();
    const symlinked = path.join(f.dir, "linked-lockfile.json");
    await symlink(f.lockfile, symlinked);
    await expect(new TrustedExternalPluginHost(symlinked)
      .readApprovedAdminUiAsset(f.installed, "courses"))
      .rejects.toThrow(/lockfile/);
  });
});
