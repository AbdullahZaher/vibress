#!/usr/bin/env node

/**
 * Vibress Theme Validation CLI Tool (Theme API v1)
 *
 * Usage:
 *   node validate-theme.mjs <path-to-theme-directory-or-zip>
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// Theme API v1 Constraints
const THEME_API_VERSION = 1;
const MAX_ZIP_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILE_COUNT = 500;
const MAX_PATH_LENGTH = 255;
const MAX_COMPRESSION_RATIO = 20;

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

const REQUIRED_TEMPLATES = ["post", "page"];

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

async function main() {
  const targetPath = process.argv[2];

  if (!targetPath) {
    console.log(`
${colors.bold}Vibress Theme Validator (Theme API v1)${colors.reset}

${colors.yellow}Usage:${colors.reset}
  node validate-theme.mjs <path/to/theme-directory>
  node validate-theme.mjs <path/to/theme.zip>

${colors.cyan}Example:${colors.reset}
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

  logHeader(`Validating Vibress Theme: ${path.basename(fullPath)}`);

  if (stat.isFile()) {
    // Validate ZIP file
    fileMap = await extractZipFile(fullPath);
  } else if (stat.isDirectory()) {
    // Validate Directory
    fileMap = readDirectory(fullPath);
  } else {
    console.error(`${colors.red}Error: Target is neither a regular file nor a directory.${colors.reset}`);
    process.exit(1);
  }

  // Run Theme API v1 Invariant Checks
  let hasErrors = false;

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
      logError(`File "${relPath}" (${(buffer.length / (1024 * 1024)).toFixed(2)}MB) exceeds 10MB limit`);
      hasErrors = true;
    }
  }

  if (totalSize > MAX_EXTRACTED_BYTES) {
    logError(`Total extracted size (${(totalSize / (1024 * 1024)).toFixed(2)}MB) exceeds 100MB limit`);
    hasErrors = true;
  } else {
    logSuccess(`Total uncompressed size: ${(totalSize / 1024).toFixed(1)} KB (within 100MB limit)`);
  }

  // 2. File Type & No-JS Security Check
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
      logError(`Unrecognized file extension "${ext}": "${relPath}"`);
      invalidExtFound++;
      hasErrors = true;
    }
  }

  if (forbiddenFound === 0 && invalidExtFound === 0) {
    logSuccess(`Strict No-JS Policy passed (0 prohibited script files found)`);
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

      // Validate Preview Image Declaration
      if (manifest.previewImage) {
        const cleanPreview = manifest.previewImage.replace(/^\/+/, "");
        if (!fileMap.has(cleanPreview)) {
          logError(`Declared previewImage "${manifest.previewImage}" not found in theme package`);
          hasErrors = true;
        } else {
          logSuccess(`Preview image found: "${manifest.previewImage}"`);
        }
      } else if (fileMap.has("preview.webp") || fileMap.has("preview.png") || fileMap.has("preview.jpg")) {
        logSuccess(`Preview image found (default preview.*)`);
      } else {
        logWarn(`No preview image found (recommended to include preview.webp)`);
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

  // 5. Settings Schema Verification (`settings.json`)
  console.log(`\n${colors.bold}5. Theme Settings Schema (settings.json)${colors.reset}`);
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

function readDirectory(dir) {
  const fileMap = new Map();

  function walk(currentDir, rel = "") {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const fullPath = path.join(currentDir, e.name);

      if (e.name === ".DS_Store" || e.name === "Thumbs.db" || e.name.startsWith(".")) {
        continue;
      }

      if (e.isDirectory()) {
        walk(fullPath, relPath);
      } else if (e.isFile()) {
        const buffer = fs.readFileSync(fullPath);
        fileMap.set(relPath, buffer);
      }
    }
  }

  walk(dir);
  return fileMap;
}

async function extractZipFile(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  if (buffer.length > MAX_ZIP_BYTES) {
    console.error(`${colors.red}Error: ZIP file exceeds maximum size of 20MB.${colors.reset}`);
    process.exit(1);
  }

  // Magic bytes check
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    console.error(`${colors.red}Error: File is not a valid ZIP archive (magic bytes mismatch).${colors.reset}`);
    process.exit(1);
  }

  // Try JSZip first if available
  try {
    const jszipModule = await import("jszip");
    const JSZip = jszipModule.default || jszipModule;
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files);
    const fileMap = new Map();

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

      let relPath = entryName;
      if (prefixToStrip && relPath.startsWith(prefixToStrip)) {
        relPath = relPath.slice(prefixToStrip.length);
      }

      if (relPath.startsWith("__MACOSX/") || relPath.endsWith(".DS_Store") || relPath.endsWith("Thumbs.db")) {
        continue;
      }

      if (
        relPath.includes("..") ||
        relPath.includes("\0") ||
        relPath.startsWith("/") ||
        relPath.startsWith("\\") ||
        relPath.includes(":") ||
        relPath.length > MAX_PATH_LENGTH
      ) {
        console.error(`${colors.red}Security Error: Dangerous path detected in archive: ${relPath}${colors.reset}`);
        process.exit(1);
      }

      const fileBuffer = await entry.async("nodebuffer");
      fileMap.set(relPath, fileBuffer);
    }
    return fileMap;
  } catch {
    // Fallback: Built-in pure Node.js ZIP parser using node:zlib
    return parseZipWithBuiltinZlib(buffer);
  }
}

function parseZipWithBuiltinZlib(buffer) {
  const zlib = (awaitImportZlibSync());
  const fileMap = new Map();
  let offset = 0;
  const rawEntries = [];

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

    if (
      relPath.includes("..") ||
      relPath.includes("\0") ||
      relPath.startsWith("/") ||
      relPath.startsWith("\\") ||
      relPath.includes(":") ||
      relPath.length > MAX_PATH_LENGTH
    ) {
      console.error(`${colors.red}Security Error: Dangerous path detected in archive: ${relPath}${colors.reset}`);
      process.exit(1);
    }

    let uncompressed;
    if (entry.compression === 0) {
      uncompressed = entry.compressedData;
    } else if (entry.compression === 8) {
      uncompressed = zlib.inflateRawSync(entry.compressedData);
    } else {
      console.error(`${colors.red}Error: Unsupported compression method ${entry.compression} in ${relPath}${colors.reset}`);
      process.exit(1);
    }

    fileMap.set(relPath, Buffer.from(uncompressed));
  }

  return fileMap;
}

function awaitImportZlibSync() {
  return fs.readFileSync ? importSyncZlib() : null;
}

import * as zlibSync from "node:zlib";
function importSyncZlib() {
  return zlibSync;
}

main().catch((err) => {
  console.error(`\n${colors.red}Unhandled Error:${colors.reset}`, err);
  process.exit(1);
});
