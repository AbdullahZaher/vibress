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

  async create(theme: InstalledTheme): Promise<InstalledTheme> {
    this.themes.set(theme.id, theme);
    return theme;
  }

  async update(theme: InstalledTheme): Promise<InstalledTheme> {
    this.themes.set(theme.id, theme);
    return theme;
  }

  async delete(themeId: string): Promise<void> {
    for (const [id, t] of this.themes.entries()) {
      if (t.themeId === themeId) {
        this.themes.delete(id);
      }
    }
  }
}

async function createMockThemeZip(
  files: Record<string, string | Buffer>,
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("Themes Domain — ThemeInstaller", () => {
  let storage: MemoryThemeStorageAdapter;
  let repo: MemoryInstalledThemeRepository;
  let installer: ThemeInstaller;

  const validManifest = JSON.stringify({
    id: "vibress-custom-pro",
    name: "Custom Pro",
    version: "1.0.0",
    description: "A custom pro theme",
    author: { name: "Pro Developer" },
    themeApi: 1,
    settingsSchemaVersion: 1,
  });

  const validSettings = JSON.stringify({
    fields: [{ key: "accentColor", type: "color", default: "#ff0055" }],
  });

  const minimalValidFiles = {
    "theme.json": validManifest,
    "settings.json": validSettings,
    "preview.webp": Buffer.from("fake-webp-bytes"),
    "templates/home.liquid": "<h1>{{ site.title }}</h1>",
    "templates/post.liquid": "<h1>{{ post.title }}</h1>",
    "templates/page.liquid": "<h1>{{ page.title }}</h1>",
    "assets/css/theme.css": "body { margin: 0; }",
  };

  beforeEach(() => {
    storage = new MemoryThemeStorageAdapter();
    repo = new MemoryInstalledThemeRepository();
    installer = new ThemeInstaller(storage, repo);
  });

  it("installs a valid theme from ZIP atomically", async () => {
    const zipBuffer = await createMockThemeZip(minimalValidFiles);
    const installed = await installer.installFromZip(zipBuffer, "actor-1");

    expect(installed.themeId).toBe("vibress-custom-pro");
    expect(installed.name).toBe("Custom Pro");
    expect(installed.version).toBe("1.0.0");
    expect(installed.author).toBe("Pro Developer");
    expect(installed.status).toBe("installed");
    expect(installed.isBuiltIn).toBe(false);

    // Verify persisted in storage
    const homeTemplate = await storage.getThemeFile(
      "vibress-custom-pro",
      "1.0.0",
      "templates/home.liquid",
    );
    expect(homeTemplate).not.toBeNull();
    expect(homeTemplate?.toString("utf-8")).toBe("<h1>{{ site.title }}</h1>");

    // Verify persisted in database repository
    const found = await repo.findByThemeId("vibress-custom-pro");
    expect(found).not.toBeNull();
    expect(found?.settingsSchema.accentColor.default).toBe("#ff0055");
  });

  it("updates existing installed theme when uploading a new version", async () => {
    const zipBufferV1 = await createMockThemeZip(minimalValidFiles);
    await installer.installFromZip(zipBufferV1, "actor-1");

    const v2Manifest = JSON.stringify({
      id: "vibress-custom-pro",
      name: "Custom Pro V2",
      version: "2.0.0",
      themeApi: 1,
      settingsSchemaVersion: 1,
    });

    const v2Files = {
      ...minimalValidFiles,
      "theme.json": v2Manifest,
      "templates/home.liquid": "<h1>V2 Home</h1>",
    };

    const zipBufferV2 = await createMockThemeZip(v2Files);
    const updated = await installer.installFromZip(zipBufferV2, "actor-1");

    expect(updated.themeId).toBe("vibress-custom-pro");
    expect(updated.name).toBe("Custom Pro V2");
    expect(updated.version).toBe("2.0.0");

    const list = await repo.listAll();
    expect(list).toHaveLength(1);
    expect(list[0]?.version).toBe("2.0.0");
  });
});
