import JSZip from "jszip";
import {
  ThemeError,
  ThemeManifest,
  ThemeSettingsSchema,
  validateThemeManifest,
  validateThemeCompatibility,
  validateThemeSettingsSchema,
} from "./theme-core";

export const MAX_ZIP_BYTES = 20 * 1024 * 1024; // 20 MB archive upload limit
export const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024; // 100 MB total uncompressed limit
export const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB max per single file
export const MAX_FILE_COUNT = 500;
export const MAX_PATH_LENGTH = 255;
export const MAX_COMPRESSION_RATIO = 20;

// Theme API v1 Allowlist — Presentation assets only (No arbitrary server/client JavaScript)
export const ALLOWED_EXTENSIONS = new Set([
  ".liquid",
  ".html",
  ".css",
  ".json",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".ico",
  ".txt",
  ".md",
]);

export const FORBIDDEN_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".hbs",
  ".exe",
  ".sh",
  ".bat",
  ".cmd",
  ".py",
  ".php",
  ".rb",
  ".jar",
  ".wasm",
  ".so",
  ".dll",
  ".bin",
  ".env",
  ".yml",
  ".yaml",
  ".node",
]);

export interface ExtractedThemePackage {
  manifest: ThemeManifest;
  settingsSchema: ThemeSettingsSchema;
  files: Map<string, Buffer>;
  previewImageBuffer?: Buffer | undefined;
}

export class ThemeZipError extends ThemeError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ThemeZipError";
  }
}

export function validateThemePath(relativePath: string): void {
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    relativePath.includes("..") ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\") ||
    relativePath.includes(":") ||
    relativePath.length > MAX_PATH_LENGTH
  ) {
    throw new ThemeZipError(
      "THEME_ZIP_SLIP_DETECTED",
      `Dangerous or invalid path in archive: ${relativePath}`,
    );
  }
}

