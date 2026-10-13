import { validateAndExtractThemeZip, ThemeError } from "@vibress/theme-core";
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
    publicationId?: string,
  ): Promise<InstalledTheme> {
    const pubId = publicationId || "pub_default";
    // 1. Validate archive, manifest, settings, and templates
    const extracted = await validateAndExtractThemeZip(zipBuffer);
    const { manifest, settingsSchema, files } = extracted;

    // Legacy 0031 upgrades still reference pub_default's physical package
    // from other publications until they install their own scoped copy.
    // Do not overwrite shared files, even for an identical theme version.
    const existingVersion = await this.repository.findByThemeIdAndVersion(
      manifest.id,
      manifest.version,
      pubId,
    );
    if (
      pubId === "pub_default" &&
      existingVersion &&
      (await this.repository.hasOtherPublicationStorageReferences(
        manifest.id,
        manifest.version,
        existingVersion.storagePath,
        pubId,
      ))
    ) {
      throw new ThemeError(
        "THEME_SHARED_LEGACY_STORAGE",
        "This legacy theme version is still used by other publications. Install their own scoped copies before replacing it.",
      );
    }

    // 2. Atomically persist files into theme storage adapter
    const storagePath = await this.storage.saveThemeFiles(
      manifest.id,
      manifest.version,
      files,
      pubId,
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

    if (existingVersion) {
      const updated: InstalledTheme = {
        ...existingVersion,
        publicationId: pubId,
        name: manifest.name,
        version: manifest.version,
        themeApiVersion: manifest.themeApi,
        description: manifest.description ?? null,
        author: authorDisplay ?? null,
        previewImage: previewImage ?? null,
        manifest,
        settingsSchema,
        storagePath,
        updatedAt: new Date(),
      };
      return this.repository.update(updated, pubId);
    }

    const newTheme: InstalledTheme = {
      id: crypto.randomUUID(),
      publicationId: pubId,
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

    return this.repository.create(newTheme, pubId);
  }
}
