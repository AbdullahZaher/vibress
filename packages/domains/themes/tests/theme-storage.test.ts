import { describe, it, expect } from "vitest";
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
});
