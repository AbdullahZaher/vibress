import { describe, it, expect, beforeEach } from "vitest";
import JSZip from "jszip";
import { ThemeInstaller } from "../src/application/theme-installer";
import {
  InstalledTheme,
  InstalledThemeRepository,
} from "../src/domain/installed-theme";
import { ThemeStorageAdapter } from "../src/domain/theme-storage";

class MemoryThemeStorageAdapter implements ThemeStorageAdapter {
  files = new Map<string, Buffer>();

  getThemeRootPath(themeId: string, version: string): string {
    return `content/themes/${themeId}/${version}`;
  }

  async saveThemeFiles(
    themeId: string,
    version: string,
    files: Map<string, Buffer>,
  ): Promise<string> {
    for (const [p, buf] of files.entries()) {
      this.files.set(`${themeId}/${version}/${p}`, buf);
    }
    return `content/themes/${themeId}/${version}`;
  }

  async getThemeFile(
    themeId: string,
    version: string,
    relativePath: string,
  ): Promise<Buffer | null> {
    return this.files.get(`${themeId}/${version}/${relativePath}`) || null;
  }

  async listThemeFiles(themeId: string, version: string): Promise<string[]> {
    const prefix = `${themeId}/${version}/`;
    return Array.from(this.files.keys())
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.substring(prefix.length));
  }

  async getThemeFilesMap(
    themeId: string,
    version: string,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const prefix = `${themeId}/${version}/`;
    for (const [k, buf] of this.files.entries()) {
      if (k.startsWith(prefix)) {
        map.set(k.substring(prefix.length), buf.toString("utf-8"));
      }
    }
    return map;
  }

  async deleteThemeFiles(themeId: string, version: string): Promise<void> {
    const prefix = `${themeId}/${version}/`;
    for (const k of Array.from(this.files.keys())) {
      if (k.startsWith(prefix)) {
        this.files.delete(k);
      }
    }
  }

  async themeExists(themeId: string, version: string): Promise<boolean> {
    const prefix = `${themeId}/${version}/`;
    return Array.from(this.files.keys()).some((k) => k.startsWith(prefix));
  }
}

class MemoryInstalledThemeRepository implements InstalledThemeRepository {
  private themes = new Map<string, InstalledTheme>();
  private settings = new Map<string, Record<string, unknown>>();

  async listAll(): Promise<InstalledTheme[]> {
    return Array.from(this.themes.values());
  }

  async findById(id: string): Promise<InstalledTheme | null> {
    return this.themes.get(id) || null;
  }

  async findByThemeId(themeId: string): Promise<InstalledTheme | null> {
    for (const t of this.themes.values()) {
      if (t.themeId === themeId) return t;
    }
    return null;
  }

  async findByThemeIdAndVersion(
    themeId: string,
    version: string,
  ): Promise<InstalledTheme | null> {
    for (const t of this.themes.values()) {
      if (t.themeId === themeId && t.version === version) return t;
    }
    return null;
  }

  async listVersions(themeId: string): Promise<InstalledTheme[]> {
    return Array.from(this.themes.values()).filter((t) => t.themeId === themeId);
  }

  async create(theme: InstalledTheme): Promise<InstalledTheme> {
    this.themes.set(theme.id, theme);
    return theme;
  }

  async update(theme: InstalledTheme): Promise<InstalledTheme> {
    this.themes.set(theme.id, theme);
    return theme;
  }

  async delete(themeId: string): Promise<void> {
    for (const [id, t] of Array.from(this.themes.entries())) {
      if (t.themeId === themeId) {
        this.themes.delete(id);
      }
    }
  }

  async deleteVersion(themeId: string, version: string): Promise<void> {
    for (const [id, t] of Array.from(this.themes.entries())) {
      if (t.themeId === themeId && t.version === version) {
        this.themes.delete(id);
      }
    }
  }

  async getThemeSettings(themeId: string): Promise<Record<string, unknown> | null> {
    return this.settings.get(themeId) || null;
  }

  async saveThemeSettings(
    themeId: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    this.settings.set(themeId, settings);
  }
}

describe("Themes Domain — ThemeInstaller", () => {
  let storage: MemoryThemeStorageAdapter;
  let repository: MemoryInstalledThemeRepository;
  let installer: ThemeInstaller;

  beforeEach(() => {
    storage = new MemoryThemeStorageAdapter();
    repository = new MemoryInstalledThemeRepository();
    installer = new ThemeInstaller(storage, repository);
  });

  async function createValidZip(version = "1.0.0"): Promise<Buffer> {
    const zip = new JSZip();
    zip.file(
      "theme.json",
      JSON.stringify({
        id: "editorial-pro",
        name: "Editorial Pro",
        version,
        themeApi: 1,
        author: "Studio",
      }),
    );
    zip.file(
      "settings.json",
      JSON.stringify({
        fields: [
          {
            key: "accentColor",
            type: "color",
            default: "#3b82f6",
          },
        ],
      }),
    );
    zip.file("templates/home.liquid", "<h1>{{ site.title }}</h1>");
    zip.file("templates/post.liquid", "<h1>{{ post.title }}</h1>");
    zip.file("templates/page.liquid", "<h1>{{ page.title }}</h1>");
    zip.file("assets/css/theme.css", "body { margin: 0; }");
    return zip.generateAsync({ type: "nodebuffer" });
  }

  it("installs a valid theme from ZIP atomically", async () => {
    const zip = await createValidZip("1.0.0");
    const installed = await installer.installFromZip(zip, "user-1");

    expect(installed.themeId).toBe("editorial-pro");
    expect(installed.version).toBe("1.0.0");
    expect(installed.status).toBe("installed");
    expect(installed.author).toBe("Studio");

    const savedFiles = await storage.listThemeFiles("editorial-pro", "1.0.0");
    expect(savedFiles).toContain("theme.json");
    expect(savedFiles).toContain("templates/home.liquid");
    expect(savedFiles).toContain("assets/css/theme.css");

    const fromRepo = await repository.findByThemeId("editorial-pro");
    expect(fromRepo).not.toBeNull();
    expect(fromRepo?.name).toBe("Editorial Pro");
  });

  it("updates existing installed theme when uploading a new version", async () => {
    const zipV1 = await createValidZip("1.0.0");
    await installer.installFromZip(zipV1, "user-1");

    const zipV2 = await createValidZip("2.0.0");
    const updated = await installer.installFromZip(zipV2, "user-1");

    expect(updated.version).toBe("2.0.0");

    const versions = await repository.listVersions("editorial-pro");
    expect(versions).toHaveLength(2);
  });
});
