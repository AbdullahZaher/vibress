import { StorageProvider } from "@vibress/storage-core";
import { ThemeStorageAdapter } from "./theme-storage";

export class StorageProviderThemeStorageAdapter implements ThemeStorageAdapter {
  constructor(
    private storageProvider: StorageProvider,
    private prefix: string = "themes",
  ) {}

  getThemeRootPath(themeId: string, version: string): string {
    const cleanId = themeId.replace(/[^a-z0-9-]/g, "");
    const cleanVersion = version.replace(/[^0-9.]/g, "");
    return `${this.prefix}/${cleanId}/${cleanVersion}`;
  }

  private getObjectKey(
    themeId: string,
    version: string,
    relativePath: string,
  ): string {
    const root = this.getThemeRootPath(themeId, version);
    const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return `${root}/${cleanRel}`;
  }

  async saveThemeFiles(
    themeId: string,
    version: string,
    files: Map<string, Buffer>,
  ): Promise<string> {
    const root = this.getThemeRootPath(themeId, version);
    const fileList: string[] = [];

    for (const [relPath, buffer] of files.entries()) {
      const key = this.getObjectKey(themeId, version, relPath);
      let contentType = "application/octet-stream";
      if (relPath.endsWith(".json")) contentType = "application/json";
      else if (relPath.endsWith(".css")) contentType = "text/css";
      else if (relPath.endsWith(".liquid") || relPath.endsWith(".html"))
        contentType = "text/html";
      else if (relPath.endsWith(".webp")) contentType = "image/webp";
      else if (relPath.endsWith(".png")) contentType = "image/png";
      else if (relPath.endsWith(".jpg") || relPath.endsWith(".jpeg"))
        contentType = "image/jpeg";
      else if (relPath.endsWith(".svg")) contentType = "image/svg+xml";

      await this.storageProvider.put({
        key,
        body: buffer,
        contentType,
      });
      fileList.push(relPath);
    }

    // Save index manifest for fast listing
    const indexKey = `${root}/__files.json`;
    await this.storageProvider.put({
      key: indexKey,
      body: Buffer.from(JSON.stringify(fileList)),
      contentType: "application/json",
    });

    return root;
  }

  async getThemeFile(
    themeId: string,
    version: string,
    relativePath: string,
  ): Promise<Buffer | null> {
    const key = this.getObjectKey(themeId, version, relativePath);
    const exists = await this.storageProvider.exists(key);
    if (!exists) return null;

    try {
      if (typeof (this.storageProvider as any).getObjectBuffer === "function") {
        return await (this.storageProvider as any).getObjectBuffer(key);
      }
      const url = await this.storageProvider.getUrl(key);
      const res = await fetch(url);
      if (res.ok) {
        const arr = await res.arrayBuffer();
        return Buffer.from(arr);
      }
      return null;
    } catch {
      return null;
    }
  }

  async listThemeFiles(themeId: string, version: string): Promise<string[]> {
    try {
      const fileBuffer = await this.getThemeFile(
        themeId,
        version,
        "__files.json",
      );
      if (fileBuffer) {
        return JSON.parse(fileBuffer.toString("utf-8"));
      }
    } catch {
      // Return empty file list if manifest not found or invalid
    }

    return [];
  }

  async getThemeFilesMap(
    themeId: string,
    version: string,
  ): Promise<Map<string, string>> {
    const files = await this.listThemeFiles(themeId, version);
    const map = new Map<string, string>();

    for (const f of files) {
      if (
        f.endsWith(".liquid") ||
        f.endsWith(".html") ||
        f.endsWith(".json") ||
        f.endsWith(".css") ||
        f.endsWith(".md") ||
        f.endsWith(".txt")
      ) {
        const buf = await this.getThemeFile(themeId, version, f);
        if (buf) {
          map.set(f, buf.toString("utf-8"));
        }
      }
    }

    return map;
  }

  async deleteThemeFiles(themeId: string, version: string): Promise<void> {
    const files = await this.listThemeFiles(themeId, version);
    const root = this.getThemeRootPath(themeId, version);

    for (const f of files) {
      const key = this.getObjectKey(themeId, version, f);
      await this.storageProvider.delete(key).catch(() => {});
    }

    await this.storageProvider.delete(`${root}/__files.json`).catch(() => {});
  }

  async themeExists(themeId: string, version: string): Promise<boolean> {
    const key = this.getObjectKey(themeId, version, "theme.json");
    return this.storageProvider.exists(key);
  }
}
