import { readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { decodePng } from "./lib/png-integrity";

export interface ReviewApprovalInput {
  manifestPath: string;
  reviewerName: string;
  reviewerRole: string;
  commitSha: string;
  score: number;
  observations: Record<string, string>;
  notes?: string;
}

export interface ReviewApprovalRecord {
  reviewerName: string;
  reviewerRole: string;
  approvedAt: string;
  commitSha: string;
  certifiedScore: number;
  approvalSignature: string;
  observations: Record<string, string>;
  standardsChecked: string[];
  notes?: string;
}

/**
 * Computes a tamper-evident cryptographic signature binding the reviewer, commit SHA,
 * certified score, timestamp, and the exact set of screenshot SHA-256 hashes.
 */
export function computeApprovalSignature(
  commitSha: string,
  screenshotHashes: string[],
  reviewerName: string,
  approvedAt: string,
  score: number,
  reviewerRole: string = "",
  observations: Record<string, string> = {},
  notes?: string,
): string {
  const signingKey = process.env.THEME_STUDIO_REVIEW_SIGNING_KEY;
  if (!signingKey || !/^[a-f0-9]{64,}$/i.test(signingKey) || signingKey.length % 2 !== 0) {
    throw new Error("A protected THEME_STUDIO_REVIEW_SIGNING_KEY (32+ random bytes, hex) is required.");
  }
  return crypto
    .createHmac("sha256", Buffer.from(signingKey, "hex"))
    .update(JSON.stringify({
      commitSha, screenshotHashes: [...screenshotHashes].sort(),
      reviewerName, reviewerRole, approvedAt, score,
      observations: Object.fromEntries(Object.entries(observations).sort()),
      notes: notes ?? null,
    }))
    .digest("hex");
}

/**
 * Approves a visual review manifest after rigorously verifying that:
 * 1. Automated checks have passed.
 * 2. The target commit SHA exactly matches the manifest.
 * 3. Every screenshot file exists on disk, fully decodes, and matches its recorded SHA-256 checksum.
 * 4. Fails closed if any artifact was modified, corrupted, or deleted.
 */
export async function approveVisualReview(input: ReviewApprovalInput): Promise<ReviewApprovalRecord> {
  const { manifestPath, reviewerName, reviewerRole, commitSha, score, observations, notes } = input;

  if (!reviewerName?.trim()) throw new Error("Reviewer name is required for manual visual review approval.");
  if (!reviewerRole?.trim()) throw new Error("Reviewer role is required for manual visual review approval.");
  if (!commitSha?.trim()) throw new Error("Target commit SHA is required for manual visual review approval.");
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new Error("Certified score must be a number between 0.0 and 10.0.");
  }

  if (!observations || typeof observations !== "object" || Array.isArray(observations) ||
      !Object.values(observations).some((text) => typeof text === "string" && text.trim().length >= 20)) {
    throw new Error("Documented, substantive reviewer observations are required. No automatic approval.");
  }
  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);

  if (!manifest.status?.automated_checks_passed) {
    throw new Error(
      "Cannot approve visual review: manifest reports automated checks have not passed.",
    );
  }

  if (manifest.commitSha !== commitSha) {
    throw new Error(
      `Commit SHA mismatch: manifest was generated for commit "${manifest.commitSha}", but approval was requested for "${commitSha}".`,
    );
  }

  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length === 0) {
    throw new Error("Cannot approve visual review: manifest contains no screenshot entries.");
  }

  const manifestDir = path.dirname(manifestPath);
  const hashes: string[] = [];

  // Verify every single screenshot on disk against its recorded hash
  for (const entry of manifest.screenshots) {
    const filePath = path.join(manifestDir, entry.filename);
    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      throw new Error(`Approval rejected: screenshot "${entry.filename}" missing from disk.`);
    }

    // Verify binary PNG integrity
    try {
      decodePng(buffer);
    } catch (err: any) {
      throw new Error(`Approval rejected: screenshot "${entry.filename}" failed binary PNG decoding: ${err.message}`);
    }

    const currentHash = crypto.createHash("sha256").update(buffer).digest("hex");
    if (currentHash !== entry.sha256) {
      throw new Error(
        `Tamper-evidence failure: screenshot "${entry.filename}" hash on disk (${currentHash}) does not match manifest hash (${entry.sha256}).`,
      );
    }

    hashes.push(currentHash);
  }

  const approvedAt = new Date().toISOString();
  const approvalSignature = computeApprovalSignature(
    commitSha,
    hashes,
    reviewerName,
    approvedAt,
    score, reviewerRole, observations, notes,
  );

  const approvalRecord: ReviewApprovalRecord = {
    reviewerName,
    reviewerRole,
    approvedAt,
    commitSha,
    certifiedScore: score,
    approvalSignature,
    standardsChecked: [
      "Apple Human Interface Guidelines (Restraint & Typography)",
      "Ghost Admin (Editorial Minimalism)",
      "Shopify Theme Editor (Ergonomics & Layout)",
      "WCAG 2.2 Level AA (Contrast, 44px Touch Targets, 200% Text Scaling)",
    ],
    observations,
    notes,
  };

  manifest.status.visual_review_pending = false;
  manifest.status.visual_review_approved = true;
  manifest.status.overall_status = "visual_review_approved";
  manifest.reviewApproval = approvalRecord;

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return approvalRecord;
}

