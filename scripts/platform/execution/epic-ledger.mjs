#!/usr/bin/env node
/**
 * M00-E06 — Epic execution traceability ledger.
 *
 * The Wave checklists are the human-readable source of truth for scope and
 * engineering assessment. This module parses them into a machine-readable
 * ledger and enforces that no Epic can be reported as closed without pinned
 * source, test, independent-review and owner-authorization evidence.
 *
 * It deliberately contains no percentages, dates or inferred approvals. It
 * checks structure and evidence completeness only; it cannot certify code.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 1;
export const PLAN_VERSION = "2026-11-21";

export const EXECUTION_DOCS_DIR =
  "docs/platform-roadmap/execution/universal-platform-2026-11-21";
export const MILESTONE_DOCS_DIR = "docs/platform-roadmap/milestones";
export const REGISTRY_PATH = `${EXECUTION_DOCS_DIR}/EPIC-EXECUTION-LEDGER.json`;
export const LEDGER_MARKDOWN_PATH = `${EXECUTION_DOCS_DIR}/EPIC-EXECUTION-LEDGER.md`;

/** Wave file → milestones it owns and the exact Epic count it must enumerate. */
export const WAVES = [
  { file: "WAVE-01-M00-M02.md", milestones: ["M00", "M01", "M02"], epicCount: 37 },
  { file: "WAVE-02-M03-M06.md", milestones: ["M03", "M04", "M05", "M06"], epicCount: 42 },
  { file: "WAVE-03-M07-M08.md", milestones: ["M07", "M08"], epicCount: 23 },
  { file: "WAVE-04-M09-M10.md", milestones: ["M09", "M10"], epicCount: 18 },
  { file: "WAVE-05-M11-M12.md", milestones: ["M11", "M12"], epicCount: 20 },
];

export const MILESTONES = Array.from({ length: 13 }, (_, index) => {
  const id = `M${String(index).padStart(2, "0")}`;
  return { id, issue: 152 + index };
});

export const TOTAL_EPICS = 140;

/** Directive §10 execution status vocabulary. Exactly these values are legal. */
export const EXECUTION_STATUSES = Object.freeze([
  "NOT_STARTED",
  "IN_PROGRESS",
  "IMPLEMENTED_PENDING_TESTS",
  "TESTED_PENDING_REVIEW",
  "INDEPENDENTLY_ACCEPTED",
  "BLOCKED",
  "MERGED",
  "FORMALLY_CLOSED",
]);

export const AGENT_IDS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => `A${String(index + 1).padStart(2, "0")}`),
);

/**
 * Assessment markers used by the Wave checklists map to a conservative
 * execution status. A restricted certification never means the whole Epic is
 * accepted, so it maps to TESTED_PENDING_REVIEW with scope RESTRICTED.
 */
export const ASSESSMENT_TO_STATUS = Object.freeze({
  NOT_ACCEPTED: "NOT_STARTED",
  NOT_EVIDENCED: "NOT_STARTED",
  NOT_VERIFIED: "NOT_STARTED",
  PARTIAL: "IN_PROGRESS",
  PARTIAL_REUSE: "IN_PROGRESS",
  PARTIAL_BLOCKED_D02: "IN_PROGRESS",
  PARTIAL_GOVERNANCE_D03: "IN_PROGRESS",
  IN_PROGRESS_CONTRACT_ONLY: "IN_PROGRESS",
  IN_PROGRESS_MOCK_ONLY: "IN_PROGRESS",
  IN_PROGRESS_METADATA_ONLY: "IN_PROGRESS",
  REUSE_BASELINE: "IN_PROGRESS",
  IMPLEMENTED_RESTRICTED: "IMPLEMENTED_PENDING_TESTS",
  CERTIFIED_RESTRICTED: "TESTED_PENDING_REVIEW",
  CERTIFIED_RESTRICTED_D01: "TESTED_PENDING_REVIEW",
  BLOCKED_GOVERNANCE: "BLOCKED",
});

const RESTRICTED_ASSESSMENTS = new Set([
  "IMPLEMENTED_RESTRICTED",
  "CERTIFIED_RESTRICTED",
  "CERTIFIED_RESTRICTED_D01",
  "REUSE_BASELINE",
  "PARTIAL_REUSE",
]);

