import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createThemeStorageAdapter,
  ThemeStorageConfigurationError,
  FileSystemThemeStorageAdapter,
  StorageProviderThemeStorageAdapter,
} from "../src/domain/theme-storage";
import { StorageProvider, StorageCapabilities, StoredObject, PutObjectInput } from "@vibress/storage-core";

class MockS3StorageProvider implements StorageProvider {
  readonly name = "s3";
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
    return { key: input.key, url: `https://s3.example.com/${input.key}`, size: 100 };
  }
  async delete(): Promise<void> {}
  async exists(): Promise<boolean> { return true; }
  async getUrl(key: string): Promise<string> { return `https://s3.example.com/${key}`; }
}

class MockLocalStorageProvider implements StorageProvider {
  readonly name = "local";
  getCapabilities(): StorageCapabilities {
    return {
      signedUrls: false,
      directUpload: false,
      multipartUpload: false,
      privateObjects: true,
      publicObjects: true,
    };
  }
  async put(input: PutObjectInput): Promise<StoredObject> {
    return { key: input.key, url: `/content/${input.key}`, size: 100 };
  }
  async delete(): Promise<void> {}
  async exists(): Promise<boolean> { return true; }
  async getUrl(key: string): Promise<string> { return `/content/${key}`; }
}

class MemoryThemeStorageProvider implements StorageProvider {
  readonly name = "s3";
  private readonly objects = new Map<string, Buffer>();

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
    const body = Buffer.from(input.body);
    this.objects.set(input.key, body);
    return { key: input.key, url: `memory://${input.key}`, size: body.length };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async getUrl(key: string): Promise<string> {
    return `memory://${key}`;
  }

  async getObjectBuffer(key: string): Promise<Buffer | null> {
    return this.objects.get(key) ?? null;
  }
}

