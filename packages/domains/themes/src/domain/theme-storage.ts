import fs from "node:fs";
import path from "node:path";

export interface ThemeStorageAdapter {
  saveThemeFiles(
    themeId: string,
    version: string,
    files: Map<string, Buffer>,
  ): Promise<string>;
  getThemeFile(
    themeId: string,
    version: string,
    relativePath: string,
  ): Promise<Buffer | null>;
  listThemeFiles(themeId: string, version: string): Promise<string[]>;
  getThemeFilesMap(
    themeId: string,
    version: string,
  ): Promise<Map<string, string>>;
  deleteThemeFiles(themeId: string, version: string): Promise<void>;
  themeExists(themeId: string, version: string): Promise<boolean>;
  getThemeRootPath(themeId: string, version: string): string;
}

export interface FileSystemThemeStorageOptions {
  storageRoot?: string;
}

export class FileSystemThemeStorageAdapter implements ThemeStorageAdapter {
  private storageRoot: string;

  constructor(options: FileSystemThemeStorageOptions = {}) {
    this.storageRoot = path.resolve(
      options.storageRoot || path.join(process.cwd(), "content", "themes"),
    );
  }

  getThemeRootPath(themeId: string, version: string): string {
    const cleanId = themeId.replace(/[^a-z0-9-]/g, "");
    const cleanVersion = version.replace(/[^0-9.]/g, "");
    return path.join(this.storageRoot, cleanId, cleanVersion);
  }

  async saveThemeFiles(
    themeId: string,
    version: string,
    files: Map<string, Buffer>,
  ): Promise<string> {
    const themeDir = this.getThemeRootPath(themeId, version);
    await fs.promises.mkdir(themeDir, { recursive: true });

    for (const [relPath, buffer] of files.entries()) {
      const fullPath = path.join(themeDir, relPath);
      const parentDir = path.dirname(fullPath);
      await fs.promises.mkdir(parentDir, { recursive: true });
      await fs.promises.writeFile(fullPath, buffer);
    }

    return path.relative(process.cwd(), themeDir);
  }

  async getThemeFile(
    themeId: string,
    version: string,
    relativePath: string,
  ): Promise<Buffer | null> {
    const themeDir = this.getThemeRootPath(themeId, version);
    const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const fullPath = path.join(themeDir, cleanRel);

    const relativeToTheme = path.relative(themeDir, fullPath);
    if (relativeToTheme.startsWith("..") || path.isAbsolute(relativeToTheme)) {
      return null;
    }

    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return await fs.promises.readFile(fullPath);
      }
      return null;
    } catch {
      return null;
    }
  }

  async listThemeFiles(themeId: string, version: string): Promise<string[]> {
    const themeDir = this.getThemeRootPath(themeId, version);
    if (!fs.existsSync(themeDir)) return [];

    const fileList: string[] = [];
    async function scan(dir: string, prefix = "") {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await scan(path.join(dir, entry.name), rel);
        } else if (entry.isFile()) {
          fileList.push(rel);
        }
      }
    }

    await scan(themeDir);
    return fileList;
  }

  async getThemeFilesMap(
    themeId: string,
    version: string,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const themeDir = this.getThemeRootPath(themeId, version);
    if (!fs.existsSync(themeDir)) return map;

    const files = await this.listThemeFiles(themeId, version);
    for (const f of files) {
      const fullPath = path.join(themeDir, f);
      try {
        const content = await fs.promises.readFile(fullPath, "utf-8");
        map.set(f, content);
      } catch {
        // binary files are stored but not converted to utf-8 text map
      }
    }

    return map;
  }

  async deleteThemeFiles(themeId: string, version: string): Promise<void> {
    const themeDir = this.getThemeRootPath(themeId, version);
    if (fs.existsSync(themeDir)) {
      await fs.promises.rm(themeDir, { recursive: true, force: true });
    }
    // Also remove parent folder if empty
    const parentDir = path.dirname(themeDir);
    try {
      if (fs.existsSync(parentDir)) {
        const remaining = await fs.promises.readdir(parentDir);
        if (remaining.length === 0) {
          await fs.promises.rmdir(parentDir);
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }

  async themeExists(themeId: string, version: string): Promise<boolean> {
    const themeDir = this.getThemeRootPath(themeId, version);
    return fs.existsSync(themeDir);
  }
}
