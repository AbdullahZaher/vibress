#!/usr/bin/env node

/**
 * Vibress Official Theme Validation CLI Tool (Theme API v1)
 *
 * This validator enforces the exact same security, quota, manifest,
 * template, settings, and compression invariants as the Vibress core production engine.
 *
 * Usage:
 *   node validate-theme.mjs <path-to-theme-directory-or-zip>
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as zlib from "node:zlib";

// Theme API v1 Canonical Constants & Limits
const THEME_API_VERSION = 1;
const MAX_ZIP_BYTES = 20 * 1024 * 1024; // 20 MB archive limit
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024; // 100 MB uncompressed total
const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILE_COUNT = 500;
const MAX_PATH_LENGTH = 255;
const MAX_COMPRESSION_RATIO = 20; // 20:1 max ratio to prevent zip bombs

// Allowed file extensions (Presentation assets only - Zero executable code)
const ALLOWED_EXTENSIONS = new Set([
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

// Explicitly forbidden dangerous / executable extensions
const FORBIDDEN_EXTENSIONS = new Set([
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

// ANSI Color Helpers
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function logSuccess(msg) {
  console.log(`  ${colors.green}✔${colors.reset} ${msg}`);
}

function logError(msg) {
  console.log(`  ${colors.red}✖${colors.reset} ${msg}`);
}

function logWarn(msg) {
  console.log(`  ${colors.yellow}⚠${colors.reset} ${msg}`);
}

function logHeader(msg) {
  console.log(`\n${colors.bold}${colors.cyan}=== ${msg} ===${colors.reset}\n`);
}

function validateThemePath(relativePath) {
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    relativePath.includes("..") ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\") ||
    relativePath.includes(":") ||
    relativePath.length > MAX_PATH_LENGTH
  ) {
    throw new Error(`Dangerous or invalid path detected in archive: "${relativePath}"`);
  }
}

async function main() {
  const targetPath = process.argv[2];

  if (!targetPath) {
    console.log(`
${colors.bold}Vibress Official Theme Validator (Theme API v1)${colors.reset}

${colors.yellow}Usage:${colors.reset}
  node validate-theme.mjs <path/to/theme-directory>
  node validate-theme.mjs <path/to/theme.zip>

${colors.cyan}Examples:${colors.reset}
  node validate-theme.mjs ./starter-theme
  node validate-theme.mjs ./vibress-theme-starter.zip
`);
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), targetPath);

  if (!fs.existsSync(fullPath)) {
    console.error(`${colors.red}Error: Path does not exist:${colors.reset} ${fullPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(fullPath);
  let fileMap = new Map(); // relativePath -> Buffer
  let isZip = false;

  logHeader(`Validating Vibress Theme: ${path.basename(fullPath)}`);

  let hasErrors = false;

  if (stat.isFile()) {
    isZip = true;
    try {
      fileMap = await extractAndValidateZip(fullPath);
    } catch (err) {
      logError(`ZIP extraction failure: ${err.message}`);
      hasErrors = true;
    }
  } else if (stat.isDirectory()) {
    try {
      fileMap = readAndValidateDirectory(fullPath);
    } catch (err) {
      logError(`Directory scan failure: ${err.message}`);
      hasErrors = true;
    }
  } else {
    console.error(`${colors.red}Error: Target is neither a regular file nor a directory.${colors.reset}`);
    process.exit(1);
  }

  if (fileMap.size === 0 && !hasErrors) {
    logError("Theme package contains no files");
    hasErrors = true;
  }

  // 1. Quota & Limits Checks
  console.log(`${colors.bold}1. Archive & Quota Checks${colors.reset}`);
  if (fileMap.size > MAX_FILE_COUNT) {
    logError(`Theme contains ${fileMap.size} files, exceeding limit of ${MAX_FILE_COUNT}`);
    hasErrors = true;
  } else {
    logSuccess(`File count: ${fileMap.size} (within ${MAX_FILE_COUNT} limit)`);
  }

  let totalSize = 0;
  for (const [relPath, buffer] of fileMap.entries()) {
    totalSize += buffer.length;
    if (buffer.length > MAX_SINGLE_FILE_BYTES) {
      logError(`File "${relPath}" (${(buffer.length / (1024 * 1024)).toFixed(2)}MB) exceeds single file limit of 10MB`);
      hasErrors = true;
    }
  }

  if (totalSize > MAX_EXTRACTED_BYTES) {
    logError(`Total extracted size (${(totalSize / (1024 * 1024)).toFixed(2)}MB) exceeds 100MB limit`);
    hasErrors = true;
  } else {
    logSuccess(`Total uncompressed size: ${(totalSize / 1024).toFixed(1)} KB (within 100MB limit)`);
  }

  // 2. Security & File Type Checks (No-JS Policy)
  console.log(`\n${colors.bold}2. Security & No-JS Enforcement${colors.reset}`);
  let forbiddenFound = 0;
  let invalidExtFound = 0;

  for (const relPath of fileMap.keys()) {
    const lastDot = relPath.lastIndexOf(".");
    const ext = lastDot !== -1 ? relPath.slice(lastDot).toLowerCase() : "";

    if (FORBIDDEN_EXTENSIONS.has(ext)) {
      logError(`Prohibited executable/script file found: "${relPath}"`);
      forbiddenFound++;
      hasErrors = true;
    } else if (ext !== "" && !ALLOWED_EXTENSIONS.has(ext)) {
      logError(`Unrecognized file extension "${ext}": "${relPath}" (Theme API v1 allowlist violation)`);
      invalidExtFound++;
      hasErrors = true;
    }
  }

  if (forbiddenFound === 0 && invalidExtFound === 0) {
    logSuccess(`Strict No-JS Policy passed (0 prohibited scripts or server files found)`);
    logSuccess(`All file extensions comply with Theme API v1 allowlist`);
  }

  // 3. Manifest Validation (`theme.json`)
  console.log(`\n${colors.bold}3. Manifest Verification (theme.json)${colors.reset}`);
  const manifestBuffer = fileMap.get("theme.json");
  let manifest = null;

  if (!manifestBuffer) {
    logError(`Missing required "theme.json" manifest at root`);
    hasErrors = true;
  } else {
    try {
      manifest = JSON.parse(manifestBuffer.toString("utf-8"));
      logSuccess(`"theme.json" is valid JSON`);

      // Validate Theme ID
      if (!manifest.id || typeof manifest.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
        logError(`Invalid theme "id": must be lowercase alphanumeric with hyphens (e.g. "my-theme")`);
        hasErrors = true;
      } else {
        logSuccess(`Theme ID: "${manifest.id}"`);
      }

      // Validate Theme Name
      if (!manifest.name || typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
        logError(`Theme "name" is required and cannot be empty`);
        hasErrors = true;
      } else {
        logSuccess(`Theme Name: "${manifest.name}"`);
      }

      // Validate Version
      if (!manifest.version || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
        logError(`Theme "version" must follow strict semver (e.g. "1.0.0")`);
        hasErrors = true;
      } else {
        logSuccess(`Theme Version: "${manifest.version}"`);
      }

      // Validate Theme API Version
      if (manifest.themeApi !== THEME_API_VERSION) {
        logError(`Theme API version "${manifest.themeApi}" is unsupported. Must be "${THEME_API_VERSION}".`);
        hasErrors = true;
      } else {
        logSuccess(`Theme API: ${manifest.themeApi}`);
      }

      // Validate Preview Image Declaration & Existence
      let previewFound = false;
      if (manifest.previewImage) {
        const cleanPreview = manifest.previewImage.replace(/^\/+/, "");
        if (!fileMap.has(cleanPreview)) {
          logError(`Declared previewImage "${manifest.previewImage}" does not exist in theme package`);
          hasErrors = true;
        } else {
          logSuccess(`Preview image found: "${manifest.previewImage}"`);
          previewFound = true;
        }
      } else {
        if (fileMap.has("preview.webp") || fileMap.has("preview.png") || fileMap.has("preview.jpg")) {
          const defaultPreview = fileMap.has("preview.webp")
            ? "preview.webp"
            : fileMap.has("preview.png")
              ? "preview.png"
              : "preview.jpg";
          logSuccess(`Default preview image found: "${defaultPreview}"`);
          previewFound = true;
        } else {
          logError(`Theme package is missing required preview image (preview.webp, preview.png, or declared via previewImage in theme.json)`);
          hasErrors = true;
        }
      }
    } catch (err) {
      logError(`Failed to parse "theme.json": ${err.message}`);
      hasErrors = true;
    }
  }

  // 4. Template Contract Verification
  console.log(`\n${colors.bold}4. Template Contract Verification${colors.reset}`);
  const templateFiles = Array.from(fileMap.keys()).filter((f) => f.startsWith("templates/"));

  const hasHome = templateFiles.some((f) => /^templates\/(home|index)\.(liquid|html)$/i.test(f));
  const hasPost = templateFiles.some((f) => /^templates\/post\.(liquid|html)$/i.test(f));
  const hasPage = templateFiles.some((f) => /^templates\/page\.(liquid|html)$/i.test(f));

  if (!hasHome) {
    logError(`Missing required homepage template: "templates/home.liquid" (or "index.liquid")`);
    hasErrors = true;
  } else {
    logSuccess(`Homepage template: found`);
  }

  if (!hasPost) {
    logError(`Missing required post template: "templates/post.liquid"`);
    hasErrors = true;
  } else {
    logSuccess(`Post template: found`);
  }

  if (!hasPage) {
    logError(`Missing required page template: "templates/page.liquid"`);
    hasErrors = true;
  } else {
    logSuccess(`Page template: found`);
  }

  // Optional recommended templates
  const hasTag = templateFiles.some((f) => /^templates\/tag\.(liquid|html)$/i.test(f));
  const hasAuthor = templateFiles.some((f) => /^templates\/author\.(liquid|html)$/i.test(f));

  if (hasTag) logSuccess(`Tag template: found ("templates/tag.liquid")`);
  else logWarn(`Tag template not found (recommended: "templates/tag.liquid")`);

  if (hasAuthor) logSuccess(`Author template: found ("templates/author.liquid")`);
  else logWarn(`Author template not found (recommended: "templates/author.liquid")`);

  // 5. Liquid Syntax Verification
  console.log(`\n${colors.bold}5. Liquid Template Syntax Parsing${colors.reset}`);
  let liquidParseErrors = 0;
  try {
    const liquidModule = await import("liquidjs");
    const Liquid = liquidModule.Liquid || liquidModule.default?.Liquid;
    if (Liquid) {
      const engine = new Liquid();
      for (const [relPath, buffer] of fileMap.entries()) {
        if (relPath.endsWith(".liquid") || relPath.endsWith(".html")) {
          try {
            engine.parse(buffer.toString("utf-8"));
          } catch (syntaxErr) {
            logError(`Syntax error in "${relPath}": ${syntaxErr.message}`);
            liquidParseErrors++;
            hasErrors = true;
          }
        }
      }
      if (liquidParseErrors === 0) {
        logSuccess(`All Liquid templates and partials parsed successfully with zero syntax errors`);
      }
    }
  } catch {
    // LiquidJS not installed in environment, skip AST check
    logWarn(`LiquidJS not found in node_modules; template syntax check skipped`);
  }

  // 6. Settings Schema Verification (`settings.json`)
  console.log(`\n${colors.bold}6. Theme Settings Schema (settings.json)${colors.reset}`);
  const settingsBuffer = fileMap.get("settings.json");
  if (settingsBuffer) {
    try {
      const rawSettings = JSON.parse(settingsBuffer.toString("utf-8"));
      logSuccess(`"settings.json" is valid JSON`);

      const fields = Array.isArray(rawSettings)
        ? rawSettings
        : rawSettings && Array.isArray(rawSettings.fields)
          ? rawSettings.fields
          : rawSettings && typeof rawSettings === "object"
            ? Object.entries(rawSettings).map(([key, val]) => ({ key, ...val }))
            : [];

      let validFieldCount = 0;
      for (const field of fields) {
        if (!field.key || typeof field.key !== "string") {
          logError(`Setting definition missing valid "key"`);
          hasErrors = true;
          continue;
        }

        if (field.default === undefined) {
          logError(`Setting "${field.key}" is missing mandatory "default" value`);
          hasErrors = true;
          continue;
        }

        switch (field.type) {
          case "string":
            if (typeof field.default !== "string") {
              logError(`Setting "${field.key}" default must be a string`);
              hasErrors = true;
            }
            break;
          case "boolean":
            if (typeof field.default !== "boolean") {
              logError(`Setting "${field.key}" default must be boolean (true/false)`);
              hasErrors = true;
            }
            break;
          case "number":
            if (typeof field.default !== "number" || Number.isNaN(field.default)) {
              logError(`Setting "${field.key}" default must be a number`);
              hasErrors = true;
            }
            if (field.min !== undefined && field.default < field.min) {
              logError(`Setting "${field.key}" default (${field.default}) is below min ${field.min}`);
              hasErrors = true;
            }
            if (field.max !== undefined && field.default > field.max) {
              logError(`Setting "${field.key}" default (${field.default}) is above max ${field.max}`);
              hasErrors = true;
            }
            break;
          case "color":
            if (typeof field.default !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(field.default)) {
              logError(`Setting "${field.key}" default must be a valid hex color (e.g. #6366f1)`);
              hasErrors = true;
            }
            break;
          case "select": {
            if (!Array.isArray(field.options) || field.options.length === 0) {
              logError(`Setting "${field.key}" of type select must have non-empty "options" array`);
              hasErrors = true;
            } else {
              const optionValues = field.options.map((opt) =>
                typeof opt === "string" ? opt : opt?.value,
              );
              if (!optionValues.includes(field.default)) {
                logError(
                  `Setting "${field.key}" default "${field.default}" is not in options: [${optionValues.join(", ")}]`,
                );
                hasErrors = true;
              }
            }
            break;
          }
          default:
            logError(`Setting "${field.key}" has unknown type "${field.type}"`);
            hasErrors = true;
        }

        validFieldCount++;
      }

      logSuccess(`Validated ${validFieldCount} custom settings definitions`);
    } catch (err) {
      logError(`Failed to parse "settings.json": ${err.message}`);
      hasErrors = true;
    }
  } else {
    logSuccess(`No "settings.json" provided (theme will use default layout)`);
  }

  // Final Verdict
  console.log(`\n${colors.bold}${colors.cyan}=== Validation Verdict ===${colors.reset}\n`);
  if (hasErrors) {
    console.error(`${colors.bold}${colors.red}FAILED:${colors.reset} Theme package contains errors that must be resolved before uploading to Vibress.`);
    process.exit(1);
  } else {
    console.log(`${colors.bold}${colors.green}PASSED:${colors.reset} Theme package complies 100% with Vibress Theme API v1! 🎉`);
    console.log(`${colors.gray}This theme is ready to be zipped and uploaded to Vibress Admin.${colors.reset}\n`);
    process.exit(0);
  }
}

/**
 * Reads and validates a theme directory, with strict symlink detection.
 */