/**
 * Validates that an approved manifest remains un-tampered and matches current disk state.
 */
export async function verifyVisualReviewApproval(manifestPath: string): Promise<{
  isApproved: boolean;
  isValid: boolean;
  error?: string;
}> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);

    if (!manifest.status?.visual_review_approved || !manifest.reviewApproval) {
      return { isApproved: false, isValid: true };
    }

    const approval: ReviewApprovalRecord = manifest.reviewApproval;
    const manifestDir = path.dirname(manifestPath);
    const hashes: string[] = [];

    for (const entry of manifest.screenshots) {
      const filePath = path.join(manifestDir, entry.filename);
      const buffer = await readFile(filePath);
      const currentHash = crypto.createHash("sha256").update(buffer).digest("hex");
      if (currentHash !== entry.sha256) {
        return {
          isApproved: false,
          isValid: false,
          error: `Screenshot ${entry.filename} has been modified since approval`,
        };
      }
      hashes.push(currentHash);
    }

    if (manifest.commitSha !== approval.commitSha) {
      return { isApproved: false, isValid: false, error: "Approved commit differs from captured manifest" };
    }
    const expectedSig = computeApprovalSignature(
      approval.commitSha, hashes, approval.reviewerName, approval.approvedAt,
      approval.certifiedScore, approval.reviewerRole, approval.observations, approval.notes,
    );
    const signed = approval.approvalSignature;
    if (typeof signed !== "string" || !/^[a-f0-9]{64}$/i.test(signed) ||
        !crypto.timingSafeEqual(Buffer.from(expectedSig, "hex"), Buffer.from(signed, "hex"))) {
      return {
        isApproved: false,
        isValid: false,
        error: "Approval cryptographic signature mismatch",
      };
    }

    return { isApproved: true, isValid: true };
  } catch (err: any) {
    return { isApproved: false, isValid: false, error: err.message };
  }
}

export async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const manifestPath =
    getArg("--manifest") ||
    process.env.THEME_STUDIO_MANIFEST_PATH ||
    path.join(process.cwd(), "artifacts/theme-studio/manifest.json");

  const reviewerName = getArg("--reviewer") || process.env.THEME_STUDIO_REVIEWER_NAME;
  if (!reviewerName) throw new Error("Explicit --reviewer identity is required.");

  const reviewerRole = getArg("--role") || process.env.THEME_STUDIO_REVIEWER_ROLE;
  if (!reviewerRole) throw new Error("Explicit --role is required.");

  const commitSha =
    getArg("--commit-sha") ||
    process.env.GITHUB_SHA ||
    process.env.THEME_STUDIO_COMMIT_SHA;

  if (!commitSha) {
    throw new Error(
      "Missing required --commit-sha argument. Approval must explicitly bind to the reviewed commit SHA.",
    );
  }

  const scoreStr = getArg("--score") || process.env.THEME_STUDIO_CERTIFIED_SCORE;
  if (!scoreStr) {
    throw new Error(
      "Missing required --score argument. Manual review must explicitly provide the independently calculated score.",
    );
  }
  const score = parseFloat(scoreStr);

  const observationsRaw = getArg("--observations") || process.env.THEME_STUDIO_OBSERVATIONS;
  if (!observationsRaw) throw new Error("Explicit reviewer observations JSON is required.");
  const observations = JSON.parse(observationsRaw);

  const notes = getArg("--notes") || process.env.THEME_STUDIO_REVIEW_NOTES;

  console.log(`Approving visual review manifest at ${manifestPath} for commit ${commitSha}...`);
  const record = await approveVisualReview({
    manifestPath,
    reviewerName,
    reviewerRole,
    commitSha,
    score,
    observations,
    notes,
  });

  console.log(`[VISUAL_REVIEW_APPROVED] Verified and approved by ${record.reviewerName} (${record.reviewerRole})`);
  console.log(`[VISUAL_REVIEW_APPROVED] Certified Score: ${record.certifiedScore.toFixed(2)} / 10`);
  console.log(`[VISUAL_REVIEW_APPROVED] Cryptographic Signature: ${record.approvalSignature}`);
}

const isDirectExecution = process.argv[1]?.endsWith("approve-theme-studio-review.ts");
if (isDirectExecution) {
  main().catch((err) => {
    console.error("Visual review approval failed:", err.message);
    process.exitCode = 1;
  });
}
