import JSZip from "jszip";
import {
  ThemeError,
  ThemeManifest,
  ThemeSettingsSchema,
  validateThemeManifest,
  validateThemeCompatibility,
} from "./theme-core";

export const MAX_ZIP_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_FILE_COUNT = 500;
export const MAX_PATH_LENGTH = 255;
export const MAX_COMPRESSION_RATIO = 20;

export const ALLOWED_EXTENSIONS = new Set([
  ".liquid",
  ".hbs",
  ".html",
  ".css",
  ".js",
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
  ".ts",
  ".tsx",
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
  ".mjs",
  ".cjs",
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
    zip = await JSZip.loadAsync(buffer);
  } catch (err: unknown) {
    throw new ThemeZipError(
      "THEME_ZIP_CORRUPT",
      `Failed to parse ZIP archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const entries = Object.values(zip.files);
  if (entries.length === 0) {
    throw new ThemeZipError("THEME_ZIP_EMPTY", "Theme archive contains no files");
  }

  if (entries.length > MAX_FILE_COUNT) {
    throw new ThemeZipError(
      "THEME_ZIP_TOO_MANY_FILES",
      `Theme archive contains ${entries.length} files, exceeding limit of ${MAX_FILE_COUNT}`,
    );
  }

  let totalUncompressedBytes = 0;
  const files = new Map<string, Buffer>();

  // Determine if there is a common root folder in the zip (e.g. theme-name/theme.json)
  const nonDirEntries = entries.filter((e) => !e.dir);
  let rootPrefix = "";
  const firstManifest = nonDirEntries.find((e) =>
    e.name.endsWith("theme.json") || e.name === "theme.json",
  );

  if (firstManifest && firstManifest.name.includes("/")) {
    rootPrefix = firstManifest.name.substring(
      0,
      firstManifest.name.indexOf("theme.json"),
    );
  }

  for (const entry of entries) {
    if (entry.dir) continue;

    // Check raw entry name first for path traversal
    validateThemePath(entry.name);

    let relativePath = entry.name;
    if (rootPrefix && relativePath.startsWith(rootPrefix)) {
      relativePath = relativePath.substring(rootPrefix.length);
    }

    // Sanitize path
    relativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");

    // Path checks: Zip Slip detection
    validateThemePath(relativePath);

    // Ignore OS metadata files
    if (
      relativePath.startsWith("__MACOSX/") ||
      relativePath.endsWith(".DS_Store") ||
      relativePath.endsWith("Thumbs.db")
    ) {
      continue;
    }

    // Extension check
    const dotIndex = relativePath.lastIndexOf(".");
    const ext = dotIndex !== -1 ? relativePath.substring(dotIndex).toLowerCase() : "";

    if (FORBIDDEN_EXTENSIONS.has(ext)) {
      throw new ThemeZipError(
        "THEME_SECURITY_VIOLATION",
        `Theme contains forbidden executable or server code file: ${relativePath}`,
      );
    }

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new ThemeZipError(
        "THEME_FILE_TYPE_NOT_ALLOWED",
        `Theme file type not allowed: ${relativePath} (${ext})`,
      );
    }

    // Read file buffer
    const fileBuffer = await entry.async("nodebuffer");
    const fileSize = fileBuffer.length;

    totalUncompressedBytes += fileSize;
    if (totalUncompressedBytes > MAX_EXTRACTED_BYTES) {
      throw new ThemeZipError(
        "THEME_ZIP_BOMB_DETECTED",
        `Extracted size exceeds max limit of ${MAX_EXTRACTED_BYTES / (1024 * 1024)}MB`,
      );
    }

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

  // 2. Validate settings schema
  let settingsSchema: ThemeSettingsSchema = {};
  const settingsBuffer = files.get("settings.json");
  if (settingsBuffer) {
    try {
      const rawSettings = JSON.parse(settingsBuffer.toString("utf-8"));
      if (rawSettings && typeof rawSettings === "object") {
        if (rawSettings.fields && Array.isArray(rawSettings.fields)) {
          // Convert array format to schema map
          for (const field of rawSettings.fields) {
            if (field.key && field.type) {
              settingsSchema[field.key] = field;
            }
          }
        } else if (rawSettings.fields && typeof rawSettings.fields === "object") {
          settingsSchema = rawSettings.fields;
        } else {
          settingsSchema = rawSettings as ThemeSettingsSchema;
        }
      }
    } catch {
      throw new ThemeZipError(
        "THEME_SETTINGS_INVALID_JSON",
        "settings.json is not valid JSON",
      );
    }
  } else if ((rawManifest as any).settingsSchema) {
    settingsSchema = (rawManifest as any).settingsSchema;
  }

  // Ensure all setting definitions have default values
  for (const [key, def] of Object.entries(settingsSchema)) {
    if (def.default === undefined) {
      throw new ThemeZipError(
        "THEME_SETTINGS_DEFAULT_MISSING",
        `Theme setting "${key}" is missing mandatory default value`,
      );
    }
  }

  // 3. Validate required templates
  const templateFiles = Array.from(files.keys()).filter((f) =>
    f.startsWith("templates/"),
  );

  const hasHome = templateFiles.some((f) =>
    /^templates\/(home|index)\.(liquid|hbs|html)$/i.test(f),
  );
  const hasPost = templateFiles.some((f) =>
    /^templates\/post\.(liquid|hbs|html)$/i.test(f),
  );
  const hasPage = templateFiles.some((f) =>
    /^templates\/page\.(liquid|hbs|html)$/i.test(f),
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
