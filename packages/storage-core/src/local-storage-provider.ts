import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  StorageProvider,
  StorageCapabilities,
  PutObjectInput,
  StoredObject,
} from "./storage-provider";
import {
  StorageError,
  StoragePathTraversalError,
  StorageKeyInvalidError,
} from "./errors";

export interface LocalStorageOptions {
  storageRoot?: string;
  tempDir?: string;
  baseUrl?: string;
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly storageRoot: string;
  private readonly tempDir: string;
  private readonly baseUrl: string;

  constructor(options: LocalStorageOptions = {}) {
    this.storageRoot = path.resolve(
      options.storageRoot || path.join(process.cwd(), "content", "media"),
    );
    this.tempDir = path.resolve(
      options.tempDir || path.join(process.cwd(), "content", "temp"),
    );
    this.baseUrl = (options.baseUrl || "/content/media").replace(/\/+$/, "");
  }

  getCapabilities(): StorageCapabilities {
    return {
      signedUrls: false,
      directUpload: false,
      multipartUpload: false,
      privateObjects: false,
      publicObjects: true,
    };
  }

  private resolveKeyPath(key: string): string {
    if (!key || typeof key !== "string") {
      throw new StorageKeyInvalidError(key, "Key must be a non-empty string");
    }

    if (key.includes("\0")) {
      throw new StoragePathTraversalError(key);
    }

    // Standardize slashes
    const normalizedKey = key.replace(/\\/g, "/");

    // Check for explicit path traversal components
    const parts = normalizedKey.split("/");
    if (parts.includes("..") || parts.includes(".")) {
      throw new StoragePathTraversalError(key);
    }

    if (path.isAbsolute(normalizedKey)) {
      throw new StoragePathTraversalError(key);
    }

    const resolvedPath = path.resolve(this.storageRoot, normalizedKey);

    const relative = path.relative(this.storageRoot, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new StoragePathTraversalError(key);
    }

    return resolvedPath;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const targetPath = this.resolveKeyPath(input.key);
    const targetDir = path.dirname(targetPath);

    await fs.promises.mkdir(targetDir, { recursive: true });
    await fs.promises.mkdir(this.tempDir, { recursive: true });

    const tempFileName = `.tmp-${crypto.randomUUID()}`;
    const tempPath = path.join(this.tempDir, tempFileName);

    try {
      await fs.promises.writeFile(tempPath, input.body);
      await fs.promises.rename(tempPath, targetPath);

      const stats = await fs.promises.stat(targetPath);
      const url = await this.getUrl(input.key);

      return {
        key: input.key,
        url,
        size: stats.size,
        contentType: input.contentType,
      };
    } catch (error) {
      if (fs.existsSync(tempPath)) {
        try {
          await fs.promises.unlink(tempPath);
        } catch {
          // ignore cleanup error
        }
      }
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(
        `Failed to write local storage object '${input.key}': ${(error as Error).message}`,
      );
    }
  }

  async delete(key: string): Promise<void> {
    const targetPath = this.resolveKeyPath(key);
    try {
      await fs.promises.unlink(targetPath);
    } catch (error) {
      if (
        error instanceof Error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        return; // Idempotent deletion
      }
      throw new StorageError(
        `Failed to delete local storage object '${key}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    const targetPath = this.resolveKeyPath(key);
    try {
      await fs.promises.access(targetPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(key: string): Promise<string> {
    this.resolveKeyPath(key); // Validates key safety
    const cleanKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    return `${this.baseUrl}/${cleanKey}`;
  }
}
