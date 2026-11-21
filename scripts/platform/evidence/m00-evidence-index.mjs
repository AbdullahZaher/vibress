#!/usr/bin/env node
/**
 * M00-E05 — milestone evidence integrity validator.
 *
 * Cross-checks the Epic ledger, repository inventory, PostgreSQL security
 * inventory and boundary test set. It verifies that referenced files exist,
 * SHAs are well formed and CI URLs are attributed. A documentation-only CI
 * run is explicitly NOT treated as runtime or security certification.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;
export const INDEX_PATH =
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/M00-EVIDENCE-INDEX.json";

export const ARTIFACTS = [
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/EPIC-EXECUTION-LEDGER.json",
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/REPOSITORY-INVENTORY.json",
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/POSTGRES-SECURITY-INVENTORY.json",
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/BRANCH-CONSOLIDATION-INVENTORY-2026-11-21.md",
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/M03-D02-BACKFILL-PITR-DRILL-REPORT.md",
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/M00-UNIT-FAILURE-ROOT-CAUSE-REGISTER.md",
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/M00-TEST-ENVIRONMENT-RECOVERY-REPORT.md",
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/M00-BASELINE-VS-CANDIDATE-REGRESSION-EVIDENCE.md",
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/M00-FINAL-MILESTONE-VERIFICATION.md",
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/M00-INDEPENDENT-CERTIFICATION-HANDOFF.md",
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/M00-FINAL-UNIT-TEST-LOG.txt",
];

export const TEST_SUITES = [
  "scripts/__tests__/execution-traceability.test.mjs",
  "scripts/__tests__/repository-inventory.test.mjs",
  "scripts/__tests__/crm-adopter-dx.test.mjs",
  "scripts/__tests__/external-consumer-proof.test.mjs",
  "packages/tenancy/src/__tests__/lifecycle.test.ts",
  "tests/architecture/m00-boundary-contract.test.ts",
  "scripts/__tests__/m00-completion.test.mjs",
];

const SHA = /^[0-9a-f]{40}$/;
const CI_URL = /^https:\/\/github\.com\/AbdullahZaher\/vibress\/actions\/runs\/\d+$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

export function buildEvidenceIndex(root) {
  const artifacts = ARTIFACTS.filter((relative) => fs.existsSync(path.join(root, relative))).map((relative) => ({
    path: relative,
    sha256: sha256(fs.readFileSync(path.join(root, relative))),
  }));
  const tests = TEST_SUITES.filter((relative) => fs.existsSync(path.join(root, relative))).map((relative) => ({
    path: relative,
    sha256: sha256(fs.readFileSync(path.join(root, relative))),
    negativeCases: /negative|reject|deny|forbid/i.test(fs.readFileSync(path.join(root, relative), "utf8")),
  }));
  const ledger = fs.existsSync(path.join(root, ARTIFACTS[0])) ? readJson(root, ARTIFACTS[0]) : null;
  const pinnedShas = new Set();
  const ciRuns = new Set();
  const referencedPaths = new Set();
  for (const epic of ledger?.epics ?? []) {
    if (epic.implementation?.codeSha) pinnedShas.add(epic.implementation.codeSha);
    for (const url of epic.evidence?.ciRunUrls ?? []) ciRuns.add(url);
    for (const source of epic.evidence?.sourcePaths ?? []) referencedPaths.add(source);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    artifacts,
    testSuites: tests,
    attribution: {
      implementationShas: [...pinnedShas].sort(),
      ciRunUrls: [...ciRuns].sort(),
      referencedSourcePaths: [...referencedPaths].sort(),
    },
    explicitSkips: [],
    mandatoryChecks: [
      "typecheck",
      "lint",
      "unit",
      "architecture-boundaries",
      "postgres-privilege-inventory",
      "cms-studio-compatibility",
      "external-consumer",
      "repository-ci",
    ],
    supplyChainFindings: [],
    certificationNotice:
      "Documentation-only CI does not certify runtime security, RLS, recovery or release readiness.",
  };
}

export function validateEvidenceIndex(index, root) {
  const errors = [];
  if (index.schemaVersion !== SCHEMA_VERSION) errors.push("bad schemaVersion");
  for (const artifact of index.artifacts) {
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256)) errors.push(`${artifact.path}: bad digest`);
    if (!fs.existsSync(path.join(root, artifact.path))) errors.push(`${artifact.path}: missing artifact`);
  }
  if (index.artifacts.length !== ARTIFACTS.length) errors.push("not all required artifacts are present");
  if (index.testSuites.length !== TEST_SUITES.length) errors.push("not all required test suites are present");
  if (!index.testSuites.some((suite) => suite.negativeCases)) errors.push("no negative test suite identified");
  for (const sha of index.attribution.implementationShas) {
    if (!SHA.test(sha)) errors.push(`bad implementation SHA: ${sha}`);
  }
  for (const url of index.attribution.ciRunUrls) {
    if (!CI_URL.test(url)) errors.push(`bad CI run URL: ${url}`);
  }
  for (const source of index.attribution.referencedSourcePaths) {
    if (!fs.existsSync(path.join(root, source))) errors.push(`referenced source missing: ${source}`);
  }
  if (!/documentation-only/i.test(index.certificationNotice)) {
    errors.push("certification notice must state that docs CI is not runtime certification");
  }
  return errors;
}
