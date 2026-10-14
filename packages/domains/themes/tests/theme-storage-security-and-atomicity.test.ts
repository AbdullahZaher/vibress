import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import dns from "node:dns";
import {
  StorageProvider,
  StorageCapabilities,
  PutObjectInput,
  StoredObject,
} from "@vibress/storage-core";
import {
  StorageProviderThemeStorageAdapter,
  FileSystemThemeStorageAdapter,
  validateStorageThemeId,
  validateStorageVersion,
  validateStoragePublicationId,
  validateThemeRelativePath,
  isSafeSignedUrl,
  isPrivateOrRestrictedIP,
  isTrustedStorageDestination,
  fetchSignedUrlSafely,
} from "../src";

class DeterministicFailingStorageProvider implements StorageProvider {
  readonly name = "s3";
  readonly objects = new Map<string, Buffer>();
  public failOnPutKeys = new Set<string>();
  public failOnPutPattern?: RegExp;
  public failAfterNthPut?: number;
  public failOnDeleteKeys = new Set<string>();
  public failOnGetBufferKeys = new Set<string>();
  public failOnExistsKeys = new Set<string>();
  public onGetBufferHook?: (key: string) => Promise<void> | void;
  public putCount = 0;

  getCapabilities(): StorageCapabilities {
    return {
      signedUrls: true,
      directUpload: true,
      multipartUpload: true,
      privateObjects: true,
      publicObjects: true,
    };
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    this.putCount++;
    if (this.failOnPutKeys.has(input.key)) {
      throw new Error(`Simulated write failure for key: ${input.key}`);
    }
    if (this.failOnPutPattern && this.failOnPutPattern.test(input.key)) {
      throw new Error(`Simulated write pattern failure for key: ${input.key}`);
    }
    if (this.failAfterNthPut && this.putCount >= this.failAfterNthPut) {
      throw new Error(`Simulated write failure after ${this.putCount} puts`);
    }
    const body = Buffer.from(input.body);
    this.objects.set(input.key, body);
    return { key: input.key, url: `fake://${input.key}`, size: body.length };
  }

  async delete(key: string): Promise<void> {
    if (this.failOnDeleteKeys.has(key)) {
      throw new Error(`Simulated delete failure for key: ${key}`);
    }
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    if (this.failOnExistsKeys.has(key)) {
      throw new Error(`Simulated exists failure for key: ${key}`);
    }
    return this.objects.has(key);
  }

  async getUrl(key: string): Promise<string> {
    return `fake://${key}`;
  }

  async getObjectBuffer(key: string): Promise<Buffer | null> {
    if (this.failOnGetBufferKeys.has(key)) {
      throw new Error(`Simulated read failure for key: ${key}`);
    }
    if (this.onGetBufferHook) {
      await this.onGetBufferHook(key);
    }
    return this.objects.get(key) ?? null;
  }
}

