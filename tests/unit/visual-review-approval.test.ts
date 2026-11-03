import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  approveVisualReview,
  verifyVisualReviewApproval,
  computeApprovalSignature,
} from "../../scripts/approve-theme-studio-review";
import zlib from "node:zlib";
import { computeCrc32 } from "../../scripts/lib/png-integrity";

function createValidPngBuffer(): Buffer {
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(10, 0);
  ihdrData.writeUInt32BE(10, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;

  const ihdrTypeAndData = Buffer.concat([Buffer.from("IHDR", "ascii"), ihdrData]);
  const ihdrCrc = computeCrc32(ihdrTypeAndData);
  const ihdrChunk = Buffer.alloc(4 + 4 + 13 + 4);
  ihdrChunk.writeUInt32BE(13, 0);
  ihdrTypeAndData.copy(ihdrChunk, 4);
  ihdrChunk.writeUInt32BE(ihdrCrc, 21);

  const rawRaster = Buffer.alloc(10 * (1 + 10 * 3), 100);
  for (let y = 0; y < 10; y++) rawRaster[y * (1 + 10 * 3)] = 0; // Valid PNG unfiltered scanlines.
  const compressedIdat = zlib.deflateSync(rawRaster);
  const idatTypeAndData = Buffer.concat([Buffer.from("IDAT", "ascii"), compressedIdat]);
  const idatCrc = computeCrc32(idatTypeAndData);
  const idatChunk = Buffer.alloc(4 + 4 + compressedIdat.length + 4);
  idatChunk.writeUInt32BE(compressedIdat.length, 0);
  idatTypeAndData.copy(idatChunk, 4);
  idatChunk.writeUInt32BE(idatCrc, 4 + 4 + compressedIdat.length);

  const iendTypeAndData = Buffer.from("IEND", "ascii");
  const iendCrc = computeCrc32(iendTypeAndData);
  const iendChunk = Buffer.alloc(4 + 4 + 0 + 4);
  iendChunk.writeUInt32BE(0, 0);
  iendTypeAndData.copy(iendChunk, 4);
  iendChunk.writeUInt32BE(iendCrc, 8);

  return Buffer.concat([PNG_MAGIC, ihdrChunk, idatChunk, iendChunk]);
}

describe("Independent Visual Review Approval Workflow (P1)", () => {
  const testDir = path.join(process.cwd(), "tmp-test-review-approval");
  const manifestPath = path.join(testDir, "manifest.json");
  const dummyCommit = "74814eb4e5127df81a3996e3e7158b080ef41983";
  const oldKey = process.env.THEME_STUDIO_REVIEW_SIGNING_KEY;

  beforeEach(async () => {
    process.env.THEME_STUDIO_REVIEW_SIGNING_KEY = "b".repeat(64);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (oldKey === undefined) delete process.env.THEME_STUDIO_REVIEW_SIGNING_KEY;
    else process.env.THEME_STUDIO_REVIEW_SIGNING_KEY = oldKey;
    await rm(testDir, { recursive: true, force: true });
  });

  it("successfully approves visual review when commit and screenshot checksums match", async () => {
    const pngBuffer = createValidPngBuffer();
    const screenshotName = "sample-screenshot.png";
    await writeFile(path.join(testDir, screenshotName), pngBuffer);
    const hash = crypto.createHash("sha256").update(pngBuffer).digest("hex");

    const baseManifest = {
      commitSha: dummyCommit,
      status: {
        capture_completed: true,
        automated_checks_passed: true,
        visual_review_pending: true,
        visual_review_approved: false,
        overall_status: "automated_checks_passed",
      },
      screenshots: [
        {
          filename: screenshotName,
          sha256: hash,
        },
      ],
    };
    await writeFile(manifestPath, JSON.stringify(baseManifest, null, 2), "utf8");

    const approval = await approveVisualReview({
      manifestPath,
      reviewerName: "Principal Product Designer",
      reviewerRole: "Design Systems Architect",
      commitSha: dummyCommit,
      score: 9.8,
      observations: {
        visualIdentity: "Authentic typography, restrained elevation, excellent Ghost-inspired polish.",
      },
      notes: "Independent review confirmed.",
    });

    expect(approval.certifiedScore).toBe(9.8);
    expect(approval.reviewerName).toBe("Principal Product Designer");
    expect(approval.approvalSignature).toMatch(/^[a-f0-9]{64}$/);

    const verification = await verifyVisualReviewApproval(manifestPath);
    expect(verification.isApproved).toBe(true);
    expect(verification.isValid).toBe(true);
  });

  it("rejects non-finite scores and empty reviewer observations", async () => {
    await expect(approveVisualReview({ manifestPath, reviewerName: "Auditor", reviewerRole: "QA",
      commitSha: dummyCommit, score: NaN, observations: { quality: "A detailed observation of this screenshot." },
    })).rejects.toThrow(/Certified score/);
    await expect(approveVisualReview({ manifestPath, reviewerName: "Auditor", reviewerRole: "QA",
      commitSha: dummyCommit, score: 9.8, observations: {},
    })).rejects.toThrow(/Documented, substantive/);
  });

  it("refuses approval without the protected signing key", async () => {
    delete process.env.THEME_STUDIO_REVIEW_SIGNING_KEY;
    expect(() => computeApprovalSignature(dummyCommit, [], "Reviewer", new Date().toISOString(), 9.5))
      .toThrow(/protected THEME_STUDIO_REVIEW_SIGNING_KEY/);
  });

  it("fails closed when automated checks have not passed", async () => {
    const baseManifest = {
      commitSha: dummyCommit,
      status: {
        capture_completed: true,
        automated_checks_passed: false,
        visual_review_pending: true,
        visual_review_approved: false,
      },
      screenshots: [],
    };
    await writeFile(manifestPath, JSON.stringify(baseManifest), "utf8");

    await expect(
      approveVisualReview({
        manifestPath,
        reviewerName: "Auditor",
        reviewerRole: "Staff QA",
        commitSha: dummyCommit,
        score: 9.7,
        observations: {
          visual_hierarchy: "Substantive detailed audit observation for test validation.",
        },
      }),
    ).rejects.toThrow(/manifest reports automated checks have not passed/);
  });

  it("fails closed when commit SHA mismatches", async () => {
    const baseManifest = {
      commitSha: "different-commit-1111",
      status: { automated_checks_passed: true },
      screenshots: [{ filename: "x.png", sha256: "abc" }],
    };
    await writeFile(manifestPath, JSON.stringify(baseManifest), "utf8");

    await expect(
      approveVisualReview({
        manifestPath,
        reviewerName: "Auditor",
        reviewerRole: "Staff QA",
        commitSha: dummyCommit,
        score: 9.7,
        observations: {
          visual_hierarchy: "Substantive detailed audit observation for test validation.",
        },
      }),
    ).rejects.toThrow(/Commit SHA mismatch/);
  });

  it("detects tampered or modified screenshots after approval", async () => {
    const pngBuffer = createValidPngBuffer();
    const screenshotName = "sample-tamper.png";
    const filePath = path.join(testDir, screenshotName);
    await writeFile(filePath, pngBuffer);
    const hash = crypto.createHash("sha256").update(pngBuffer).digest("hex");

    const baseManifest = {
      commitSha: dummyCommit,
      status: { automated_checks_passed: true },
      screenshots: [{ filename: screenshotName, sha256: hash }],
    };
    await writeFile(manifestPath, JSON.stringify(baseManifest), "utf8");

    await approveVisualReview({
      manifestPath,
      reviewerName: "Auditor",
      reviewerRole: "Lead Designer",
      commitSha: dummyCommit,
      score: 9.8,
      observations: { quality: "I manually inspected the fixture screenshot and layout state." },
    });

    // Tamper with the screenshot file on disk
    await writeFile(filePath, Buffer.from("TAMPERED_CONTENT_DATA"));

    const verification = await verifyVisualReviewApproval(manifestPath);
    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain("modified since approval");
  });
});

