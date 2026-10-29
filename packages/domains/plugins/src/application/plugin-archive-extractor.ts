import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import JSZip from "jszip";

export const DEFAULT_MAX_ARCHIVE_BYTES = 20 * 1024 * 1024; // 20 MiB archive size limit
export const DEFAULT_MAX_UNCOMPRESSED_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MiB total uncompressed
export const DEFAULT_MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB per single file
export const DEFAULT_MAX_FILES_COUNT = 500;
export const DEFAULT_MAX_COMPRESSION_RATIO = 50;

export const FORBIDDEN_EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".sh",
  ".bat",
  ".cmd",
  ".ps1",
  ".elf",
  ".bin",
  ".vbs",
  ".py",
  ".php",
  ".rb",
]);

export const ALLOWED_PLUGIN_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".html",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ico",
  ".md",
  ".txt",
  ".map",
]);

export interface ArchiveExtractorOptions {
  readonly maxArchiveBytes?: number | undefined;
  readonly maxUncompressedTotalBytes?: number | undefined;
  readonly maxSingleFileBytes?: number | undefined;
  readonly maxFilesCount?: number | undefined;
  readonly maxCompressionRatio?: number | undefined;
  readonly expectedSha256?: string | undefined;
}

export interface ExtractedArchiveResult {
  readonly stagingPath: string;
  readonly totalFiles: number;
  readonly totalUncompressedBytes: number;
  readonly archiveSha256: string;
  readonly manifestContent: string;
}

export class ArchiveExtractionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ArchiveExtractionError";
  }
}

/**
 * Normalizes entry path and ensures no directory traversal, null bytes, or Windows drive prefixes.
 */
export function sanitizePluginEntryPath(entryName: string): string {
  if (entryName.includes("\0")) {
    throw new ArchiveExtractionError("PATH_NULL_BYTE", "Archive entry path contains null byte");
  }

  // Normalize separators
  const normalized = entryName.replace(/\\/g, "/");

  // Prevent Windows absolute drive letters (e.g. C:/)
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new ArchiveExtractionError("PATH_ABSOLUTE_DRIVE", `Drive-relative paths forbidden: ${entryName}`);
  }

  // Prevent absolute paths
  if (normalized.startsWith("/")) {
    throw new ArchiveExtractionError("PATH_ABSOLUTE", `Absolute paths forbidden: ${entryName}`);
  }

  // Prevent directory traversal
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new ArchiveExtractionError("PATH_TRAVERSAL", `Path traversal segment '..' detected: ${entryName}`);
    }
  }

  return path.normalize(normalized);
}

/**
 * Extracts and stages a plugin archive in an isolated quarantine directory with strict security limits.
 */
