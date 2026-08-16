import crypto from "crypto";
import {
  AssetType,
  DEFAULT_MEDIA_LIMITS,
  MediaLimitsConfig,
  UploadMediaInput,
} from "./asset";
import {
  MediaInvalidFileError,
  MediaMimeMismatchError,
  MediaTypeNotAllowedError,
  MediaTooLargeError,
} from "./errors";

export interface ValidatedFileResult {
  originalFilename: string;
  displayName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  checksum: string;
  assetType: AssetType;
  width: number | null;
  height: number | null;
}

const DANGEROUS_EXTENSIONS = new Set([
  "exe",
  "dll",
  "bat",
  "cmd",
  "sh",
  "php",
  "pl",
  "py",
  "rb",
  "js",
  "cjs",
  "mjs",
  "html",
  "htm",
  "xhtml",
  "svg",
  "xml",
  "app",
  "vbs",
  "ps1",
  "jar",
  "scr",
  "msi",
]);

const DANGEROUS_MIMES = new Set([
  "application/x-executable",
  "application/x-sh",
  "application/x-msdownload",
  "application/x-msdos-program",
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-php",
]);

const ALLOWED_IMAGE_MIMES = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

const ALLOWED_VIDEO_MIMES = new Map<string, string>([
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
]);

const ALLOWED_AUDIO_MIMES = new Map<string, string>([
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/mp4", "mp4"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
]);

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function sanitizeFilename(rawFilename: string): {
  sanitizedFilename: string;
  extension: string;
} {
  if (!rawFilename || typeof rawFilename !== "string") {
    throw new MediaInvalidFileError("Filename must be a non-empty string");
  }

  // Remove null bytes & control chars
  // eslint-disable-next-line no-control-regex
  let clean = rawFilename.replace(/[\x00-\x1F\x7F]/g, "");

  // Extract base name ignoring path separators
  clean = clean.replace(/\\/g, "/");
  const baseName = clean.split("/").pop() || "unnamed-file";

  // Normalize dots & spaces
  const safeName = baseName.trim().replace(/\.\./g, ".");

  const extMatch = safeName.match(/\.([a-zA-Z0-9]+)$/);
  const extension = extMatch ? extMatch[1]!.toLowerCase() : "";

  return {
    sanitizedFilename: safeName,
    extension,
  };
}

export function detectFileSignature(
  buffer: Buffer,
): { mime: string; ext: string; assetType: AssetType } | null {
  if (buffer.length < 4) {
    return null;
  }

  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { mime: "image/png", ext: "png", assetType: "image" };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg", assetType: "image" };
  }

  // GIF: GIF87a or GIF89a (47 49 46 38)
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return { mime: "image/gif", ext: "gif", assetType: "image" };
  }

  // WebP / RIFF: 52 49 46 46 ... 57 45 42 50
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp", assetType: "image" };
  }

  // MP4 / ftyp: offset 4: 66 74 79 70 ('ftyp')
  if (
    buffer.length >= 8 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return { mime: "video/mp4", ext: "mp4", assetType: "video" };
  }

  // WebM / EBML: 1A 45 DF A3
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { mime: "video/webm", ext: "webm", assetType: "video" };
  }

  // OGG: 4F 67 67 53 ('OggS')
  if (
    buffer[0] === 0x4f &&
    buffer[1] === 0x67 &&
    buffer[2] === 0x67 &&
    buffer[3] === 0x53
  ) {
    return { mime: "audio/ogg", ext: "ogg", assetType: "audio" };
  }

  // WAV: 52 49 46 46 ... 57 41 56 45 ('RIFF'...'WAVE')
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x41 &&
    buffer[10] === 0x56 &&
    buffer[11] === 0x45
  ) {
    return { mime: "audio/wav", ext: "wav", assetType: "audio" };
  }

  // MP3 ID3: 49 44 33 ('ID3') or sync FF FB / FF F3
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
    (buffer[0] === 0xff &&
      (buffer[1] === 0xfb || buffer[1] === 0xf3 || buffer[1] === 0xf2))
  ) {
    return { mime: "audio/mpeg", ext: "mp3", assetType: "audio" };
  }

  return null;
}

export function extractImageDimensions(
  buffer: Buffer,
  mime: string,
): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && buffer.length >= 24) {
      // PNG header: IHDR starts at byte 12. Width at 16 (4 bytes BE), Height at 20 (4 bytes BE)
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }

    if (mime === "image/gif" && buffer.length >= 10) {
      // GIF header: Width at 6 (2 bytes LE), Height at 8 (2 bytes LE)
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      if (width > 0 && height > 0) return { width, height };
    }

    if (mime === "image/jpeg") {
      let offset = 2; // Skip SOI (FF D8)
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];

        // SOF0 (C0) to SOF3 (C3), SOF5 (C5) to SOF7 (C7), SOF9 (C9) to SOF11 (CB), SOF13 (CD) to SOF15 (CF)
        if (
          (marker! >= 0xc0 && marker! <= 0xc3) ||
          (marker! >= 0xc5 && marker! <= 0xc7) ||
          (marker! >= 0xc9 && marker! <= 0xcb) ||
          (marker! >= 0xcd && marker! <= 0xcf)
        ) {
          if (offset + 8 < buffer.length) {
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);
            if (width > 0 && height > 0) return { width, height };
          }
          break;
        }

        // Advance by length of marker segment
        if (offset + 3 >= buffer.length) break;
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    }

    if (mime === "image/webp" && buffer.length >= 30) {
      // VP8 (lossy): 'VP8 ' at 12
      if (
        buffer[12] === 0x56 &&
        buffer[13] === 0x50 &&
        buffer[14] === 0x38 &&
        buffer[15] === 0x20
      ) {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        if (width > 0 && height > 0) return { width, height };
      }
      // VP8L (lossless): 'VP8L' at 12
      if (
        buffer[12] === 0x56 &&
        buffer[13] === 0x50 &&
        buffer[14] === 0x38 &&
        buffer[15] === 0x4c
      ) {
        const b0 = buffer[21]!;
        const b1 = buffer[22]!;
        const b2 = buffer[23]!;
        const b3 = buffer[24]!;
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height =
          1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        if (width > 0 && height > 0) return { width, height };
      }
      // VP8X (extended): 'VP8X' at 12
      if (
        buffer[12] === 0x56 &&
        buffer[13] === 0x50 &&
        buffer[14] === 0x38 &&
        buffer[15] === 0x58
      ) {
        const width =
          1 + (buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16));
        const height =
          1 + (buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16));
        if (width > 0 && height > 0) return { width, height };
      }
    }
  } catch {
    // Return null if parsing fails safely
  }

  return null;
}

