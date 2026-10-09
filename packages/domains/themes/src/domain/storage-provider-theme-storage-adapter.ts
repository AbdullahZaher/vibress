import { StorageProvider } from "@vibress/storage-core";
import { ThemeStorageAdapter } from "./theme-storage";

export class StorageProviderThemeStorageAdapter implements ThemeStorageAdapter {
  constructor(
    private storageProvider: StorageProvider,
    private prefix: string = "themes",
  ) {}

  getThemeRootPath(
    themeId: string,
    version: string,
    publicationId = "pub_default",
  ): string {
    const cleanId = themeId.replace(/[^a-z0-9-]/g, "");
    const cleanVersion = version.replace(/[^0-9.]/g, "");
    const cleanPublicationId = publicationId.replace(/[^a-zA-Z0-9_-]/g, "");
    if (publicationId === "pub_default") {
      return `${this.prefix}/${cleanId}/${cleanVersion}`;
    }
    return `${this.prefix}/publications/${cleanPublicationId}/${cleanId}/${cleanVersion}`;
  }

  private getLegacyThemeRootPath(themeId: string, version: string): string {
    const cleanId = themeId.replace(/[^a-z0-9-]/g, "");
    const cleanVersion = version.replace(/[^0-9.]/g, "");
    return `${this.prefix}/${cleanId}/${cleanVersion}`;
  }

  private getObjectKey(
    themeId: string,
    version: string,
    relativePath: string,
    publicationId = "pub_default",
  ): string {
    const root = this.getThemeRootPath(themeId, version, publicationId);
    const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return `${root}/${cleanRel}`;
  }

  async saveThemeFiles(
    themeId: string,
    version: string,
    files: Map<string, Buffer>,
    publicationId = "pub_default",
  ): Promise<string> {
    const root = this.getThemeRootPath(themeId, version, publicationId);
    const fileList: string[] = [];

    for (const [relPath, buffer] of files.entries()) {
      const key = this.getObjectKey(themeId, version, relPath, publicationId);
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
    publicationId = "pub_default",
  ): Promise<Buffer | null> {
    let key = this.getObjectKey(
      themeId,
      version,
      relativePath,
      publicationId,
    );
    let exists = await this.storageProvider.exists(key);
    if (!exists && publicationId !== "pub_default") {
      const legacyRoot = this.getLegacyThemeRootPath(themeId, version);
      const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
      key = `${legacyRoot}/${cleanRel}`;
      exists = await this.storageProvider.exists(key);
    }
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

  async listThemeFiles(
    themeId: string,
    version: string,
    publicationId = "pub_default",
  ): Promise<string[]> {
    try {
      const fileBuffer = await this.getThemeFile(
        themeId,
        version,
        "__files.json",
        publicationId,
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
    publicationId = "pub_default",
  ): Promise<Map<string, string>> {
    const files = await this.listThemeFiles(themeId, version, publicationId);
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
        const buf = await this.getThemeFile(
          themeId,
          version,
          f,
          publicationId,
        );
        if (buf) {
          map.set(f, buf.toString("utf-8"));
        }
      }
    }

    return map;
  }

  async deleteThemeFiles(
    themeId: string,
    version: string,
    publicationId = "pub_default",
  ): Promise<void> {
    const root = this.getThemeRootPath(themeId, version, publicationId);
    const files = await this.listThemeFiles(themeId, version, publicationId);

    for (const f of files) {
      const key = this.getObjectKey(themeId, version, f, publicationId);
      await this.storageProvider.delete(key).catch(() => {});
    }

    await this.storageProvider.delete(`${root}/__files.json`).catch(() => {});
  }

  async themeExists(
    themeId: string,
    version: string,
    publicationId = "pub_default",
  ): Promise<boolean> {
    const key = this.getObjectKey(
      themeId,
      version,
      "theme.json",
      publicationId,
    );
    if (await this.storageProvider.exists(key)) return true;
    if (publicationId !== "pub_default") {
      const legacyKey = `${this.getLegacyThemeRootPath(themeId, version)}/theme.json`;
      return this.storageProvider.exists(legacyKey);
    }
    return false;
  }
}
