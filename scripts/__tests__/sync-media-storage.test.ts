import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  runMediaStorageSync,
  MEDIA_STORAGE_MIGRATED_MARKER_FILE,
  calculateSha256,
} from "../sync-media-storage";

describe("sync-media-storage migration & verification lifecycles", () => {
  let testRoot: string;
  let sourceDir: string;
  let destDir: string;
  let markerPath: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibress-media-sync-test-"));
    sourceDir = path.join(testRoot, "legacy-source");
    destDir = path.join(testRoot, "canonical-dest");
    markerPath = path.join(destDir, MEDIA_STORAGE_MIGRATED_MARKER_FILE);
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it("handles empty storage condition without writing an unverified marker", async () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });

    const summary = await runMediaStorageSync({ sourceDir, destDir, verify: true });

    expect(summary.totalScanned).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.conflicts).toBe(0);
    expect(summary.markerWritten).toBe(false);
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it("detects partially migrated storage in verify-only mode and fails with error without writing marker", async () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });

    fs.writeFileSync(path.join(sourceDir, "file-1.jpg"), "content-1");
    fs.writeFileSync(path.join(sourceDir, "file-2.jpg"), "content-2");

    // Only migrate file-1
    fs.writeFileSync(path.join(destDir, "file-1.jpg"), "content-1");

    const summary = await runMediaStorageSync({ sourceDir, destDir, verify: true });

    expect(summary.totalScanned).toBe(2);
    expect(summary.alreadySynced).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.details.find((d) => d.key === "file-2.jpg")?.status).toBe("missing");
    expect(summary.markerWritten).toBe(false);
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it("detects conflicts without overwriting destination or creating marker", async () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });

    fs.writeFileSync(path.join(sourceDir, "asset.png"), "source-version");
    fs.writeFileSync(path.join(destDir, "asset.png"), "destination-altered-version");

    const summary = await runMediaStorageSync({ sourceDir, destDir });

    expect(summary.totalScanned).toBe(1);
    expect(summary.conflicts).toBe(1);
    expect(summary.copied).toBe(0);
    expect(summary.markerWritten).toBe(false);
    expect(fs.existsSync(markerPath)).toBe(false);
    // Preserves original destination file
    expect(fs.readFileSync(path.join(destDir, "asset.png"), "utf8")).toBe("destination-altered-version");
  });

  it("successfully live-syncs and writes verified migration marker when complete", async () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });

    fs.writeFileSync(path.join(sourceDir, "img1.png"), "image-1-bytes");
    fs.mkdirSync(path.join(sourceDir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "sub/img2.png"), "image-2-bytes");

    const syncSummary = await runMediaStorageSync({ sourceDir, destDir });

    expect(syncSummary.totalScanned).toBe(2);
    expect(syncSummary.copied).toBe(2);
    expect(syncSummary.errors).toBe(0);
    expect(syncSummary.conflicts).toBe(0);
    expect(syncSummary.markerWritten).toBe(true);
    expect(fs.existsSync(markerPath)).toBe(true);

    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    expect(marker.version).toBe(1);
    expect(marker.status).toBe("complete");
    expect(marker.totalVerified).toBe(2);

    // Now run verify-only mode over the complete state
    const verifySummary = await runMediaStorageSync({ sourceDir, destDir, verify: true });
    expect(verifySummary.totalScanned).toBe(2);
    expect(verifySummary.alreadySynced).toBe(2);
    expect(verifySummary.errors).toBe(0);
    expect(verifySummary.conflicts).toBe(0);
    expect(verifySummary.markerWritten).toBe(true);
  });

  it("removes stale marker if conflict is introduced later", async () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });

    fs.writeFileSync(path.join(sourceDir, "doc.pdf"), "good-content");
    await runMediaStorageSync({ sourceDir, destDir });
    expect(fs.existsSync(markerPath)).toBe(true);

    // Tamper with destination
    fs.writeFileSync(path.join(destDir, "doc.pdf"), "corrupted-content");

    const verifySummary = await runMediaStorageSync({ sourceDir, destDir, verify: true });
    expect(verifySummary.conflicts).toBe(1);
    // Stale marker must be removed
    expect(fs.existsSync(markerPath)).toBe(false);
  });
});