describe("PRIORITY 0: Theme Storage Security & Path Traversal Protections", () => {
  let tmpDir: string;
  let fsAdapter: FileSystemThemeStorageAdapter;
  let cloudProvider: DeterministicFailingStorageProvider;
  let cloudAdapter: StorageProviderThemeStorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "theme-sec-test-"));
    fsAdapter = new FileSystemThemeStorageAdapter({ storageRoot: tmpDir });
    cloudProvider = new DeterministicFailingStorageProvider();
    cloudAdapter = new StorageProviderThemeStorageAdapter(cloudProvider);
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  describe("Validation functions", () => {
    it("rejects invalid theme IDs", () => {
      const invalid = ["..", ".", "../etc", "my theme", "UPPERCASE", "special@theme", ""];
      for (const id of invalid) {
        expect(() => validateStorageThemeId(id)).toThrow();
      }
      expect(validateStorageThemeId("valid-theme-123")).toBe("valid-theme-123");
    });

    it("rejects invalid theme versions", () => {
      const invalid = ["..", ".", "1..0", "1.0.", "alpha", "1.0.0/../", ""];
      for (const v of invalid) {
        expect(() => validateStorageVersion(v)).toThrow();
      }
      expect(validateStorageVersion("1.0.0")).toBe("1.0.0");
      expect(validateStorageVersion("2.1.0-beta.1")).toBe("2.1.0-beta.1");
    });

    it("rejects invalid publication IDs", () => {
      const invalid = ["..", ".", "pub/../other", "pub with spaces", ""];
      for (const p of invalid) {
        expect(() => validateStoragePublicationId(p)).toThrow();
      }
      expect(validateStoragePublicationId("pub_default")).toBe("pub_default");
      expect(validateStoragePublicationId("pub_alpha_123")).toBe("pub_alpha_123");
    });

    it("rejects traversal and reserved relative paths", () => {
      const invalid = [
        "../escaped.txt",
        "../../etc/passwd",
        "assets/../../escaped.txt",
        "..\\escaped.txt",
        "assets\\..\\escaped.txt",
        "/absolute/path.txt",
        "C:\\windows\\win.ini",
        "assets//double-slash.css",
        "assets/./current.css",
        "assets/%2e%2e/encoded.css",
        "assets/\0nullbyte.css",
        "__files.json",
        "assets/__files.json",
        "__package.json",
        "__vibress_internal.json",
      ];
      for (const p of invalid) {
        expect(() => validateThemeRelativePath(p)).toThrow();
      }
      expect(validateThemeRelativePath("theme.json")).toBe("theme.json");
      expect(validateThemeRelativePath("assets/css/screen.css")).toBe("assets/css/screen.css");
      expect(validateThemeRelativePath("templates/post.liquid")).toBe("templates/post.liquid");
    });
  });

  describe("FileSystem adapter path containment", () => {
    it("rejects writes with path traversal and preserves existing package", async () => {
      await fsAdapter.saveThemeFiles(
        "my-theme",
        "1.0.0",
        new Map([["theme.json", Buffer.from('{"name":"good"}')]]),
        "pub_alpha",
      );

      const maliciousPaths = [
        "../escaped.txt",
        "../../outside.txt",
        "..\\backslash.txt",
        "/absolute.txt",
        "__files.json",
      ];

      for (const badPath of maliciousPaths) {
        await expect(
          fsAdapter.saveThemeFiles(
            "my-theme",
            "1.0.0",
            new Map([[badPath, Buffer.from("evil")]]),
            "pub_alpha",
          ),
        ).rejects.toThrow("Invalid theme file path");
      }

      // Existing valid package remained 100% intact
      const existing = await fsAdapter.getThemeFile("my-theme", "1.0.0", "theme.json", "pub_alpha");
      expect(existing?.toString("utf-8")).toBe('{"name":"good"}');
    });

    it("returns null for getThemeFile when path traversal or reserved files are requested", async () => {
      await fsAdapter.saveThemeFiles(
        "my-theme",
        "1.0.0",
        new Map([["theme.json", Buffer.from('{"name":"good"}')]]),
        "pub_alpha",
      );

      expect(await fsAdapter.getThemeFile("my-theme", "1.0.0", "../escaped.txt", "pub_alpha")).toBeNull();
      expect(await fsAdapter.getThemeFile("my-theme", "1.0.0", "../../etc/passwd", "pub_alpha")).toBeNull();
      expect(await fsAdapter.getThemeFile("my-theme", "1.0.0", "__files.json", "pub_alpha")).toBeNull();
    });

    it("rejects version-based traversal escape in getThemeRootPath", () => {
      expect(() => fsAdapter.getThemeRootPath("my-theme", "..", "pub_alpha")).toThrow();
      expect(() => fsAdapter.getThemeRootPath("..", "1.0.0", "pub_alpha")).toThrow();
      expect(() => fsAdapter.getThemeRootPath("my-theme", "1.0.0", "..")).toThrow();
    });
  });

  describe("Cloud adapter path containment and isolation", () => {
    it("rejects writes with path traversal and protects neighboring packages", async () => {
      await cloudAdapter.saveThemeFiles(
        "target-theme",
        "1.0.0",
        new Map([["theme.json", Buffer.from('{"name":"target"}')]]),
        "pub_alpha",
      );

      const maliciousPaths = [
        "../escaped.txt",
        "../../publications/pub_beta/evil.txt",
        "..\\escaped.txt",
        "/root.txt",
        "__files.json",
      ];

      for (const badPath of maliciousPaths) {
        await expect(
          cloudAdapter.saveThemeFiles(
            "target-theme",
            "1.0.0",
            new Map([[badPath, Buffer.from("evil")]]),
            "pub_alpha",
          ),
        ).rejects.toThrow("Invalid theme file path");
      }

      // Target theme is untouched
      const valid = await cloudAdapter.getThemeFile("target-theme", "1.0.0", "theme.json", "pub_alpha");
      expect(valid?.toString("utf-8")).toBe('{"name":"target"}');
    });

    it("returns null on getThemeFile with path traversal or reserved names", async () => {
      await cloudAdapter.saveThemeFiles(
        "target-theme",
        "1.0.0",
        new Map([["theme.json", Buffer.from('{"name":"target"}')]]),
        "pub_alpha",
      );

      expect(await cloudAdapter.getThemeFile("target-theme", "1.0.0", "../escaped.txt", "pub_alpha")).toBeNull();
      expect(await cloudAdapter.getThemeFile("target-theme", "1.0.0", "__files.json", "pub_alpha")).toBeNull();
      expect(await cloudAdapter.getThemeFile("target-theme", "1.0.0", "templates/../../pub_beta/file.txt", "pub_alpha")).toBeNull();
    });

    it("strictly isolates files across different publications", async () => {
      await cloudAdapter.saveThemeFiles(
        "shared-name",
        "1.0.0",
        new Map([
          ["theme.json", Buffer.from("alpha-theme")],
          ["assets/secret.txt", Buffer.from("alpha-secret")],
        ]),
        "pub_alpha",
      );

      await cloudAdapter.saveThemeFiles(
        "shared-name",
        "1.0.0",
        new Map([
          ["theme.json", Buffer.from("beta-theme")],
          ["assets/secret.txt", Buffer.from("beta-secret")],
        ]),
        "pub_beta",
      );

      const alphaSecret = await cloudAdapter.getThemeFile("shared-name", "1.0.0", "assets/secret.txt", "pub_alpha");
      const betaSecret = await cloudAdapter.getThemeFile("shared-name", "1.0.0", "assets/secret.txt", "pub_beta");

      expect(alphaSecret?.toString("utf-8")).toBe("alpha-secret");
      expect(betaSecret?.toString("utf-8")).toBe("beta-secret");

      // Deleting Beta's package does NOT touch Alpha's package
      await cloudAdapter.deleteThemeFiles("shared-name", "1.0.0", "pub_beta");
      expect(await cloudAdapter.themeExists("shared-name", "1.0.0", "pub_beta")).toBe(false);
      expect(await cloudAdapter.themeExists("shared-name", "1.0.0", "pub_alpha")).toBe(true);
      expect((await cloudAdapter.getThemeFile("shared-name", "1.0.0", "assets/secret.txt", "pub_alpha"))?.toString("utf-8")).toBe("alpha-secret");
    });
  });
});

