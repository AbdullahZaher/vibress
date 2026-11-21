#!/usr/bin/env node
/** M00-E04 — deterministic CMS/Studio compatibility baseline manifest. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;
export const OUTPUT_PATH =
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/CMS-STUDIO-COMPATIBILITY-MANIFEST.json";

const DIMENSIONS = [
  ["two-publications", "tests/fixtures/cms-studio/fixture-pack.ts", "Pinned primary + secondary publications"],
  ["pub-default-compatibility", "packages/database/src/schema/operations.ts", "Legacy fallback is explicit, not an application identity"],
  ["users-memberships-roles", "tests/integration/runtime-multi-publication-isolation.test.ts", "Membership and role isolation"],
  ["subscriptions-payments", "tests/integration/transactions.test.ts", "Subscription/payment reference behavior"],
  ["media-files", "tests/integration/studio-public-content.test.ts", "Media and file references"],
  ["studio-documents", "tests/unit/cms-studio-fixture-pack.test.ts", "Pinned Studio document schema/version"],
  ["yjs-document-version", "tests/fixtures/cms-studio/fixture-pack.ts", "Lexical/Yjs version pinned in fixture"],
  ["delayed-jobs", "tests/integration/worker-scheduling.test.ts", "Delayed job references"],
  ["transactional-outbox", "tests/integration/outbox.test.ts", "Outbox persistence and replay"],
  ["urls-localized-content", "tests/integration/multilingual-production-verification.test.ts", "Existing URLs and localized content"],
  ["migration-restore-invariants", "docs/platform-roadmap/execution/universal-platform-2026-11-21/M03-D02-BACKFILL-PITR-DRILL-REPORT.md", "Migration/restore evidence"],
  ["kernel-identity-boundary", "packages/tenancy/src/scope.ts", "pub_default is rejected as application/tenant identity"],
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildCmsCompatibilityManifest(root) {
  const packFile = path.join(root, "tests/fixtures/cms-studio/fixture-pack.ts");
  const packSource = fs.readFileSync(packFile, "utf8");
  return {
    schemaVersion: SCHEMA_VERSION,
    fixturePack: {
      source: "tests/fixtures/cms-studio/fixture-pack.ts",
      sourceSha256: sha256(packSource),
      pinnedDigestConstant: /CMS_STUDIO_FIXTURE_PACK_DIGEST\s*=\s*"([0-9a-f]{64})"/.exec(packSource)?.[1] ?? null,
      schema: /CMS_STUDIO_FIXTURE_PACK_SCHEMA\s*=\s*"([^"]+)"/.exec(packSource)?.[1] ?? null,
      version: Number(/CMS_STUDIO_FIXTURE_PACK_VERSION\s*=\s*(\d+)/.exec(packSource)?.[1] ?? 0),
    },
    dimensions: DIMENSIONS.map(([id, evidence, requirement]) => ({
      id,
      requirement,
      evidence,
      evidencePresent: fs.existsSync(path.join(root, evidence)),
    })),
    immutable: true,
    note: "This manifest binds existing fixtures to requirements; it does not re-create fixtures or claim runtime restore results.",
  };
}

export function validateCmsManifest(manifest) {
  const errors = [];
  if (manifest.schemaVersion !== SCHEMA_VERSION) errors.push("bad schemaVersion");
  if (!/^[0-9a-f]{64}$/.test(manifest.fixturePack.pinnedDigestConstant ?? "")) {
    errors.push("pinned fixture digest constant missing or malformed");
  }
  if (manifest.fixturePack.version < 1) errors.push("fixture pack version missing");
  for (const dimension of manifest.dimensions) {
    if (!dimension.evidencePresent) errors.push(`${dimension.id}: missing evidence ${dimension.evidence}`);
  }
  if (manifest.dimensions.length !== DIMENSIONS.length) errors.push("incomplete compatibility dimensions");
  return errors;
}
