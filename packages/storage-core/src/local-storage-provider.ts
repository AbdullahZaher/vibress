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

/**
 * Resolves the canonical persistent local media storage root.
 *
 * Precedence:
 * 1. Explicit `customRoot` passed via options.
 * 2. `STORAGE_LOCAL_ROOT` environment variable.
 * 3. Deterministic monorepo root discovery: climbs upward from `__dirname`
 *    (with fallback to `process.cwd()`) locating `pnpm-workspace.yaml` or `nx.json`,
 *    then anchors persistent media at `<repoRoot>/content/media`.
 * 4. Fallback to `<process.cwd()>/content/media` if no repository boundary is found.
 */
export function resolveCanonicalStorageRoot(customRoot?: string): string {
  if (customRoot && typeof customRoot === "string" && customRoot.trim().length > 0) {
    return path.resolve(customRoot.trim());
  }

  const envRoot = process.env.STORAGE_LOCAL_ROOT;
  if (envRoot && typeof envRoot === "string" && envRoot.trim().length > 0) {
    return path.resolve(envRoot.trim());
  }

  // 1. Traverse upward from __dirname (handles tsx/ts-node and compiled packages)
  try {
    let curr = path.resolve(__dirname);
    while (curr !== path.dirname(curr)) {
      if (
        fs.existsSync(path.join(curr, "pnpm-workspace.yaml")) ||
        fs.existsSync(path.join(curr, "nx.json"))
      ) {
        return path.resolve(curr, "content", "media");
      }
      curr = path.dirname(curr);
    }
  } catch {
    // ignore
  }

  // 2. Traverse upward from process.cwd() (handles when cwd is inside apps/api or workspace root)
  try {
    let curr = path.resolve(process.cwd());
    while (curr !== path.dirname(curr)) {
      if (
        fs.existsSync(path.join(curr, "pnpm-workspace.yaml")) ||
        fs.existsSync(path.join(curr, "nx.json"))
      ) {
        return path.resolve(curr, "content", "media");
      }
      curr = path.dirname(curr);
    }
  } catch {
    // ignore
  }

  // 3. Fallback
  return path.resolve("content", "media");
}

/**
 * Resolves the temporary upload directory relative to the canonical storage parent.
 */
export function resolveCanonicalTempDir(customTemp?: string): string {
  if (customTemp && typeof customTemp === "string" && customTemp.trim().length > 0) {
    return path.resolve(customTemp.trim());
  }
  const storageRoot = resolveCanonicalStorageRoot();
  return path.resolve(path.dirname(storageRoot), "temp");
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly storageRoot: string;
  private readonly tempDir: string;
  private readonly baseUrl: string;

  constructor(options: LocalStorageOptions = {}) {
    this.storageRoot = resolveCanonicalStorageRoot(options.storageRoot);
    this.tempDir = resolveCanonicalTempDir(options.tempDir);
    this.baseUrl = (options.baseUrl || "/content/media").replace(/\/+$/, "");
  }

  getStorageRoot(): string {
    return this.storageRoot;
  }

  getTempDir(): string {
    return this.tempDir;
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
