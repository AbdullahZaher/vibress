import {
  validateAndExtractThemeZip,
  ThemeManifest,
  ThemeSettingsSchema,
} from "@vibress/theme-core";
import { ThemeStorageAdapter } from "../domain/theme-storage";
import {
  InstalledTheme,
  InstalledThemeRepository,
} from "../domain/installed-theme";
import crypto from "node:crypto";

export class ThemeInstaller {
  constructor(
    private storage: ThemeStorageAdapter,
    private repository: InstalledThemeRepository,
  ) {}

  async installFromZip(
    zipBuffer: Buffer,
    _actorId?: string | null,
  ): Promise<InstalledTheme> {
    // 1. Validate archive, manifest, settings, and templates
    const extracted = await validateAndExtractThemeZip(zipBuffer);
    const { manifest, settingsSchema, files } = extracted;

    // 2. Atomically persist files into theme storage adapter
    const storagePath = await this.storage.saveThemeFiles(
      manifest.id,
      manifest.version,
      files,
    );

    // Format author string for display
    let authorDisplay: string | undefined = undefined;
    if (typeof manifest.author === "string") {
      authorDisplay = manifest.author;
    } else if (manifest.author && typeof manifest.author === "object") {
      authorDisplay = manifest.author.name;
    }

    // Determine preview image url or asset path
    let previewImage: string | undefined = undefined;
    if (manifest.previewImage) {
      previewImage = `/theme-assets/${manifest.id}/${manifest.version}/${manifest.previewImage.replace(/^\/+/, "")}`;
    } else if (files.has("preview.webp")) {
      previewImage = `/theme-assets/${manifest.id}/${manifest.version}/preview.webp`;
    } else if (files.has("preview.png")) {
      previewImage = `/theme-assets/${manifest.id}/${manifest.version}/preview.png`;
    } else if (files.has("preview.jpg")) {
      previewImage = `/theme-assets/${manifest.id}/${manifest.version}/preview.jpg`;
    }

    const existing = await this.repository.findByThemeId(manifest.id);
    if (existing) {
      const updated: InstalledTheme = {
        ...existing,
        name: manifest.name,
        version: manifest.version,
        themeApiVersion: manifest.themeApi,
        description: manifest.description ?? null,
        author: authorDisplay ?? null,
        previewImage: previewImage ?? null,
        manifest,
        settingsSchema,
        storagePath,
        status: "installed",
        updatedAt: new Date(),
      };
      return this.repository.update(updated);
    }

    const newTheme: InstalledTheme = {
      id: crypto.randomUUID(),
      themeId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      themeApiVersion: manifest.themeApi,
      description: manifest.description ?? null,
      author: authorDisplay ?? null,
      previewImage: previewImage ?? null,
      manifest,
      settingsSchema,
      storagePath,
      status: "installed",
      isBuiltIn: false,
      installedAt: new Date(),
      updatedAt: new Date(),
    };

    return this.repository.create(newTheme);
  }
}