const BLOCKED_ASSESSMENTS = new Set([
  "BLOCKED_GOVERNANCE",
  "PARTIAL_BLOCKED_D02",
  "PARTIAL_GOVERNANCE_D03",
]);

const EPIC_HEADER =
  /^- \[( |x)\] \*\*(M\d{2}-E\d{2}) — (.+?)\*\* · `([A-Z_0-9]+)` · ([A-Za-z0-9/]+)\./;

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const URL_PATTERN = /^https:\/\/github\.com\/AbdullahZaher\/vibress\//;

export function repoRootFromModule() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

/** Parse all Wave checklists. Returns parsed epics plus structural issues. */
export function parseWaveDocs(repoRoot) {
  const epics = [];
  const issues = [];
  const seen = new Map();
  const waveCounts = {};

  for (const wave of WAVES) {
    const file = path.join(repoRoot, EXECUTION_DOCS_DIR, wave.file);
    const body = readIfExists(file);
    if (body === null) {
      issues.push(`${wave.file}: wave checklist is missing`);
      continue;
    }
    let count = 0;
    for (const line of body.split("\n")) {
      const match = EPIC_HEADER.exec(line);
      if (!match) continue;
      const [, checked, id, title, assessment, owners] = match;
      count += 1;
      const milestone = id.slice(0, 3);
      if (!wave.milestones.includes(milestone)) {
        issues.push(`${wave.file}: ${id} belongs to ${milestone}, outside this wave`);
      }
      if (checked === "x") {
        issues.push(`${wave.file}: ${id} is checked without a linked evidence row`);
      }
      if (seen.has(id)) {
        issues.push(`${wave.file}: duplicate Epic ${id} (first in ${seen.get(id)})`);
      }
      seen.set(id, wave.file);
      if (!ASSESSMENT_TO_STATUS[assessment]) {
        issues.push(`${wave.file}: ${id} has unknown assessment marker ${assessment}`);
      }
      const ownerList = owners.split("/");
      for (const owner of ownerList) {
        if (!AGENT_IDS.includes(owner)) {
          issues.push(`${wave.file}: ${id} names unknown owner ${owner}`);
        }
      }
      epics.push({
        id,
        milestone,
        title,
        assessment,
        owners: ownerList,
        wave: wave.file,
      });
    }
    waveCounts[wave.file] = count;
    if (count !== wave.epicCount) {
      issues.push(`${wave.file}: expected ${wave.epicCount} Epics, found ${count}`);
    }
  }

  if (epics.length !== TOTAL_EPICS) {
    issues.push(`expected ${TOTAL_EPICS} Epics across waves, found ${epics.length}`);
  }
  return { epics, issues, waveCounts };
}