describe("PRIORITY 0: Cloud Theme Package Atomicity Under Failure Injection", () => {
  let provider: DeterministicFailingStorageProvider;
  let adapter: StorageProviderThemeStorageAdapter;

  const initialFiles = new Map<string, Buffer>([
    ["theme.json", Buffer.from('{"version":"v1","name":"initial"}')],
    ["assets/style.css", Buffer.from("body { color: blue; }")],
    ["templates/home.liquid", Buffer.from("<h1>Initial</h1>")],
  ]);

  const replacementFiles = new Map<string, Buffer>([
    ["theme.json", Buffer.from('{"version":"v2","name":"replaced"}')],
    ["assets/style.css", Buffer.from("body { color: red; }")],
    ["templates/home.liquid", Buffer.from("<h1>Replaced</h1>")],
  ]);

  beforeEach(async () => {
    provider = new DeterministicFailingStorageProvider();
    adapter = new StorageProviderThemeStorageAdapter(provider);

    // Seed initial usable package
    await adapter.saveThemeFiles("sample-theme", "1.0.0", initialFiles, "pub_alpha");
    expect(await adapter.themeExists("sample-theme", "1.0.0", "pub_alpha")).toBe(true);
  });

  it("Scenario 1: First file upload fails -> previously installed package remains intact", async () => {
    // Fail immediately on the first file put of replacement
    provider.failAfterNthPut = provider.putCount + 1;

    await expect(
      adapter.saveThemeFiles("sample-theme", "1.0.0", replacementFiles, "pub_alpha"),
    ).rejects.toThrow();

    // Previous package remains completely intact and valid
    const themeJson = await adapter.getThemeFile("sample-theme", "1.0.0", "theme.json", "pub_alpha");
    expect(themeJson?.toString("utf-8")).toBe('{"version":"v1","name":"initial"}');

    const style = await adapter.getThemeFile("sample-theme", "1.0.0", "assets/style.css", "pub_alpha");
    expect(style?.toString("utf-8")).toBe("body { color: blue; }");
  });

  it("Scenario 2: Middle file upload fails -> staged files are cleaned up and previous package intact", async () => {
    // Let 1st file succeed, fail on 2nd file
    provider.failAfterNthPut = provider.putCount + 2;

    await expect(
      adapter.saveThemeFiles("sample-theme", "1.0.0", replacementFiles, "pub_alpha"),
    ).rejects.toThrow();

    // Previous package is intact
    const themeJson = await adapter.getThemeFile("sample-theme", "1.0.0", "theme.json", "pub_alpha");
    expect(themeJson?.toString("utf-8")).toBe('{"version":"v1","name":"initial"}');
    expect((await adapter.getThemeFile("sample-theme", "1.0.0", "templates/home.liquid", "pub_alpha"))?.toString("utf-8")).toBe("<h1>Initial</h1>");
  });

  it("Scenario 3: Final file upload fails -> previous package intact", async () => {
    // Let 1st and 2nd files succeed, fail on 3rd file
    provider.failAfterNthPut = provider.putCount + 3;

    await expect(
      adapter.saveThemeFiles("sample-theme", "1.0.0", replacementFiles, "pub_alpha"),
    ).rejects.toThrow();

    const themeJson = await adapter.getThemeFile("sample-theme", "1.0.0", "theme.json", "pub_alpha");
    expect(themeJson?.toString("utf-8")).toBe('{"version":"v1","name":"initial"}');
  });

  it("Scenario 4: Manifest publication fails -> previous package intact and staged files discarded", async () => {
    // Fail specifically when writing __files.json
    provider.failOnPutPattern = /__files\.json$/;

    await expect(
      adapter.saveThemeFiles("sample-theme", "1.0.0", replacementFiles, "pub_alpha"),
    ).rejects.toThrow("Simulated write pattern failure");

    // Readers still read through previous manifest and receive v1 contents
    const themeJson = await adapter.getThemeFile("sample-theme", "1.0.0", "theme.json", "pub_alpha");
    expect(themeJson?.toString("utf-8")).toBe('{"version":"v1","name":"initial"}');
  });

  it("Scenario 5: Old-file cleanup fails -> newly installed package remains authoritative and active", async () => {
    // 1. Initial package (Gen 1) was seeded in beforeEach.
    // 2. Install Gen 2 (v2). Gen 1 is retained as previousGeneration to protect in-flight readers.
    await adapter.saveThemeFiles("sample-theme", "1.0.0", replacementFiles, "pub_alpha");

    // Hook delete to fail when cleaning up old objects
    const origDelete = provider.delete.bind(provider);
    let deleteAttempted = false;
    provider.delete = async (key: string) => {
      if (key.includes("generations") && !key.endsWith("__files.json")) {
        deleteAttempted = true;
        throw new Error("Simulated S3 delete timeout/error");
      }
      return origDelete(key);
    };

    // 3. Install Gen 3 (v3). Gen 1 is older than previousGeneration (Gen 2), so it is pruned.
    // Prune triggers provider.delete, which fails with simulated S3 error.
    const v3Files = new Map<string, Buffer>([
      ["theme.json", Buffer.from('{"version":"v3","name":"v3-theme"}')],
      ["assets/style.css", Buffer.from("body { color: green; }")],
    ]);

    const root = await adapter.saveThemeFiles("sample-theme", "1.0.0", v3Files, "pub_alpha");
    expect(root).toBeDefined();
    expect(deleteAttempted).toBe(true);

    // Active package is the new v3 package despite cleanup failure of Gen 1
    const themeJson = await adapter.getThemeFile("sample-theme", "1.0.0", "theme.json", "pub_alpha");
    expect(themeJson?.toString("utf-8")).toBe('{"version":"v3","name":"v3-theme"}');
  });

  it("Scenario 6 & 7: Concurrent replacements maintain integrity without interleaving contents", async () => {
    const candidateA = new Map<string, Buffer>([
      ["theme.json", Buffer.from('{"candidate":"A"}')],
      ["assets/style.css", Buffer.from("/* Candidate A */")],
    ]);
    const candidateB = new Map<string, Buffer>([
      ["theme.json", Buffer.from('{"candidate":"B"}')],
      ["assets/style.css", Buffer.from("/* Candidate B */")],
    ]);

    // Run both replacements concurrently
    await Promise.all([
      adapter.saveThemeFiles("sample-theme", "1.0.0", candidateA, "pub_alpha"),
      adapter.saveThemeFiles("sample-theme", "1.0.0", candidateB, "pub_alpha"),
    ]);

    // The winning package must be completely consistent: either all of A or all of B
    const themeJson = (await adapter.getThemeFile("sample-theme", "1.0.0", "theme.json", "pub_alpha"))?.toString("utf-8");
    const style = (await adapter.getThemeFile("sample-theme", "1.0.0", "assets/style.css", "pub_alpha"))?.toString("utf-8");

    if (themeJson?.includes('"candidate":"A"')) {
      expect(style).toBe("/* Candidate A */");
    } else {
      expect(themeJson).toContain('"candidate":"B"');
      expect(style).toBe("/* Candidate B */");
    }
  });

  it("Scenario 8: Retry behavior is safe and idempotent", async () => {
    // First attempt fails at manifest update
    provider.failOnPutPattern = /__files\.json$/;
    await expect(
      adapter.saveThemeFiles("sample-theme", "1.0.0", replacementFiles, "pub_alpha"),
    ).rejects.toThrow();

    // Now remove failure condition and retry installation
    provider.failOnPutPattern = undefined;
    await adapter.saveThemeFiles("sample-theme", "1.0.0", replacementFiles, "pub_alpha");

    // Package is updated cleanly
    const themeJson = await adapter.getThemeFile("sample-theme", "1.0.0", "theme.json", "pub_alpha");
    expect(themeJson?.toString("utf-8")).toBe('{"version":"v2","name":"replaced"}');
  });

  it("Scenario 11 & 12: Backward compatibility with legacy v1 flat package manifest", async () => {
    // Simulate a legacy package written with v1 flat format:
    // __files.json is a plain string array, and files are at root level
    const legacyThemeId = "legacy-v1-theme";
    const legacyVersion = "1.0.0";
    const root = adapter.getThemeRootPath(legacyThemeId, legacyVersion, "pub_alpha");

    await provider.put({
      key: `${root}/theme.json`,
      body: Buffer.from('{"name":"legacy-v1"}'),
      contentType: "application/json",
    });
    await provider.put({
      key: `${root}/assets/legacy.css`,
      body: Buffer.from("/* legacy */"),
      contentType: "text/css",
    });
    await provider.put({
      key: `${root}/__files.json`,
      body: Buffer.from(JSON.stringify(["theme.json", "assets/legacy.css"])),
      contentType: "application/json",
    });

    // Adapter reads legacy v1 packages transparently
    expect(await adapter.themeExists(legacyThemeId, legacyVersion, "pub_alpha")).toBe(true);
    const files = await adapter.listThemeFiles(legacyThemeId, legacyVersion, "pub_alpha");
    expect(files).toEqual(["assets/legacy.css", "theme.json"]);

    const themeJson = await adapter.getThemeFile(legacyThemeId, legacyVersion, "theme.json", "pub_alpha");
    expect(themeJson?.toString("utf-8")).toBe('{"name":"legacy-v1"}');

    // Upgrading/replacing the legacy package migrates it to v2 generation layout
    await adapter.saveThemeFiles(
      legacyThemeId,
      legacyVersion,
      new Map([["theme.json", Buffer.from('{"name":"upgraded-v2"}')]]),
      "pub_alpha",
    );

    const upgradedJson = await adapter.getThemeFile(legacyThemeId, legacyVersion, "theme.json", "pub_alpha");
    expect(upgradedJson?.toString("utf-8")).toBe('{"name":"upgraded-v2"}');
    // Stale legacy asset is no longer accessible
    expect(await adapter.getThemeFile(legacyThemeId, legacyVersion, "assets/legacy.css", "pub_alpha")).toBeNull();
  });

  it("Scenario 9: Ambiguous manifest write timeout after successful S3 commit preserves package", async () => {
    // Simulate S3 committing the manifest object, but the client throwing a timeout error
    const ambiguousThemeId = "ambiguous-write-theme";
    const testFiles = new Map([
      ["theme.json", Buffer.from('{"name":"ambiguous-write-success"}')],
    ]);

    // Custom put that writes the object, but then throws an Error
    const originalPut = provider.put.bind(provider);
    provider.put = async (input) => {
      await originalPut(input);
      if (input.key.endsWith("__files.json")) {
        throw new Error("Client network timeout after TCP socket drop");
      }
      return {
        key: input.key,
        size: input.body.length,
        etag: "etag",
        lastModified: new Date(),
        contentType: input.contentType,
      };
    };

    // The method should detect that the manifest successfully committed and NOT destroy the staged files!
    await adapter.saveThemeFiles(ambiguousThemeId, "1.0.0", testFiles, "pub_alpha");

    // Restore original put
    provider.put = originalPut;

    // Verify package is active and readable
    const themeJson = await adapter.getThemeFile(ambiguousThemeId, "1.0.0", "theme.json", "pub_alpha");
    expect(themeJson?.toString("utf-8")).toBe('{"name":"ambiguous-write-success"}');
  });

  it("Ambiguous write recovery failure: Preserves staged files when recovery read also fails", async () => {
    const ambiguousThemeId = "ambiguous-recovery-fail";
    const testFiles = new Map([
      ["theme.json", Buffer.from('{"name":"staged-preserved"}')],
    ]);

    // When writing __files.json, fail the put AND disable exists/reading to simulate complete network partition
    const originalPut = provider.put.bind(provider);
    const originalExists = provider.exists.bind(provider);
    let stagedKeysRecorded: string[] = [];
    let manifestPutFailed = false;

    provider.put = async (input) => {
      if (input.key.endsWith("__files.json")) {
        // Find the staged keys that were written before the manifest
        stagedKeysRecorded = Array.from(provider.objects.keys()).filter((k) =>
          k.includes("ambiguous-recovery-fail") && !k.endsWith("__files.json"),
        );
        manifestPutFailed = true;
        throw new Error("Simulated TCP reset during manifest PUT");
      }
      return originalPut(input);
    };

    // Simulate network error during recovery read
    provider.exists = async (key: string) => {
      if (manifestPutFailed && key.includes("ambiguous-recovery-fail") && key.endsWith("__files.json")) {
        throw new Error("Simulated DNS timeout during recovery read");
      }
      return originalExists(key);
    };

    // Must re-throw error because commit status could not be verified
    await expect(
      adapter.saveThemeFiles(ambiguousThemeId, "1.0.0", testFiles, "pub_alpha"),
    ).rejects.toThrow("Simulated TCP reset during manifest PUT");

    // Restore provider methods
    provider.put = originalPut;
    provider.exists = originalExists;

    // DATA PRESERVATION: The staged files must NOT have been deleted!
    expect(stagedKeysRecorded.length).toBeGreaterThan(0);
    for (const key of stagedKeysRecorded) {
      expect(provider.objects.has(key)).toBe(true);
    }
  });

  it("Deferred generation retention: Readers can access files from previousGeneration while active package is newest generation", async () => {
    const retainThemeId = "deferred-retention-theme";
    const gen1Files = new Map([
      ["theme.json", Buffer.from('{"gen":"1"}')],
      ["assets/style.css", Buffer.from("/* gen 1 */")],
    ]);
    const gen2Files = new Map([
      ["theme.json", Buffer.from('{"gen":"2"}')],
      ["assets/style.css", Buffer.from("/* gen 2 */")],
    ]);

    // 1. Install Generation 1
    await adapter.saveThemeFiles(retainThemeId, "1.0.0", gen1Files, "pub_alpha");
    const manifestBuf1 = provider.objects.get(`themes/publications/pub_alpha/${retainThemeId}/1.0.0/__files.json`);
    expect(manifestBuf1).toBeDefined();
    const manifest1 = JSON.parse(manifestBuf1!.toString("utf-8"));
    const gen1Id = manifest1.generation;
    expect(gen1Id).toBeDefined();

    // 2. Install Generation 2
    await adapter.saveThemeFiles(retainThemeId, "1.0.0", gen2Files, "pub_alpha");
    const manifestBuf2 = provider.objects.get(`themes/publications/pub_alpha/${retainThemeId}/1.0.0/__files.json`);
    const manifest2 = JSON.parse(manifestBuf2!.toString("utf-8"));
    expect(manifest2.generation).not.toBe(gen1Id);
    expect(manifest2.previousGeneration).toBe(gen1Id);

    // 3. Generation 1 files are STILL in storage (deferred retention)
    const gen1FileKey = `themes/publications/pub_alpha/${retainThemeId}/1.0.0/generations/${gen1Id}/assets/style.css`;
    expect(provider.objects.has(gen1FileKey)).toBe(true);

    // 4. In-flight reader who resolved gen1Id can read it directly
    const inFlightStyle = await adapter.getThemeFile(retainThemeId, "1.0.0", "assets/style.css", "pub_alpha", false, gen1Id);
    expect(inFlightStyle?.toString("utf-8")).toBe("/* gen 1 */");

    // 5. Active reader reads the latest Generation 2
    const activeStyle = await adapter.getThemeFile(retainThemeId, "1.0.0", "assets/style.css", "pub_alpha");
    expect(activeStyle?.toString("utf-8")).toBe("/* gen 2 */");

    // 6. Install Generation 3
    const gen3Files = new Map([
      ["theme.json", Buffer.from('{"gen":"3"}')],
      ["assets/style.css", Buffer.from("/* gen 3 */")],
    ]);
    await adapter.saveThemeFiles(retainThemeId, "1.0.0", gen3Files, "pub_alpha");

    // Now Generation 1 (older than previousGeneration) IS pruned from storage
    expect(provider.objects.has(gen1FileKey)).toBe(false);

    // But Generation 2 is now retained as previousGeneration
    const gen2Id = manifest2.generation;
    const gen2FileKey = `themes/publications/pub_alpha/${retainThemeId}/1.0.0/generations/${gen2Id}/assets/style.css`;
    expect(provider.objects.has(gen2FileKey)).toBe(true);

    // And deleteThemeFiles removes both active Generation 3 and retained Generation 2
    await adapter.deleteThemeFiles(retainThemeId, "1.0.0", "pub_alpha");
    expect(provider.objects.has(gen2FileKey)).toBe(false);
  });

  it("SSRF Protection: Rejects signed URLs pointing to cloud metadata (169.254.169.254) or private networks", async () => {
    // Create a provider without getObjectBuffer that returns SSRF signed URLs
    const ssrfProvider: StorageProvider = {
      name: "s3",
      getCapabilities() {
        return {
          signedUrls: true,
          directUpload: true,
          multipartUpload: true,
          privateObjects: true,
          publicObjects: true,
        };
      },
      async put() { return { key: "k", url: "fake://k", size: 0, etag: "e" }; },
      async getUrl(key: string) { return `http://169.254.169.254/latest/meta-data/${key}`; },
      async getSignedUrl(key: string) {
        if (key.includes("metadata")) {
          return "http://169.254.169.254/latest/meta-data/";
        }
        if (key.includes("internal")) {
          return "http://10.0.0.1/admin/secrets";
        }
        return "https://example.com/safe-object";
      },
      async delete() {},
      async exists() { return true; },
    };

    const ssrfAdapter = new StorageProviderThemeStorageAdapter(
      ssrfProvider,
      "themes",
    );

    // Should return null and not attempt fetching metadata or private network endpoints
    expect(await ssrfAdapter.getThemeFile("test", "1.0.0", "metadata.json", "pub_alpha")).toBeNull();
    expect(await ssrfAdapter.getThemeFile("test", "1.0.0", "internal.json", "pub_alpha")).toBeNull();
  });

  describe("SSRF URL & IP Hardening Unit Tests", () => {
    it("identifies private, loopback, link-local, and metadata IPv4 addresses", () => {
      // Loopback
      expect(isPrivateOrRestrictedIP("127.0.0.1")).toBe(true);
      expect(isPrivateOrRestrictedIP("127.128.0.1")).toBe(true);
      // Link-local / AWS / GCP / Azure metadata
      expect(isPrivateOrRestrictedIP("169.254.169.254")).toBe(true);
      expect(isPrivateOrRestrictedIP("169.254.1.1")).toBe(true);
      // RFC 1918 Private
      expect(isPrivateOrRestrictedIP("10.0.0.1")).toBe(true);
      expect(isPrivateOrRestrictedIP("172.16.0.1")).toBe(true);
      expect(isPrivateOrRestrictedIP("172.31.255.255")).toBe(true);
      expect(isPrivateOrRestrictedIP("192.168.1.1")).toBe(true);
      // Current network / Multicast
      expect(isPrivateOrRestrictedIP("0.0.0.0")).toBe(true);
      expect(isPrivateOrRestrictedIP("224.0.0.1")).toBe(true);

      // Public routable IPs should NOT be restricted
      expect(isPrivateOrRestrictedIP("8.8.8.8")).toBe(false);
      expect(isPrivateOrRestrictedIP("1.1.1.1")).toBe(false);
      expect(isPrivateOrRestrictedIP("54.231.0.1")).toBe(false);
    });

    it("identifies IPv4-mapped IPv6 in dot notation and hex notation", () => {
      // IPv4-mapped IPv6 loopback
      expect(isPrivateOrRestrictedIP("::ffff:127.0.0.1")).toBe(true);
      expect(isPrivateOrRestrictedIP("[::ffff:127.0.0.1]")).toBe(true);
      expect(isPrivateOrRestrictedIP("::ffff:7f00:0001")).toBe(true);
      expect(isPrivateOrRestrictedIP("::ffff:7f00:1")).toBe(true);

      // IPv4-mapped IPv6 cloud metadata (169.254.169.254 in hex is a9fe:a9fe)
      expect(isPrivateOrRestrictedIP("::ffff:169.254.169.254")).toBe(true);
      expect(isPrivateOrRestrictedIP("[::ffff:169.254.169.254]")).toBe(true);
      expect(isPrivateOrRestrictedIP("::ffff:a9fe:a9fe")).toBe(true);
      expect(isPrivateOrRestrictedIP("[::ffff:a9fe:a9fe]")).toBe(true);

      // IPv4-mapped IPv6 private RFC 1918 (10.0.0.1)
      expect(isPrivateOrRestrictedIP("::ffff:10.0.0.1")).toBe(true);
      expect(isPrivateOrRestrictedIP("::ffff:0a00:0001")).toBe(true);

      // IPv4-mapped IPv6 public IP
      expect(isPrivateOrRestrictedIP("::ffff:8.8.8.8")).toBe(false);
      expect(isPrivateOrRestrictedIP("::ffff:0808:0808")).toBe(false);
    });

    it("identifies IPv6 loopback, link-local, and ULA addresses", () => {
      // IPv6 Loopback
      expect(isPrivateOrRestrictedIP("::1")).toBe(true);
      expect(isPrivateOrRestrictedIP("[::1]")).toBe(true);
      // IPv6 Link-local
      expect(isPrivateOrRestrictedIP("fe80::1")).toBe(true);
      expect(isPrivateOrRestrictedIP("[fe80::1]")).toBe(true);
      // IPv6 Unique Local Address
      expect(isPrivateOrRestrictedIP("fc00::1")).toBe(true);
      expect(isPrivateOrRestrictedIP("fd12:3456:789a::1")).toBe(true);
    });

    it("isSafeSignedUrl blocks dangerous URLs and allows safe public URLs", async () => {
      // Block cloud metadata
      expect(await isSafeSignedUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
      expect(await isSafeSignedUrl("http://[::ffff:169.254.169.254]/latest")).toBe(false);
      expect(await isSafeSignedUrl("http://[::ffff:a9fe:a9fe]/latest")).toBe(false);
      expect(await isSafeSignedUrl("http://metadata.google.internal/")).toBe(false);
      expect(await isSafeSignedUrl("http://instance-data/latest")).toBe(false);

      // Block loopback and local names
      expect(await isSafeSignedUrl("http://127.0.0.1:8080/admin")).toBe(false);
      expect(await isSafeSignedUrl("http://[::ffff:127.0.0.1]:8080/")).toBe(false);
      expect(await isSafeSignedUrl("http://[::ffff:7f00:1]/")).toBe(false);
      expect(await isSafeSignedUrl("http://localhost:3000/")).toBe(false);
      expect(await isSafeSignedUrl("http://service.local/")).toBe(false);
      expect(await isSafeSignedUrl("http://service.internal/")).toBe(false);

      // Block private RFC 1918
      expect(await isSafeSignedUrl("http://10.0.0.1/secrets")).toBe(false);
      expect(await isSafeSignedUrl("http://172.16.5.1/secrets")).toBe(false);
      expect(await isSafeSignedUrl("http://192.168.1.100/secrets")).toBe(false);

      // Allow safe public HTTPS URL
      expect(await isSafeSignedUrl("https://s3.amazonaws.com/my-bucket/theme.json")).toBe(true);

      // Non HTTP/HTTPS protocol rejected
      expect(await isSafeSignedUrl("ftp://example.com/asset")).toBe(false);
      expect(await isSafeSignedUrl("file:///etc/passwd")).toBe(false);
      expect(await isSafeSignedUrl("javascript:alert(1)")).toBe(false);
    });

    it("respects configured S3/MinIO endpoint trust boundary", async () => {
      const origEnv = process.env.STORAGE_S3_ENDPOINT;
      try {
        process.env.STORAGE_S3_ENDPOINT = "http://127.0.0.1:9000";

        // Exact match to configured endpoint is allowed
        expect(await isSafeSignedUrl("http://127.0.0.1:9000/vibress-themes/theme.json")).toBe(true);

        // Different port or unauthorized internal host is still blocked
        expect(await isSafeSignedUrl("http://127.0.0.1:8000/vibress-themes/theme.json")).toBe(false);
        expect(await isSafeSignedUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
      } finally {
        if (origEnv !== undefined) {
          process.env.STORAGE_S3_ENDPOINT = origEnv;
        } else {
          delete process.env.STORAGE_S3_ENDPOINT;
        }
      }
    });

    it("rejects untrusted storage destinations before establishing connection", async () => {
      const untrustedUrls = [
        "https://attacker-controlled.com/theme.json",
        "https://evil.internal.corp/steal",
        "https://s3.evil-domain.com/theme.json",
        "https://mybucket.s3.attacker.com/theme.json",
        "http://169.254.169.254/latest/meta-data",
      ];

      for (const rawUrl of untrustedUrls) {
        expect(isTrustedStorageDestination(new URL(rawUrl))).toBe(false);
        await expect(fetchSignedUrlSafely(rawUrl)).rejects.toThrow(/Untrusted storage destination/);
      }

      // Valid cloud storage domains are recognized as trusted destinations
      expect(isTrustedStorageDestination(new URL("https://mybucket.s3.amazonaws.com/theme.json"))).toBe(true);
      expect(isTrustedStorageDestination(new URL("https://s3.us-west-2.amazonaws.com/theme.json"))).toBe(true);
      expect(isTrustedStorageDestination(new URL("https://mybucket.r2.cloudflarestorage.com/theme.json"))).toBe(true);
      expect(isTrustedStorageDestination(new URL("https://storage.googleapis.com/mybucket/theme.json"))).toBe(true);
      expect(isTrustedStorageDestination(new URL("https://myaccount.blob.core.windows.net/mycontainer/theme.json"))).toBe(true);
    });

    it("prevents DNS rebinding by validating resolved IP at connection time", async () => {
      const origLookup = dns.lookup;
      try {
        // Mock dns.lookup to simulate DNS rebinding: trusted domain resolves to restricted IP
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dns as any).lookup = (
          _hostname: string,
          options: unknown,
          callback: (err: Error | null, address: unknown, family?: number) => void,
        ) => {
          let cb = callback;
          if (typeof options === "function") {
            cb = options as typeof callback;
          }
          cb(null, "127.0.0.1", 4);
        };

        await expect(
          fetchSignedUrlSafely("https://s3.amazonaws.com/mybucket/theme.json"),
        ).rejects.toThrow(/Connection-time SSRF blocked/);
      } finally {
        dns.lookup = origLookup;
      }
    });
  });

  describe("PRIORITY 1 Review Regressions: Manifest Recovery, Pinned Reads & Native Storage Preference", () => {
    it("Post-activation verification storage read failure does not delete staged generation", async () => {
      const themeId = "post-activation-fail-theme";
      const version = "1.0.0";
      const pubId = "pub_alpha";

      const files = new Map<string, Buffer>();
      files.set("theme.json", Buffer.from(JSON.stringify({ name: "Safe Theme" })));
      files.set("templates/index.liquid", Buffer.from("<h1>Hello Safe</h1>"));

      // Configure provider to fail when reading the manifest (__files.json) during post-activation check
      const manifestKey = adapter.getThemeRootPath(themeId, version, pubId) + "/__files.json";
      provider.failOnGetBufferKeys.add(manifestKey);

      // saveThemeFiles should complete without deleting the staged files
      const root = await adapter.saveThemeFiles(themeId, version, files, pubId);
      expect(root).toBeDefined();

      // Clear the failure so we can inspect storage
      provider.failOnGetBufferKeys.clear();

      // Verify that the manifest exists and points to our generation
      const manifestBuffer = await provider.getObjectBuffer(manifestKey);
      expect(manifestBuffer).not.toBeNull();
      const manifest = JSON.parse(manifestBuffer!.toString("utf-8"));
      expect(manifest.generation).toBeDefined();

      // Verify that our staged files were NOT deleted and remain intact in storage
      const genFileKey = `${root}/generations/${manifest.generation}/templates/index.liquid`;
      const fileBuffer = await provider.getObjectBuffer(genFileKey);
      expect(fileBuffer).not.toBeNull();
      expect(fileBuffer!.toString("utf-8")).toBe("<h1>Hello Safe</h1>");
    });

    it("Ambiguous write recovery read failure preserves staged files without deleting them", async () => {
      const themeId = "ambiguous-fail-theme";
      const version = "1.0.0";
      const pubId = "pub_alpha";

      const files = new Map<string, Buffer>();
      files.set("theme.json", Buffer.from(JSON.stringify({ name: "Ambiguous Theme" })));
      files.set("assets/app.js", Buffer.from("console.log('staged');"));

      const root = adapter.getThemeRootPath(themeId, version, pubId);
      const manifestKey = `${root}/__files.json`;

      // Fail manifest put AND fail recovery read
      provider.failOnPutKeys.add(manifestKey);
      provider.failOnGetBufferKeys.add(manifestKey);

      // saveThemeFiles should throw the write error
      await expect(
        adapter.saveThemeFiles(themeId, version, files, pubId),
      ).rejects.toThrow();

      // Staged files should NOT have been deleted because authoritative state was indeterminate!
      const stagedKeys = Array.from(provider.objects.keys()).filter((k) =>
        k.includes("generations") && k.endsWith("assets/app.js"),
      );
      expect(stagedKeys.length).toBe(1);
      const stagedContent = provider.objects.get(stagedKeys[0]!);
      expect(stagedContent?.toString("utf-8")).toBe("console.log('staged');");
    });

    it("getThemeFilesMap pins generation snapshot and prevents torn reads during concurrent replacement", async () => {
      const themeId = "concurrent-read-theme";
      const version = "1.0.0";
      const pubId = "pub_alpha";

      // 1. Install Generation 1
      const v1Files = new Map<string, Buffer>();
      v1Files.set("theme.json", Buffer.from(JSON.stringify({ name: "Theme Gen 1" })));
      v1Files.set("assets/style.css", Buffer.from("/* Gen 1 CSS */"));
      v1Files.set("templates/index.liquid", Buffer.from("<h1>Gen 1 HTML</h1>"));
      await adapter.saveThemeFiles(themeId, version, v1Files, pubId);

      // Verify Gen 1 is installed
      const initialMap = await adapter.getThemeFilesMap(themeId, version, pubId);
      expect(initialMap.get("assets/style.css")).toBe("/* Gen 1 CSS */");
      expect(initialMap.get("templates/index.liquid")).toBe("<h1>Gen 1 HTML</h1>");

      // 2. Set up hook: during getThemeFilesMap, after the first file is read, simulate concurrent theme replacement to Gen 2!
      let concurrentReplacementDone = false;
      provider.onGetBufferHook = async (key: string) => {
        // Trigger replacement when reading the first theme file inside getThemeFilesMap
        if (!concurrentReplacementDone && key.includes("assets/style.css")) {
          concurrentReplacementDone = true;
          const v2Files = new Map<string, Buffer>();
          v2Files.set("theme.json", Buffer.from(JSON.stringify({ name: "Theme Gen 2" })));
          v2Files.set("assets/style.css", Buffer.from("/* Gen 2 CSS */"));
          v2Files.set("templates/index.liquid", Buffer.from("<h1>Gen 2 HTML</h1>"));
          await adapter.saveThemeFiles(themeId, version, v2Files, pubId);
        }
      };

      // 3. Read theme files map while replacement happens mid-operation
      const filesMap = await adapter.getThemeFilesMap(themeId, version, pubId);
      expect(concurrentReplacementDone).toBe(true);

      // Crucial assertion: filesMap MUST NOT be torn!
      // All files returned by getThemeFilesMap must come exclusively from Gen 1
      expect(filesMap.get("assets/style.css")).toBe("/* Gen 1 CSS */");
      expect(filesMap.get("templates/index.liquid")).toBe("<h1>Gen 1 HTML</h1>");

      // Clear the hook
      provider.onGetBufferHook = undefined;

      // Subsequent read after completion should consistently see Gen 2
      const subsequentMap = await adapter.getThemeFilesMap(themeId, version, pubId);
      expect(subsequentMap.get("assets/style.css")).toBe("/* Gen 2 CSS */");
      expect(subsequentMap.get("templates/index.liquid")).toBe("<h1>Gen 2 HTML</h1>");
    });

    it("prefers native getObjectBuffer over signed URLs when available", async () => {
      let getObjectBufferCalled = false;
      let getSignedUrlCalled = false;

      const hybridProvider: StorageProvider = {
        name: "s3",
        getCapabilities: () => ({
          signedUrls: true,
          directUpload: true,
          multipartUpload: true,
          privateObjects: true,
          publicObjects: true,
        }),
        put: async (input) => ({ key: input.key, url: `fake://${input.key}`, size: 10 }),
        delete: async () => {},
        exists: async () => true,
        getUrl: async (k) => `fake://${k}`,
        getObjectBuffer: async (k) => {
          getObjectBufferCalled = true;
          if (k.endsWith("__files.json")) {
            return Buffer.from(JSON.stringify({ files: ["theme.json"], generation: "g1" }));
          }
          return Buffer.from("native-content");
        },
        getSignedUrl: async () => {
          getSignedUrlCalled = true;
          return "https://s3.amazonaws.com/bucket/key";
        },
      };

      const adapter = new StorageProviderThemeStorageAdapter(hybridProvider);
      const file = await adapter.getThemeFile("test", "1.0.0", "theme.json", "pub_alpha");

      expect(getObjectBufferCalled).toBe(true);
      expect(getSignedUrlCalled).toBe(false);
      expect(file?.toString("utf-8")).toBe("native-content");
    });

    it("concurrent generation cleanup: superseded generation referenced as previousGeneration is preserved", async () => {
      const themeId = "concurrent-cleanup-theme";
      const version = "1.0.0";
      const pubId = "pub_alpha";

      const g1Files = new Map<string, Buffer>();
      g1Files.set("theme.json", Buffer.from(JSON.stringify({ name: "Generation 1" })));
      g1Files.set("assets/app.js", Buffer.from("console.log('G1');"));

      const g2Files = new Map<string, Buffer>();
      g2Files.set("theme.json", Buffer.from(JSON.stringify({ name: "Generation 2" })));
      g2Files.set("assets/app.js", Buffer.from("console.log('G2');"));

      // Interleave:
      // When Writer A puts its manifest (G1), immediately execute Writer B's write (G2)
      // BEFORE Writer A proceeds to post-activation verification!
      let writerBExecuted = false;
      let g1GenerationId: string | undefined;

      const originalPut = provider.put.bind(provider);
      provider.put = async (input) => {
        const result = await originalPut(input);
        if (
          !writerBExecuted &&
          input.key.includes(themeId) &&
          input.key.endsWith("__files.json")
        ) {
          writerBExecuted = true;
          // Extract G1's generation from A's committed manifest
          const manifestA = JSON.parse(input.body.toString());
          g1GenerationId = manifestA.generation;

          // Now Writer B reads the manifest (sees G1) and publishes G2 (retaining G1 as previousGeneration)
          // We call adapter.saveThemeFiles for G2 right here
          await adapter.saveThemeFiles(themeId, version, g2Files, pubId);
        }
        return result;
      };

      // Writer A executes
      await adapter.saveThemeFiles(themeId, version, g1Files, pubId);

      // Restore provider.put
      provider.put = originalPut;

      expect(writerBExecuted).toBe(true);
      expect(g1GenerationId).toBeDefined();

      // Check authoritative manifest: G2 is active, previousGeneration is G1
      const root = adapter.getThemeRootPath(themeId, version, pubId);
      const manifestBuf = provider.objects.get(`${root}/__files.json`);
      expect(manifestBuf).toBeDefined();
      const manifest = JSON.parse(manifestBuf!.toString("utf-8"));
      expect(manifest.previousGeneration).toBe(g1GenerationId);

      // CRITICAL ASSERTION:
      // G1's files MUST NOT have been deleted by Writer A's post-activation cleanup!
      const g1FileKey = `${root}/generations/${g1GenerationId}/assets/app.js`;
      expect(provider.objects.has(g1FileKey)).toBe(true);

      // An in-flight reader pinned to G1 can still read G1 assets
      const g1File = await adapter.getThemeFile(themeId, version, "assets/app.js", pubId, false, g1GenerationId);
      expect(g1File?.toString("utf-8")).toBe("console.log('G1');");

      // Active reader reads latest G2 assets
      const activeFile = await adapter.getThemeFile(themeId, version, "assets/app.js", pubId);
      expect(activeFile?.toString("utf-8")).toBe("console.log('G2');");
    });

    it("resolves v2 legacy-root packages consistently in getThemeFilesMap and getThemeFile when authorized", async () => {
      const themeId = "legacy-v2-theme";
      const version = "1.0.0";
      const subPubId = "pub_subscriber_custom";
      const legacyGen = "gen_legacy_v2_xyz";

      // Seed a v2 package at legacy root: themes/{themeId}/{version}/
      const legacyRoot = `themes/${themeId}/${version}`;
      const legacyGenPrefix = `${legacyRoot}/generations/${legacyGen}`;

      await provider.put({
        key: `${legacyGenPrefix}/theme.json`,
        body: Buffer.from(JSON.stringify({ name: "Legacy V2 Theme", version: "1.0.0" })),
        contentType: "application/json",
      });
      await provider.put({
        key: `${legacyGenPrefix}/templates/index.liquid`,
        body: Buffer.from("<h1>Legacy V2 Template</h1>"),
        contentType: "text/html",
      });
      await provider.put({
        key: `${legacyGenPrefix}/assets/style.css`,
        body: Buffer.from("body { background: #fafafa; }"),
        contentType: "text/css",
      });
      await provider.put({
        key: `${legacyRoot}/__files.json`,
        body: Buffer.from(
          JSON.stringify({
            format: "v2",
            generation: legacyGen,
            files: ["assets/style.css", "templates/index.liquid", "theme.json"],
            createdAt: new Date().toISOString(),
          }),
        ),
        contentType: "application/json",
      });

      // 1. Without allowLegacyFallback (or default false), subscriber pub cannot access legacy package
      const deniedMap = await adapter.getThemeFilesMap(themeId, version, subPubId, false);
      expect(deniedMap.size).toBe(0);

      const deniedFile = await adapter.getThemeFile(themeId, version, "theme.json", subPubId, false, legacyGen);
      expect(deniedFile).toBeNull();

      // 2. With allowLegacyFallback = true, getThemeFilesMap resolves all files using manifest.root
      const filesMap = await adapter.getThemeFilesMap(themeId, version, subPubId, true);
      expect(filesMap.size).toBe(3);
      expect(filesMap.get("theme.json")).toContain('"Legacy V2 Theme"');
      expect(filesMap.get("templates/index.liquid")).toBe("<h1>Legacy V2 Template</h1>");
      expect(filesMap.get("assets/style.css")).toBe("body { background: #fafafa; }");

      // 3. getThemeFile with pinned generation also resolves via legacy root fallback when authorized
      const pinnedFile = await adapter.getThemeFile(
        themeId,
        version,
        "templates/index.liquid",
        subPubId,
        true,
        legacyGen,
      );
      expect(pinnedFile?.toString("utf-8")).toBe("<h1>Legacy V2 Template</h1>");
    });
  });
});