describe("Theme Storage Adapter Factory & Fail-Closed Behavior", () => {
  it("creates FileSystemThemeStorageAdapter in development when no provider is given", () => {
    const adapter = createThemeStorageAdapter({
      localPath: "/tmp/themes",
      requireDurableStorage: false,
    });
    expect(adapter).toBeInstanceOf(FileSystemThemeStorageAdapter);
  });

  it("creates StorageProviderThemeStorageAdapter when durable cloud provider is given", () => {
    const adapter = createThemeStorageAdapter({
      storageProvider: new MockS3StorageProvider(),
      requireDurableStorage: true,
    });
    expect(adapter).toBeInstanceOf(StorageProviderThemeStorageAdapter);
  });

  it("fails closed with ThemeStorageConfigurationError when durable storage is required but none is provided", () => {
    expect(() => {
      createThemeStorageAdapter({
        requireDurableStorage: true,
      });
    }).toThrow(ThemeStorageConfigurationError);
  });

  it("fails closed when durable storage is required but local filesystem provider is supplied", () => {
    expect(() => {
      createThemeStorageAdapter({
        storageProvider: new MockLocalStorageProvider(),
        requireDurableStorage: true,
      });
    }).toThrow(ThemeStorageConfigurationError);
  });

  it("keeps identical theme versions physically isolated by publication", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "vibress-theme-isolation-"),
    );
    try {
      const adapter = new FileSystemThemeStorageAdapter({
        storageRoot: root,
      });
      const themeId = "shared-theme";
      const version = "1.0.0";

      await adapter.saveThemeFiles(
        themeId,
        version,
        new Map([["templates/home.liquid", Buffer.from("alpha")]]),
        "pub_alpha",
      );
      await adapter.saveThemeFiles(
        themeId,
        version,
        new Map([["templates/home.liquid", Buffer.from("beta")]]),
        "pub_beta",
      );

      expect(
        (
          await adapter.getThemeFile(
            themeId,
            version,
            "templates/home.liquid",
            "pub_alpha",
          )
        )?.toString("utf-8"),
      ).toBe("alpha");
      expect(
        (
          await adapter.getThemeFile(
            themeId,
            version,
            "templates/home.liquid",
            "pub_beta",
          )
        )?.toString("utf-8"),
      ).toBe("beta");

      await adapter.deleteThemeFiles(themeId, version, "pub_alpha");

      expect(
        await adapter.getThemeFile(
          themeId,
          version,
          "templates/home.liquid",
          "pub_alpha",
        ),
      ).toBeNull();
      expect(
        (
          await adapter.getThemeFile(
            themeId,
            version,
            "templates/home.liquid",
            "pub_beta",
          )
        )?.toString("utf-8"),
      ).toBe("beta");
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it("does not read legacy cloud files after installing a scoped theme package", async () => {
    const provider = new MemoryThemeStorageProvider();
    const adapter = new StorageProviderThemeStorageAdapter(provider);
    const themeId = "shared-theme";
    const version = "1.0.0";

    await adapter.saveThemeFiles(
      themeId,
      version,
      new Map([
        ["theme.json", Buffer.from("{}")],
        ["templates/legacy.liquid", Buffer.from("legacy")],
      ]),
      "pub_default",
    );

    // Existing installations may still need the old unscoped package.
    expect(
      (
        await adapter.getThemeFile(
          themeId,
          version,
          "templates/legacy.liquid",
          "pub_alpha",
        )
      )?.toString("utf8"),
    ).toBe("legacy");

    await adapter.saveThemeFiles(
      themeId,
      version,
      new Map([
        ["theme.json", Buffer.from("{}")],
        ["templates/home.liquid", Buffer.from("alpha")],
      ]),
      "pub_alpha",
    );

    expect(
      (
        await adapter.getThemeFile(
          themeId,
          version,
          "templates/home.liquid",
          "pub_alpha",
        )
      )?.toString("utf8"),
    ).toBe("alpha");
    expect(
      await adapter.getThemeFile(
        themeId,
        version,
        "templates/legacy.liquid",
        "pub_alpha",
      ),
    ).toBeNull();
    expect(await adapter.themeExists(themeId, version, "pub_alpha")).toBe(true);

    // A scoped package missing its manifest must not be rescued by the
    // legacy global theme's manifest.
    await adapter.saveThemeFiles(
      themeId,
      version,
      new Map([["templates/home.liquid", Buffer.from("beta")]]),
      "pub_beta",
    );
    expect(await adapter.themeExists(themeId, version, "pub_beta")).toBe(false);
  });

  it("requires explicit authorization for legacy filesystem access", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibress-legacy-storage-"));
    try {
      const adapter = new FileSystemThemeStorageAdapter({ storageRoot: root });
      const files = new Map([["templates/home.liquid", Buffer.from("legacy")]]);
      await adapter.saveThemeFiles("shared-theme", "1.0.0", files);
      expect(await adapter.getThemeFile("shared-theme", "1.0.0", "templates/home.liquid", "pub_alpha")).toBeNull();
      expect((await adapter.getThemeFile("shared-theme", "1.0.0", "templates/home.liquid", "pub_alpha", true))?.toString()).toBe("legacy");

      await adapter.saveThemeFiles("shared-theme", "1.0.0",
        new Map([["templates/new.liquid", Buffer.from("private")]]), "pub_alpha");
      // A scoped package is authoritative, even if an authorized legacy file exists.
      expect(await adapter.getThemeFile("shared-theme", "1.0.0", "templates/home.liquid", "pub_alpha", true)).toBeNull();
      expect((await adapter.getThemeFile("shared-theme", "1.0.0", "templates/new.liquid", "pub_alpha"))?.toString()).toBe("private");
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it("replaces filesystem packages without retaining removed files, preserving old files on validation failure", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibress-theme-replace-"));
    try {
      const adapter = new FileSystemThemeStorageAdapter({ storageRoot: root });
      const id = "replace-theme";
      const version = "1.0.0";
      await adapter.saveThemeFiles(id, version, new Map([
        ["theme.json", Buffer.from("old")],
        ["assets/retired.css", Buffer.from("old css")],
      ]), "pub_alpha");
      await expect(adapter.saveThemeFiles(id, version, new Map([
        ["../../escaped.txt", Buffer.from("unsafe")],
      ]), "pub_alpha")).rejects.toThrow("Invalid theme file path");
      expect((await adapter.getThemeFile(id, version, "theme.json", "pub_alpha"))?.toString()).toBe("old");
      await adapter.saveThemeFiles(id, version, new Map([
        ["theme.json", Buffer.from("new")],
        ["assets/current.css", Buffer.from("new css")],
      ]), "pub_alpha");
      expect((await adapter.getThemeFile(id, version, "theme.json", "pub_alpha"))?.toString()).toBe("new");
      expect(await adapter.getThemeFile(id, version, "assets/retired.css", "pub_alpha")).toBeNull();
      expect(await adapter.listThemeFiles(id, version, "pub_alpha")).toEqual(["assets/current.css", "theme.json"].sort());
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it("uses the cloud package index to reject removed assets and unauthorized legacy reads", async () => {
    const provider = new MemoryThemeStorageProvider();
    const adapter = new StorageProviderThemeStorageAdapter(provider);
    const id = "replace-theme";
    const version = "1.0.0";
    await adapter.saveThemeFiles(id, version, new Map([
      ["theme.json", Buffer.from("legacy")],
      ["assets/retired.css", Buffer.from("legacy css")],
    ]));
    expect(await adapter.getThemeFile(id, version, "theme.json", "pub_beta")).toBeNull();
    expect((await adapter.getThemeFile(id, version, "theme.json", "pub_beta", true))?.toString()).toBe("legacy");

    await adapter.saveThemeFiles(id, version, new Map([
      ["theme.json", Buffer.from("initial")],
      ["assets/retired.css", Buffer.from("private css")],
    ]), "pub_beta");
    await adapter.saveThemeFiles(id, version, new Map([
      ["theme.json", Buffer.from("current")],
    ]), "pub_beta");
    expect((await adapter.getThemeFile(id, version, "theme.json", "pub_beta"))?.toString()).toBe("current");
    expect(await adapter.getThemeFile(id, version, "assets/retired.css", "pub_beta", true)).toBeNull();
    expect(await provider.exists("themes/publications/pub_beta/replace-theme/1.0.0/assets/retired.css")).toBe(false);
    // Replacing a scoped package must not alter the legacy default publication.
    expect((await adapter.getThemeFile(id, version, "theme.json"))?.toString()).toBe("legacy");
  });

  it("keeps the pub_default filesystem path backward compatible", () => {
    const adapter = new FileSystemThemeStorageAdapter({
      storageRoot: "/tmp/vibress-theme-root",
    });
    expect(
      adapter.getThemeRootPath("legacy-theme", "1.0.0", "pub_default"),
    ).toBe(path.join("/tmp/vibress-theme-root", "legacy-theme", "1.0.0"));
  });
});