export async function validateAndExtractThemeZip(
  buffer: Buffer | Uint8Array,
): Promise<ExtractedThemePackage> {
  const byteLength = buffer.byteLength || buffer.length;
  if (byteLength === 0) {
    throw new ThemeZipError("THEME_ZIP_EMPTY", "Theme archive is empty");
  }

  if (byteLength > MAX_ZIP_BYTES) {
    throw new ThemeZipError(
      "THEME_ZIP_TOO_LARGE",
      `Theme archive exceeds max size of ${MAX_ZIP_BYTES / (1024 * 1024)}MB`,
    );
  }

  // Magic bytes check: PK\x03\x04
  if (
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    throw new ThemeZipError(
      "THEME_ZIP_INVALID",
      "File is not a valid ZIP archive",
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch (err) {
    throw new ThemeZipError(
      "THEME_ZIP_CORRUPT",
      `Failed to parse ZIP archive: ${(err as Error).message}`,
    );
  }

  const entries = Object.keys(zip.files);
  if (entries.length === 0) {
    throw new ThemeZipError("THEME_ZIP_EMPTY", "ZIP archive contains no files");
  }

  if (entries.length > MAX_FILE_COUNT) {
    throw new ThemeZipError(
      "THEME_ZIP_TOO_MANY_FILES",
      `ZIP contains ${entries.length} files, exceeding limit of ${MAX_FILE_COUNT}`,
    );
  }

  // Check if archive has a single top-level folder wrapper
  const nonDirectoryEntries = entries.filter((e) => !zip.files[e]?.dir);
  let prefixToStrip = "";

  const rootFiles = nonDirectoryEntries.filter((e) => !e.includes("/"));
  if (rootFiles.length === 0) {
    const topLevels = new Set(entries.map((e) => e.split("/")[0]));
    if (topLevels.size === 1) {
      prefixToStrip = Array.from(topLevels)[0] + "/";
    }
  }

  const files = new Map<string, Buffer>();
  let totalUncompressedBytes = 0;

  for (const entryName of entries) {
    const entry = zip.files[entryName];
    if (!entry || entry.dir) continue;

    // Check for symlinks in zip metadata
    const unixPermissions = (entry as any).unixPermissions;
    if (unixPermissions && (unixPermissions & 0o170000) === 0o120000) {
      throw new ThemeZipError(
        "THEME_ZIP_SYMLINK_FORBIDDEN",
        `Symlinks are forbidden in theme archive: ${entryName}`,
      );
    }

    let relativePath = entryName;
    if (prefixToStrip && relativePath.startsWith(prefixToStrip)) {
      relativePath = relativePath.slice(prefixToStrip.length);
    }

    // Skip OS junk files (__MACOSX, .DS_Store, Thumbs.db)
    if (
      relativePath.startsWith("__MACOSX/") ||
      relativePath.includes("/__MACOSX/") ||
      relativePath.endsWith(".DS_Store") ||
      relativePath.endsWith("Thumbs.db")
    ) {
      continue;
    }

    validateThemePath(relativePath);

    // Extension security check
    const lastDot = relativePath.lastIndexOf(".");
    const ext = lastDot !== -1 ? relativePath.slice(lastDot).toLowerCase() : "";

    if (FORBIDDEN_EXTENSIONS.has(ext)) {
      throw new ThemeZipError(
        "THEME_FORBIDDEN_FILE_TYPE",
        `Theme archive contains prohibited executable or script file: ${relativePath}`,
      );
    }

    if (!ALLOWED_EXTENSIONS.has(ext) && ext !== "") {
      throw new ThemeZipError(
        "THEME_INVALID_FILE_EXTENSION",
        `File extension "${ext}" is not permitted in Theme API v1 packages: ${relativePath}`,
      );
    }

    // Check entry header uncompressed size if available
    const uncompressedSizeHeader = (entry as any)._data?.uncompressedSize;
    if (
      typeof uncompressedSizeHeader === "number" &&
      uncompressedSizeHeader > MAX_SINGLE_FILE_BYTES
    ) {
      throw new ThemeZipError(
        "THEME_FILE_TOO_LARGE",
        `File ${relativePath} size (${uncompressedSizeHeader} bytes) exceeds single file limit of ${MAX_SINGLE_FILE_BYTES / (1024 * 1024)}MB`,
      );
    }

    // Read with bounded chunks to prevent unbounded in-memory decompression
    const chunks: Buffer[] = [];
    let fileBytesRead = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = entry.nodeStream();
      stream.on("data", (chunk: Buffer) => {
        fileBytesRead += chunk.length;
        if (fileBytesRead > MAX_SINGLE_FILE_BYTES) {
          (stream as any).destroy?.(
            new ThemeZipError(
              "THEME_FILE_TOO_LARGE",
              `File ${relativePath} size (${fileBytesRead} bytes) exceeds single file limit of ${MAX_SINGLE_FILE_BYTES / (1024 * 1024)}MB`,
            ),
          );
          return;
        }
        if (totalUncompressedBytes + fileBytesRead > MAX_EXTRACTED_BYTES) {
          (stream as any).destroy?.(
            new ThemeZipError(
              "THEME_ZIP_BOMB_DETECTED",
              `Extracted size exceeds max limit of ${MAX_EXTRACTED_BYTES / (1024 * 1024)}MB`,
            ),
          );
          return;
        }
        if (
          byteLength > 0 &&
          (totalUncompressedBytes + fileBytesRead) / byteLength >
            MAX_COMPRESSION_RATIO
        ) {
          (stream as any).destroy?.(
            new ThemeZipError(
              "THEME_ZIP_BOMB_DETECTED",
              `Archive compression ratio exceeds allowed threshold of ${MAX_COMPRESSION_RATIO}:1`,
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => resolve());
      stream.on("error", (err) => reject(err));
    });

    const fileBuffer = Buffer.concat(chunks);
    const fileSize = fileBuffer.length;
    totalUncompressedBytes += fileSize;

    files.set(relativePath, fileBuffer);
  }

  // 1. Validate theme.json manifest
  const manifestBuffer = files.get("theme.json");
  if (!manifestBuffer) {
    throw new ThemeZipError(
      "THEME_MANIFEST_MISSING",
      "Theme archive is missing required theme.json manifest",
    );
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestBuffer.toString("utf-8"));
  } catch {
    throw new ThemeZipError(
      "THEME_MANIFEST_INVALID_JSON",
      "theme.json is not valid JSON",
    );
  }

  const manifest = validateThemeManifest(rawManifest);
  validateThemeCompatibility(manifest);

  // Validate declared previewImage exists if specified
  if (manifest.previewImage) {
    const cleanPreview = manifest.previewImage.replace(/^\/+/, "");
    if (!files.has(cleanPreview)) {
      throw new ThemeZipError(
        "THEME_PREVIEW_IMAGE_MISSING",
        `Declared previewImage "${manifest.previewImage}" does not exist in theme package`,
      );
    }
  }

  // 2. Validate settings schema with strict runtime validator
  let settingsSchema: ThemeSettingsSchema = {};
  const settingsBuffer = files.get("settings.json");
  if (settingsBuffer) {
    let rawSettings: unknown;
    try {
      rawSettings = JSON.parse(settingsBuffer.toString("utf-8"));
    } catch {
      throw new ThemeZipError(
        "THEME_SETTINGS_INVALID_JSON",
        "settings.json is not valid JSON",
      );
    }

    try {
      const fieldsInput =
        rawSettings && typeof rawSettings === "object" && "fields" in (rawSettings as any)
          ? (rawSettings as any).fields
          : rawSettings;
      settingsSchema = validateThemeSettingsSchema(fieldsInput);
    } catch (schemaErr) {
      throw new ThemeZipError(
        "THEME_SETTINGS_SCHEMA_INVALID",
        `Invalid settings.json schema: ${(schemaErr as Error).message}`,
      );
    }
  } else if ((rawManifest as any).settingsSchema) {
    try {
      settingsSchema = validateThemeSettingsSchema((rawManifest as any).settingsSchema);
    } catch (schemaErr) {
      throw new ThemeZipError(
        "THEME_SETTINGS_SCHEMA_INVALID",
        `Invalid manifest settingsSchema: ${(schemaErr as Error).message}`,
      );
    }
  }

  // 3. Validate required templates (Liquid templates only)
  const templateFiles = Array.from(files.keys()).filter((f) =>
    f.startsWith("templates/"),
  );

  const hasHome = templateFiles.some((f) =>
    /^templates\/(home|index)\.(liquid|html)$/i.test(f),
  );
  const hasPost = templateFiles.some((f) =>
    /^templates\/post\.(liquid|html)$/i.test(f),
  );
  const hasPage = templateFiles.some((f) =>
    /^templates\/page\.(liquid|html)$/i.test(f),
  );

  const missingTemplates: string[] = [];
  if (!hasHome) missingTemplates.push("templates/home.liquid (or index.liquid)");
  if (!hasPost) missingTemplates.push("templates/post.liquid");
  if (!hasPage) missingTemplates.push("templates/page.liquid");

  if (missingTemplates.length > 0) {
    throw new ThemeZipError(
      "THEME_TEMPLATES_MISSING",
      `Theme is missing required template files: ${missingTemplates.join(", ")}`,
    );
  }

  let previewImageBuffer: Buffer | undefined = undefined;
  if (manifest.previewImage && files.has(manifest.previewImage)) {
    previewImageBuffer = files.get(manifest.previewImage);
  } else if (files.has("preview.webp")) {
    previewImageBuffer = files.get("preview.webp");
  } else if (files.has("preview.png")) {
    previewImageBuffer = files.get("preview.png");
  } else if (files.has("preview.jpg")) {
    previewImageBuffer = files.get("preview.jpg");
  }

  return {
    manifest,
    settingsSchema,
    files,
    previewImageBuffer,
  };
}