function readAndValidateDirectory(dir) {
  const fileMap = new Map();

  function walk(currentDir, rel = "") {
    const entries = fs.readdirSync(currentDir, { withFileTypes: false });
    for (const name of entries) {
      const relPath = rel ? `${rel}/${name}` : name;
      const fullPath = path.join(currentDir, name);

      // Check for symlinks via lstat
      const lstat = fs.lstatSync(fullPath);
      if (lstat.isSymbolicLink()) {
        throw new Error(`Symlinks are strictly forbidden in theme packages: "${relPath}"`);
      }

      if (name === ".DS_Store" || name === "Thumbs.db" || name.startsWith(".")) {
        continue;
      }

      validateThemePath(relPath);

      if (lstat.isDirectory()) {
        walk(fullPath, relPath);
      } else if (lstat.isFile()) {
        const buffer = fs.readFileSync(fullPath);
        fileMap.set(relPath, buffer);
      }
    }
  }

  walk(dir);
  return fileMap;
}

/**
 * Extracts and validates a ZIP archive with strict symlink and compression ratio checks.
 */
async function extractAndValidateZip(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const byteLength = buffer.length;

  if (byteLength === 0) {
    throw new Error("Theme archive is empty");
  }

  if (byteLength > MAX_ZIP_BYTES) {
    throw new Error(`ZIP file exceeds maximum size of 20MB (${(byteLength / (1024 * 1024)).toFixed(2)}MB)`);
  }

  // Magic bytes check: PK\x03\x04
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    throw new Error("File is not a valid ZIP archive (magic bytes mismatch)");
  }

  // Use JSZip if available
  try {
    const jszipModule = await import("jszip");
    const JSZip = jszipModule.default || jszipModule;
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    const entries = Object.keys(zip.files);
    const fileMap = new Map();
    let totalUncompressedBytes = 0;

    const nonDir = entries.filter((e) => !zip.files[e].dir);
    let prefixToStrip = "";
    const rootFiles = nonDir.filter((e) => !e.includes("/"));
    if (rootFiles.length === 0) {
      const topLevels = new Set(entries.map((e) => e.split("/")[0]));
      if (topLevels.size === 1) {
        prefixToStrip = Array.from(topLevels)[0] + "/";
      }
    }

    for (const entryName of entries) {
      const entry = zip.files[entryName];
      if (entry.dir) continue;

      // Symlink check
      const unixPermissions = entry.unixPermissions;
      if (unixPermissions && (unixPermissions & 0o170000) === 0o120000) {
        throw new Error(`Symlinks are strictly forbidden in theme packages: "${entryName}"`);
      }

      let relPath = entryName;
      if (prefixToStrip && relPath.startsWith(prefixToStrip)) {
        relPath = relPath.slice(prefixToStrip.length);
      }

      if (relPath.startsWith("__MACOSX/") || relPath.endsWith(".DS_Store") || relPath.endsWith("Thumbs.db")) {
        continue;
      }

      validateThemePath(relPath);

      const fileBuffer = await entry.async("nodebuffer");
      totalUncompressedBytes += fileBuffer.length;

      // Compression ratio check
      if (byteLength > 0 && totalUncompressedBytes / byteLength > MAX_COMPRESSION_RATIO) {
        throw new Error(`Theme ZIP bomb detected: archive compression ratio exceeds allowed threshold of ${MAX_COMPRESSION_RATIO}:1`);
      }

      fileMap.set(relPath, fileBuffer);
    }
    return fileMap;
  } catch (err) {
    if (err.message && (err.message.includes("Symlinks") || err.message.includes("ZIP bomb") || err.message.includes("Dangerous"))) {
      throw err;
    }
    // Fallback: Built-in pure Node.js ZIP parser using node:zlib
    return parseZipWithBuiltinZlib(buffer);
  }
}