export function validateAndDetectFile(
  input: UploadMediaInput,
  limits: MediaLimitsConfig = DEFAULT_MEDIA_LIMITS,
): ValidatedFileResult {
  const { sanitizedFilename, extension } = sanitizeFilename(input.filename);

  // Check dangerous extension
  if (DANGEROUS_EXTENSIONS.has(extension)) {
    throw new MediaTypeNotAllowedError(
      `File extension '.${extension}' is not allowed`,
    );
  }

  // Check dangerous declared MIME
  const declaredMime = input.mimeType ? input.mimeType.toLowerCase() : "";
  if (DANGEROUS_MIMES.has(declaredMime)) {
    throw new MediaTypeNotAllowedError(
      `MIME type '${declaredMime}' is dangerous and blocked`,
    );
  }

  // Check zero-byte files first
  if (input.buffer.length === 0) {
    throw new MediaInvalidFileError("Zero-byte files are not allowed");
  }

  const detected = detectFileSignature(input.buffer);

  let finalMime =
    declaredMime || (detected ? detected.mime : "application/octet-stream");
  let assetType: AssetType = "file";

  if (detected) {
    // If magic bytes match a known media format
    assetType = detected.assetType;

    // Check MIME mismatch if declared MIME is specified and is a different category
    if (
      declaredMime &&
      !declaredMime.startsWith(detected.assetType) &&
      declaredMime !== "application/octet-stream"
    ) {
      throw new MediaMimeMismatchError(declaredMime, detected.mime);
    }

    finalMime = detected.mime;
  } else {
    // Determine assetType from declared MIME if magic bytes are generic
    if (ALLOWED_IMAGE_MIMES.has(declaredMime)) {
      throw new MediaMimeMismatchError(
        declaredMime,
        "unknown/unrecognized-image-signature",
      );
    }
    if (ALLOWED_VIDEO_MIMES.has(declaredMime)) {
      throw new MediaMimeMismatchError(
        declaredMime,
        "unknown/unrecognized-video-signature",
      );
    }
    if (ALLOWED_AUDIO_MIMES.has(declaredMime)) {
      throw new MediaMimeMismatchError(
        declaredMime,
        "unknown/unrecognized-audio-signature",
      );
    }
  }

  // Check size limits
  let maxSize = limits.maxFileSize;
  if (assetType === "image") maxSize = limits.maxImageSize;
  if (assetType === "audio") maxSize = limits.maxAudioSize;
  if (assetType === "video") maxSize = limits.maxVideoSize;

  if (input.buffer.length > maxSize) {
    throw new MediaTooLargeError(maxSize, input.buffer.length);
  }

  // Compute Checksum
  const checksum = computeSha256(input.buffer);

  // Extract dimensions if image
  let width: number | null = null;
  let height: number | null = null;

  if (assetType === "image") {
    const dimensions = extractImageDimensions(input.buffer, finalMime);
    if (dimensions) {
      width = dimensions.width;
      height = dimensions.height;
    }
  }

  const displayName =
    input.displayName && input.displayName.trim().length > 0
      ? input.displayName.trim()
      : sanitizedFilename;

  return {
    originalFilename: sanitizedFilename,
    displayName,
    mimeType: finalMime,
    extension: extension || (detected ? detected.ext : "bin"),
    sizeBytes: input.buffer.length,
    checksum,
    assetType,
    width,
    height,
  };
}

export function validateMediaMetadata(
  filename: string,
  declaredMime?: string,
  expectedSize?: number,
  limits: MediaLimitsConfig = DEFAULT_MEDIA_LIMITS,
): void {
  const { extension } = sanitizeFilename(filename);

  if (DANGEROUS_EXTENSIONS.has(extension)) {
    throw new MediaTypeNotAllowedError(
      `File extension '.${extension}' is not allowed`,
    );
  }

  const mime = declaredMime ? declaredMime.toLowerCase() : "";
  if (DANGEROUS_MIMES.has(mime)) {
    throw new MediaTypeNotAllowedError(
      `MIME type '${mime}' is dangerous and blocked`,
    );
  }

  if (expectedSize !== undefined) {
    if (expectedSize <= 0) {
      throw new MediaInvalidFileError("Expected size must be greater than zero");
    }
    if (expectedSize > limits.maxFileSize) {
      throw new MediaTooLargeError(limits.maxFileSize, expectedSize);
    }
  }
}