/** Parse the normative milestone specifications and verify the same Epic set. */
export function parseMilestoneDocs(repoRoot) {
  const epics = new Map();
  const issues = [];
  const directory = path.join(repoRoot, MILESTONE_DOCS_DIR);
  if (!fs.existsSync(directory)) {
    return { epics, issues: [`${MILESTONE_DOCS_DIR}: milestone directory is missing`] };
  }
  for (const milestone of MILESTONES) {
    const prefix = `${milestone.id}-`;
    const file = fs
      .readdirSync(directory)
      .find((name) => name.startsWith(prefix) && name.endsWith(".md"));
    if (!file) {
      issues.push(`${MILESTONE_DOCS_DIR}: missing specification for ${milestone.id}`);
      continue;
    }
    const body = fs.readFileSync(path.join(directory, file), "utf8");
    for (const match of body.matchAll(/^### (M\d{2}-E\d{2}) — (.+)$/gm)) {
      const [, id, title] = match;
      if (epics.has(id)) issues.push(`${file}: duplicate Epic ${id}`);
      epics.set(id, { id, title: title.trim() });
    }
  }
  return { epics, issues };
}

/** Rebuild registry entries from parsed docs while preserving human evidence. */
export function buildRegistry(parsedWave, parsedMilestones, existing) {
  const previous = new Map(
    (existing?.epics ?? []).map((epic) => [epic.id, epic]),
  );
  const epics = parsedWave.epics
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((parsed) => {
      const prior = previous.get(parsed.id) ?? {};
      const milestoneSpec = parsedMilestones.epics.get(parsed.id);
      return {
        id: parsed.id,
        milestone: parsed.milestone,
        title: parsed.title,
        milestoneSpecTitle: milestoneSpec?.title ?? null,
        wave: parsed.wave,
        owners: parsed.owners,
        assessment: parsed.assessment,
        executionStatus:
          prior.assessment === parsed.assessment && prior.executionStatus
            ? prior.executionStatus
            : ASSESSMENT_TO_STATUS[parsed.assessment],
        scope: RESTRICTED_ASSESSMENTS.has(parsed.assessment)
          ? "RESTRICTED"
          : prior.scope ?? "NONE",
        formallyClosed: false,
        implementation: {
          codeSha: prior.implementation?.codeSha ?? null,
          pullRequest: prior.implementation?.pullRequest ?? null,
          branch: prior.implementation?.branch ?? null,
        },
        evidence: {
          sourcePaths: prior.evidence?.sourcePaths ?? [],
          testNames: prior.evidence?.testNames ?? [],
          ciRunUrls: prior.evidence?.ciRunUrls ?? [],
          notes: prior.evidence?.notes ?? [],
        },
        independentReview: {
          verdict: prior.independentReview?.verdict ?? null,
          url: prior.independentReview?.url ?? null,
          reviewedSha: prior.independentReview?.reviewedSha ?? null,
        },
        merge: {
          mergeSha: prior.merge?.mergeSha ?? null,
          mergedTo: prior.merge?.mergedTo ?? null,
        },
        ownerAuthorization: {
          status: prior.ownerAuthorization?.status ?? "PENDING",
          url: prior.ownerAuthorization?.url ?? null,
        },
        blockers:
          prior.blockers ??
          (BLOCKED_ASSESSMENTS.has(parsed.assessment)
            ? ["Owner/human governance approval required; see Wave checklist."]
            : []),
      };
    });
  return {
    schemaVersion: SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    registryPath: REGISTRY_PATH,
    sourceDocuments: {
      waves: WAVES.map((wave) => `${EXECUTION_DOCS_DIR}/${wave.file}`),
      milestones: MILESTONE_DOCS_DIR,
    },
    epics,
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function isGithubUrl(value) {
  return typeof value === "string" && URL_PATTERN.test(value);
}

function findInventedMetrics(node, pointer, hits) {
  if (Array.isArray(node)) {
    node.forEach((value, index) => findInventedMetrics(value, `${pointer}[${index}]`, hits));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (/(percent|burndown|completionPercent|progressPercent)/i.test(key)) {
        hits.push(`${pointer}.${key}`);
      }
      findInventedMetrics(value, `${pointer}.${key}`, hits);
    }
  }
}

/** Validate the ledger against the Wave checklists and the closure protocol. */
export function validateLedger(registry, parsedWave, parsedMilestones) {
  const errors = [...parsedWave.issues, ...parsedMilestones.issues];
  const warnings = [];

  if (!registry || typeof registry !== "object") {
    return { errors: [...errors, "ledger is missing or not an object"], warnings };
  }
  if (registry.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`ledger schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!Array.isArray(registry.epics)) {
    return { errors: [...errors, "ledger.epics must be an array"], warnings };
  }

  const invented = [];
  findInventedMetrics(registry, "$", invented);
  for (const hit of invented) {
    errors.push(`${hit}: invented progress metrics are forbidden; record evidence instead`);
  }

  const byId = new Map();
  for (const epic of registry.epics) {
    if (byId.has(epic.id)) errors.push(`${epic.id}: duplicate ledger entry`);
    byId.set(epic.id, epic);
  }

  const expected = new Set(parsedWave.epics.map((epic) => epic.id));
  for (const id of expected) {
    if (!byId.has(id)) errors.push(`${id}: missing from ledger`);
  }
  for (const id of byId.keys()) {
    if (!expected.has(id)) errors.push(`${id}: ledger entry is not present in any Wave checklist`);
  }

  const parsedById = new Map(parsedWave.epics.map((epic) => [epic.id, epic]));
  const milestoneSpecById = parsedMilestones.epics;

  for (const epic of registry.epics) {
    const parsed = parsedById.get(epic.id);
    if (!parsed) continue;
    const where = epic.id;

    if (epic.milestone !== epic.id.slice(0, 3)) {
      errors.push(`${where}: milestone does not match Epic ID prefix`);
    }
    if (!EXECUTION_STATUSES.includes(epic.executionStatus)) {
      errors.push(`${where}: illegal executionStatus ${String(epic.executionStatus)}`);
    }
    if (!["FULL", "RESTRICTED", "NONE"].includes(epic.scope)) {
      errors.push(`${where}: illegal scope ${String(epic.scope)}`);
    }
    if (!Array.isArray(epic.owners) || epic.owners.length === 0) {
      errors.push(`${where}: at least one owner agent is required`);
    } else {
      for (const owner of epic.owners) {
        if (!AGENT_IDS.includes(owner)) errors.push(`${where}: unknown owner ${owner}`);
      }
    }
    if (!Array.isArray(epic.blockers)) {
      errors.push(`${where}: blockers must be an array`);
    }
    if (typeof epic.formallyClosed !== "boolean") {
      errors.push(`${where}: formallyClosed must be boolean`);
    }

    // Drift: the ledger must never silently diverge from the checklist source.
    if (epic.assessment !== parsed.assessment) {
      errors.push(
        `${where}: assessment drift (ledger ${epic.assessment}, checklist ${parsed.assessment}); run --write`,
      );
    }
    if (epic.title !== parsed.title) {
      errors.push(`${where}: title drift from Wave checklist; run --write`);
    }
    if (epic.owners.join("/") !== parsed.owners.join("/")) {
      errors.push(`${where}: owner drift from Wave checklist; run --write`);
    }
    if (!milestoneSpecById.has(epic.id)) {
      errors.push(`${where}: Epic is absent from the normative milestone specification`);
    } else if (epic.milestoneSpecTitle !== milestoneSpecById.get(epic.id).title) {
      errors.push(`${where}: milestoneSpecTitle drift; run --write`);
    }

    const review = epic.independentReview ?? {};
    const merge = epic.merge ?? {};
    const authorization = epic.ownerAuthorization ?? {};
    const implementation = epic.implementation ?? {};
    const evidence = epic.evidence ?? {};

    if (epic.executionStatus === "FORMALLY_CLOSED" && !epic.formallyClosed) {
      errors.push(`${where}: FORMALLY_CLOSED requires formallyClosed=true`);
    }
    if (epic.formallyClosed && epic.executionStatus !== "FORMALLY_CLOSED") {
      errors.push(`${where}: formallyClosed=true requires executionStatus FORMALLY_CLOSED`);
    }
    if (epic.executionStatus === "MERGED" && !isSha(merge.mergeSha)) {
      errors.push(`${where}: MERGED requires a 40-character merge SHA`);
    }
    if (epic.executionStatus === "INDEPENDENTLY_ACCEPTED") {
      if (review.verdict !== "ACCEPT" || !isGithubUrl(review.url)) {
        errors.push(`${where}: INDEPENDENTLY_ACCEPTED requires an ACCEPT review URL`);
      }
    }
    if (
      epic.executionStatus === "TESTED_PENDING_REVIEW" &&
      (!Array.isArray(evidence.testNames) || evidence.testNames.length === 0)
    ) {
      errors.push(`${where}: TESTED_PENDING_REVIEW requires named executed tests`);
    }

    if (epic.formallyClosed) {
      if (!isSha(implementation.codeSha)) {
        errors.push(`${where}: closure requires a pinned implementation SHA`);
      }
      if (!Number.isInteger(implementation.pullRequest) || implementation.pullRequest <= 0) {
        errors.push(`${where}: closure requires a pull request number`);
      }
      if (!Array.isArray(evidence.testNames) || evidence.testNames.length === 0) {
        errors.push(`${where}: closure requires named executed tests`);
      }
      if (!Array.isArray(evidence.ciRunUrls) || evidence.ciRunUrls.length === 0) {
        errors.push(`${where}: closure requires CI run URLs`);
      }
      if (review.verdict !== "ACCEPT" || !isGithubUrl(review.url)) {
        errors.push(`${where}: closure requires an independent ACCEPT verdict with URL`);
      }
      if (!isSha(review.reviewedSha) || review.reviewedSha !== implementation.codeSha) {
        errors.push(`${where}: independent review must pin the same SHA that was reviewed`);
      }
      if (!isSha(merge.mergeSha)) {
        errors.push(`${where}: closure requires a merge SHA`);
      }
      if (authorization.status !== "AUTHORIZED" || !isGithubUrl(authorization.url)) {
        errors.push(`${where}: closure requires recorded owner authorization with URL`);
      }
      if (epic.scope !== "FULL") {
        errors.push(`${where}: a RESTRICTED scope can never close the whole Epic`);
      }
      if (Array.isArray(epic.blockers) && epic.blockers.length > 0) {
        errors.push(`${where}: closure requires zero open blockers`);
      }
      if (RESTRICTED_ASSESSMENTS.has(epic.assessment)) {
        errors.push(
          `${where}: assessment ${epic.assessment} is restricted and cannot close the Epic`,
        );
      }
    }

    if (epic.executionStatus === "BLOCKED" && (epic.blockers?.length ?? 0) === 0) {
      warnings.push(`${where}: BLOCKED without a recorded blocker reason`);
    }
  }

  return { errors, warnings };
}

/** Exact counts only. No invented percentages or burndown. */
export function summarize(registry) {
  const byStatus = Object.fromEntries(EXECUTION_STATUSES.map((status) => [status, 0]));
  const byAssessment = {};
  let closed = 0;
  for (const epic of registry.epics) {
    if (byStatus[epic.executionStatus] === undefined) byStatus[epic.executionStatus] = 0;
    byStatus[epic.executionStatus] += 1;
    byAssessment[epic.assessment] = (byAssessment[epic.assessment] ?? 0) + 1;
    if (epic.formallyClosed) closed += 1;
  }
  return {
    totalEpics: registry.epics.length,
    formallyClosed: closed,
    formallyClosedFraction: `${closed}/${registry.epics.length}`,
    byStatus,
    byAssessment,
  };
}

export function renderMarkdownLedger(registry) {
  const summary = summarize(registry);
  const lines = [
    "# Epic Execution Ledger (generated)",
    "",
    "> Generated by `scripts/verify-execution-traceability.mjs --write` from the Wave checklists.",
    "> Do not edit by hand. Assessment and ownership are parsed from the checklists;",
    "> human evidence fields live in the JSON registry and are preserved on regeneration.",
    "",
    `- Schema version: ${registry.schemaVersion}`,
    `- Plan version: ${registry.planVersion}`,
    `- Epics enumerated: ${summary.totalEpics}`,
    `- Formally closed: ${summary.formallyClosedFraction}`,
    "",
    "## Status distribution",
    "",
    "| Execution status | Epics |",
    "| --- | --- |",
    ...EXECUTION_STATUSES.map((status) => `| ${status} | ${summary.byStatus[status] ?? 0} |`),
    "",
    "## Engineering assessment distribution",
    "",
    "| Assessment marker | Epics |",
    "| --- | --- |",
    ...Object.entries(summary.byAssessment)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([assessment, count]) => `| ${assessment} | ${count} |`),
    "",
    "## Epics",
    "",
    "| Epic | Milestone | Title | Assessment | Execution status | Scope | Closed |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...registry.epics.map(
      (epic) =>
        `| ${epic.id} | ${epic.milestone} | ${epic.title} | ${epic.assessment} | ${epic.executionStatus} | ${epic.scope} | ${epic.formallyClosed ? "yes" : "no"} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

export function loadRegistry(repoRoot) {
  const file = path.join(repoRoot, REGISTRY_PATH);
  const body = readIfExists(file);
  if (body === null) return null;
  return JSON.parse(body);
}

export function writeRegistry(repoRoot, registry) {
  const file = path.join(repoRoot, REGISTRY_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(repoRoot, LEDGER_MARKDOWN_PATH),
    renderMarkdownLedger(registry),
    "utf8",
  );
}