function parseZipWithBuiltinZlib(buffer) {
  const fileMap = new Map();
  let offset = 0;
  const rawEntries = [];
  const byteLength = buffer.length;
  let totalUncompressedBytes = 0;

  while (offset < buffer.length - 30) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x04034b50) {
      // Local File Header
      const compression = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const uncompressedSize = buffer.readUInt32LE(offset + 22);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraFieldLength = buffer.readUInt16LE(offset + 28);

      const fileName = buffer.toString("utf-8", offset + 30, offset + 30 + fileNameLength);
      const dataOffset = offset + 30 + fileNameLength + extraFieldLength;
      const dataEnd = dataOffset + compressedSize;

      if (dataEnd <= buffer.length) {
        rawEntries.push({
          name: fileName,
          compression,
          compressedData: buffer.subarray(dataOffset, dataEnd),
          compressedSize,
          uncompressedSize,
        });
      }

      offset = dataEnd;
    } else if (signature === 0x02014b50 || signature === 0x06054b50) {
      // Central directory reached
      break;
    } else {
      offset++;
    }
  }

  // Check top-level folder prefix
  const nonDir = rawEntries.filter((e) => !e.name.endsWith("/"));
  let prefixToStrip = "";
  const rootFiles = nonDir.filter((e) => !e.name.includes("/"));
  if (rootFiles.length === 0) {
    const topLevels = new Set(rawEntries.map((e) => e.name.split("/")[0]));
    if (topLevels.size === 1) {
      prefixToStrip = Array.from(topLevels)[0] + "/";
    }
  }

  for (const entry of rawEntries) {
    if (entry.name.endsWith("/")) continue;

    let relPath = entry.name;
    if (prefixToStrip && relPath.startsWith(prefixToStrip)) {
      relPath = relPath.slice(prefixToStrip.length);
    }

    if (relPath.startsWith("__MACOSX/") || relPath.endsWith(".DS_Store") || relPath.endsWith("Thumbs.db")) {
      continue;
    }

    validateThemePath(relPath);

    let uncompressed;
    if (entry.compression === 0) {
      uncompressed = entry.compressedData;
    } else if (entry.compression === 8) {
      uncompressed = zlib.inflateRawSync(entry.compressedData);
    } else {
      throw new Error(`Unsupported compression method ${entry.compression} in "${relPath}"`);
    }

    totalUncompressedBytes += uncompressed.length;

    // Single-entry ratio check
    if (entry.compressedSize > 0 && uncompressed.length / entry.compressedSize > MAX_COMPRESSION_RATIO) {
      throw new Error(`Theme ZIP bomb detected: file "${relPath}" compression ratio exceeds allowed threshold of ${MAX_COMPRESSION_RATIO}:1`);
    }

    // Overall ratio check
    if (byteLength > 0 && totalUncompressedBytes / byteLength > MAX_COMPRESSION_RATIO) {
      throw new Error(`Theme ZIP bomb detected: archive compression ratio exceeds allowed threshold of ${MAX_COMPRESSION_RATIO}:1`);
    }

    fileMap.set(relPath, Buffer.from(uncompressed));
  }

  return fileMap;
}

main().catch((err) => {
  console.error(`\n${colors.red}Unhandled Error:${colors.reset}`, err);
  process.exit(1);
});
