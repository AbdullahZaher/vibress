#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveCanonicalStorageRoot } from "../packages/storage-core/src/local-storage-provider";

export const MEDIA_STORAGE_MIGRATED_MARKER_FILE = ".media-storage-migrated.json";

export interface SyncFileReport {
  key: string;
  sourcePath: string;
  destPath: string;
  sizeBytes: number;
  status: "copied" | "already_synced" | "verified" | "would_copy" | "conflict" | "error" | "missing";
  sha256?: string;
  error?: string;
}

export interface SyncSummary {
  dryRun: boolean;
  verifyOnly: boolean;
  sourceDir: string;
  destDir: string;
  totalScanned: number;
  copied: number;
  alreadySynced: number;
  conflicts: number;
  errors: number;
  startedAt: string;
  completedAt: string;
  details: SyncFileReport[];
  markerPath?: string;
  markerWritten?: boolean;
}

export function calculateSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function getFilesRecursively(dir: string, baseDir: string = dir): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getFilesRecursively(full, baseDir));
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, full).replace(/\\/g, "/"));
    }
  }
  return results;
}

export async function runMediaStorageSync(
  options: {
    dryRun?: boolean;
    verify?: boolean;
    sourceDir?: string;
    destDir?: string;
  } = {},
): Promise<SyncSummary> {
  const dryRun = Boolean(options.dryRun || process.argv.includes("--dry-run"));
  const verifyOnly = Boolean(options.verify || process.argv.includes("--verify"));
  const destDir = options.destDir || resolveCanonicalStorageRoot();
  const repoRoot = path.resolve(path.dirname(destDir), "..");
  const sourceDir = options.sourceDir || path.resolve(repoRoot, "apps", "api", "content", "media");
  const markerPath = path.join(destDir, MEDIA_STORAGE_MIGRATED_MARKER_FILE);

  const startedAt = new Date().toISOString();
  const summary: SyncSummary = {
    dryRun,
    verifyOnly,
    sourceDir,
    destDir,
    totalScanned: 0,
    copied: 0,
    alreadySynced: 0,
    conflicts: 0,
    errors: 0,
    startedAt,
    completedAt: "",
    details: [],
    markerPath,
    markerWritten: false,
  };

  const modeLabel = verifyOnly
    ? "VERIFY-ONLY (validates existing canonical media without copying)"
    : dryRun
      ? "DRY-RUN (no files will be written)"
      : "LIVE SYNC";

  console.log(`[sync-media-storage] Mode: ${modeLabel}`);
  console.log(`[sync-media-storage] Source (Legacy API root): ${sourceDir}`);
  console.log(`[sync-media-storage] Destination (Canonical root): ${destDir}`);

  if (!fs.existsSync(sourceDir)) {
    console.log(`[sync-media-storage] Source directory does not exist. Nothing to sync.`);
    summary.completedAt = new Date().toISOString();
    return summary;
  }

  const relativeFiles = getFilesRecursively(sourceDir).filter(
    (f) => path.basename(f) !== MEDIA_STORAGE_MIGRATED_MARKER_FILE,
  );
  summary.totalScanned = relativeFiles.length;
  console.log(`[sync-media-storage] Found ${relativeFiles.length} files in source.`);

  for (const relKey of relativeFiles) {
    const srcPath = path.join(sourceDir, relKey);
    const dstPath = path.join(destDir, relKey);
    const stat = fs.statSync(srcPath);

    if (fs.existsSync(dstPath)) {
      const srcHash = calculateSha256(srcPath);
      const dstHash = calculateSha256(dstPath);

      if (srcHash === dstHash) {
        summary.alreadySynced++;
        summary.details.push({
          key: relKey,
          sourcePath: srcPath,
          destPath: dstPath,
          sizeBytes: stat.size,
          status: verifyOnly ? "verified" : "already_synced",
          sha256: srcHash,
        });
      } else {
        summary.conflicts++;
        summary.details.push({
          key: relKey,
          sourcePath: srcPath,
          destPath: dstPath,
          sizeBytes: stat.size,
          status: "conflict",
          error: `Hash mismatch: src=${srcHash}, dst=${dstHash}. Destination preserved.`,
        });
        console.warn(`[sync-media-storage] CONFLICT for "${relKey}". Destination preserved.`);
      }
      continue;
    }

    if (verifyOnly) {
      summary.errors++;
      summary.details.push({
        key: relKey,
        sourcePath: srcPath,
        destPath: dstPath,
        sizeBytes: stat.size,
        status: "missing",
        error: `File missing from canonical destination: ${relKey}`,
      });
      console.error(`[sync-media-storage] MISSING in canonical destination: "${relKey}"`);
      continue;
    }

    if (dryRun) {
      summary.copied++;
      summary.details.push({
        key: relKey,
        sourcePath: srcPath,
        destPath: dstPath,
        sizeBytes: stat.size,
        status: "would_copy",
        sha256: calculateSha256(srcPath),
      });
      continue;
    }

    try {
      const targetDir = path.dirname(dstPath);
      await fs.promises.mkdir(targetDir, { recursive: true });

      const tempDst = `${dstPath}.tmp-${crypto.randomUUID()}`;
      await fs.promises.copyFile(srcPath, tempDst);
      await fs.promises.rename(tempDst, dstPath);

      const srcHash = calculateSha256(srcPath);
      const dstHash = calculateSha256(dstPath);

      if (srcHash !== dstHash) {
        throw new Error(`Integrity check failed: source hash ${srcHash} !== dest hash ${dstHash}`);
      }

      summary.copied++;
      summary.details.push({
        key: relKey,
        sourcePath: srcPath,
        destPath: dstPath,
        sizeBytes: stat.size,
        status: "copied",
        sha256: dstHash,
      });
    } catch (err: unknown) {
      summary.errors++;
      summary.details.push({
        key: relKey,
        sourcePath: srcPath,
        destPath: dstPath,
        sizeBytes: stat.size,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`[sync-media-storage] ERROR copying "${relKey}":`, err);
    }
  }

  summary.completedAt = new Date().toISOString();

  // Manage migration marker
  if (summary.errors === 0 && summary.conflicts === 0 && summary.totalScanned > 0 && !dryRun) {
    try {
      await fs.promises.mkdir(destDir, { recursive: true });
      const markerData = {
        version: 1,
        status: "complete",
        completedAt: summary.completedAt,
        sourceDir: summary.sourceDir,
        destDir: summary.destDir,
        totalVerified: summary.alreadySynced + summary.copied,
        verifiedBy: "scripts/sync-media-storage.ts",
      };
      await fs.promises.writeFile(markerPath, JSON.stringify(markerData, null, 2), "utf8");
      summary.markerWritten = true;
      console.log(`[sync-media-storage] Successfully wrote migration marker: ${markerPath}`);
    } catch (err) {
      console.warn(`[sync-media-storage] Failed to write migration marker:`, err);
    }
  } else if ((summary.errors > 0 || summary.conflicts > 0) && fs.existsSync(markerPath)) {
    try {
      fs.unlinkSync(markerPath);
      console.warn(`[sync-media-storage] Removed stale migration marker due to conflicts/errors.`);
    } catch (err) {
      console.warn(`[sync-media-storage] Failed to remove stale migration marker:`, err);
    }
  }

  console.log(`\n================== Sync Summary ==================`);
  console.log(`Total scanned:  ${summary.totalScanned}`);
  console.log(`Copied:         ${summary.copied} ${dryRun ? "(simulated)" : ""}`);
  console.log(`Already synced: ${summary.alreadySynced}`);
  console.log(`Conflicts:      ${summary.conflicts}`);
  console.log(`Errors:         ${summary.errors}`);
  console.log(`Marker written: ${summary.markerWritten ? "YES" : "NO"}`);
  console.log(`==================================================\n`);

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMediaStorageSync()
    .then((s) => {
      if (s.errors > 0 || s.conflicts > 0) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Fatal sync error:", err);
      process.exit(1);
    });
}