export async function extractPluginArchiveToStaging(
  archiveBuffer: Buffer,
  quarantineStagingDir: string,
  options?: ArchiveExtractorOptions,
): Promise<ExtractedArchiveResult> {
  const maxArchiveBytes = options?.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  const maxUncompressed = options?.maxUncompressedTotalBytes ?? DEFAULT_MAX_UNCOMPRESSED_TOTAL_BYTES;
  const maxSingleFile = options?.maxSingleFileBytes ?? DEFAULT_MAX_SINGLE_FILE_BYTES;
  const maxFiles = options?.maxFilesCount ?? DEFAULT_MAX_FILES_COUNT;
  const maxRatio = options?.maxCompressionRatio ?? DEFAULT_MAX_COMPRESSION_RATIO;

  // 1. Check archive byte size
  if (archiveBuffer.length > maxArchiveBytes) {
    throw new ArchiveExtractionError(
      "ARCHIVE_TOO_LARGE",
      `Archive buffer length ${archiveBuffer.length} exceeds limit of ${maxArchiveBytes} bytes`,
    );
  }

  // 2. Validate checksum if expectedSha256 provided
  const computedSha256 = createHash("sha256").update(archiveBuffer).digest("hex");
  if (options?.expectedSha256 && options.expectedSha256.toLowerCase() !== computedSha256.toLowerCase()) {
    throw new ArchiveExtractionError(
      "ARCHIVE_CHECKSUM_MISMATCH",
      `Archive checksum mismatch. Expected: ${options.expectedSha256}, Got: ${computedSha256}`,
    );
  }

  // 3. Load ZIP structure
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archiveBuffer);
  } catch (err: unknown) {
    throw new ArchiveExtractionError("ARCHIVE_CORRUPTED", `Failed to parse ZIP archive: ${(err as Error).message}`);
  }

  const entries = Object.values(zip.files);
  if (entries.length === 0) {
    throw new ArchiveExtractionError("ARCHIVE_EMPTY", "Archive contains no files");
  }

  if (entries.length > maxFiles) {
    throw new ArchiveExtractionError(
      "ARCHIVE_TOO_MANY_FILES",
      `Archive entry count ${entries.length} exceeds limit of ${maxFiles}`,
    );
  }

  let totalBytes = 0;
  let manifestText: string | null = null;
  const filesToExtract: Array<{ safeRelativePath: string; data: Buffer }> = [];

  for (const entry of entries) {
    if (entry.dir) continue;

    const safeRelativePath = sanitizePluginEntryPath(entry.name);
    const ext = path.extname(safeRelativePath).toLowerCase();

    // Check executable ban
    if (FORBIDDEN_EXECUTABLE_EXTENSIONS.has(ext)) {
      throw new ArchiveExtractionError(
        "ARCHIVE_FORBIDDEN_FILE_TYPE",
        `Archive contains forbidden executable file type '${ext}': ${entry.name}`,
      );
    }

    // Check allowlist
    if (ext && !ALLOWED_PLUGIN_EXTENSIONS.has(ext)) {
      throw new ArchiveExtractionError(
        "ARCHIVE_DISALLOWED_EXTENSION",
        `Archive contains disallowed file extension '${ext}': ${entry.name}`,
      );
    }

    // Read file buffer
    const buf = await entry.async("nodebuffer");
    if (buf.length > maxSingleFile) {
      throw new ArchiveExtractionError(
        "FILE_TOO_LARGE",
        `File ${entry.name} exceeds single file size limit (${buf.length} > ${maxSingleFile})`,
      );
    }

    totalBytes += buf.length;
    if (totalBytes > maxUncompressed) {
      throw new ArchiveExtractionError(
        "ARCHIVE_DECOMPRESSION_BOMB",
        `Total uncompressed bytes ${totalBytes} exceeds limit of ${maxUncompressed}`,
      );
    }

    // Decompression ratio check
    const ratio = totalBytes / Math.max(archiveBuffer.length, 1);
    if (ratio > maxRatio) {
      throw new ArchiveExtractionError(
        "ARCHIVE_DECOMPRESSION_BOMB",
        `Decompression ratio ${ratio.toFixed(1)}:1 exceeds safety limit of ${maxRatio}:1`,
      );
    }

    // Detect manifest.json or plugin.json at root
    if (safeRelativePath === "manifest.json" || safeRelativePath === "plugin.json") {
      manifestText = buf.toString("utf8");
    }

    filesToExtract.push({ safeRelativePath, data: buf });
  }

  if (!manifestText) {
    throw new ArchiveExtractionError(
      "ARCHIVE_MISSING_MANIFEST",
      "Archive must contain a root 'manifest.json' or 'plugin.json'",
    );
  }

  // 4. Extract into target directory atomically
  await mkdir(quarantineStagingDir, { recursive: true });

  for (const file of filesToExtract) {
    const destPath = path.resolve(quarantineStagingDir, file.safeRelativePath);
    if (!destPath.startsWith(path.resolve(quarantineStagingDir) + path.sep)) {
      throw new ArchiveExtractionError("PATH_TRAVERSAL", `Path escapes staging boundary: ${file.safeRelativePath}`);
    }
    // Ensure parent dir exists
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, file.data, { mode: 0o644 });
  }

  return {
    stagingPath: quarantineStagingDir,
    totalFiles: filesToExtract.length,
    totalUncompressedBytes: totalBytes,
    archiveSha256: computedSha256,
    manifestContent: manifestText,
  };
}
