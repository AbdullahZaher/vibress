#!/usr/bin/env node
/**
 * M00-E13 — measurable CRM developer-adoption baseline.
 *
 * This defines first-user tasks and locally measurable readiness facts. It does
 * not measure wall-clock time, run interviews, or claim adoption outcomes.
 * Task statuses describe documented state, not executed trials.
 */
import fs from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;

export const ADOPTION_TASKS = Object.freeze([
  {
    id: "DX-01",
    title: "Bootstrap from a clean checkout",
    successCriterion: "A fresh clone installs with the pinned Node and pnpm versions and no manual source edits.",
    evidence: "pnpm-workspace.yaml, package.json engines, clean-checkout CI job",
    status: "NOT_MEASURED",
  },
  {
    id: "DX-02",
    title: "Install dependencies without privileged credentials",
    successCriterion: "Install succeeds with no DATABASE_URL, owner password or production secret present.",
    evidence: ".env.example, scripts/provision-platform-roles.ts",
    status: "NOT_MEASURED",
  },
  {
    id: "DX-03",
    title: "Define an application with a branded identity",
    successCriterion: "defineApplication compiles with explicit application/installation/tenant identities and rejects pub_default.",
    evidence: "packages/platform-kernel/src/identity.ts, packages/platform-kernel/src/contracts.ts",
    status: "NOT_MEASURED",
  },
  {
    id: "DX-04",
    title: "Declare a CRM resource schema",
    successCriterion: "A versioned resource declaration compiles into a deterministic IR without arbitrary SQL.",
    evidence: "packages/schema-engine/src/schema.ts, packages/schema-engine/src/__tests__",
    status: "NOT_MEASURED",
  },
  {
    id: "DX-05",
    title: "Expose a custom HTTP route",
    successCriterion: "A member-authenticated custom route returns the declared action result.",
    evidence: "apps/platform-reference/src/application.ts http routes",
    status: "NOT_MEASURED",
  },
  {
    id: "DX-06",
    title: "Execute a custom action in a tenant scope",
    successCriterion: "A custom action performs one transactional CRM change and denies a cross-tenant principal.",
    evidence: "apps/platform-reference/src/application.ts actions, packages/tenancy/src/scope.ts",
    status: "NOT_MEASURED",
  },
  {
    id: "DX-07",
    title: "Run tenant and authorization negative tests",
    successCriterion: "Tenant spoof, revoked membership and missing permission cases all fail closed.",
    evidence: "apps/platform-reference/src/*.test.ts, tests/security/single-publication-boundary.test.ts",
    status: "NOT_MEASURED",
  },
  {
    id: "DX-08",
    title: "Package and install public contracts externally",
    successCriterion: "A packed public package installs into a clean project and exports the typed kernel contracts.",
    evidence: "package.json private flags, M01-E09 packaging proof",
    status: "BLOCKED",
  },
  {
    id: "DX-09",
    title: "Deploy to an isolated nonproduction environment",
    successCriterion: "The same pinned artifact boots in a disposable environment with separate DB/Redis/S3 identities.",
    evidence: "compose.dev.yml, scripts/platform/resource-isolation",
    status: "NOT_MEASURED",
  },
]);

const ALLOWED_STATUS = new Set(["NOT_MEASURED", "MEASURED", "BLOCKED"]);

export function validateBaseline(tasks) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(tasks) || tasks.length < 8) {
    errors.push("at least 8 first-user tasks are required");
    return { errors, warnings };
  }
  const seen = new Set();
  for (const task of tasks) {
    if (seen.has(task.id)) errors.push(`duplicate task id ${task.id}`);
    seen.add(task.id);
    if (!ALLOWED_STATUS.has(task.status)) {
      errors.push(`${task.id}: illegal status ${String(task.status)}`);
    }
    for (const field of ["title", "successCriterion", "evidence"]) {
      if (typeof task[field] !== "string" || task[field].trim() === "") {
        errors.push(`${task.id}: ${field} must be non-empty`);
      }
    }
    for (const key of Object.keys(task)) {
      if (/percent|burndown|completionRate/i.test(key)) {
        errors.push(`${task.id}: invented metric field ${key}`);
      }
    }
  }
  if (!tasks.some((task) => task.id === "DX-08" && task.status === "BLOCKED")) {
    warnings.push("DX-08 must remain BLOCKED until public packaging is authorized");
  }
  return { errors, warnings };
}

function countDirectories(root, directory) {
  const base = path.join(root, directory);
  if (!fs.existsSync(base)) return 0;
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && fs.existsSync(path.join(base, entry.name, "package.json")),
    ).length;
}

function countExports(root, directory) {
  const file = path.join(root, directory, "src/index.ts");
  if (!fs.existsSync(file)) return 0;
  const body = fs.readFileSync(file, "utf8");
  return [...body.matchAll(/^export\s+(?:\*|\{|type|interface|class|function|const|enum)/gm)].length;
}

export function measureLocalReadiness(repoRoot) {
  const packageDirs = [];
  for (const base of ["packages", "packages/domains"]) {
    const absolute = path.join(repoRoot, base);
    if (!fs.existsSync(absolute)) continue;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isDirectory() || !fs.existsSync(path.join(absolute, entry.name, "package.json"))) {
        continue;
      }
      const directory = `${base}/${entry.name}`;
      const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, directory, "package.json"), "utf8"));
      packageDirs.push({ directory, pkg });
    }
  }
  const applicationFile = path.join(repoRoot, "apps/platform-reference/src/application.ts");
  const application = fs.existsSync(applicationFile)
    ? fs.readFileSync(applicationFile, "utf8")
    : "";
  const publicPackages = packageDirs.filter((entry) => entry.pkg.private !== true).length;
  return {
    schemaVersion: SCHEMA_VERSION,
    applications: countDirectories(repoRoot, "apps"),
    packages: packageDirs.length,
    privatePackages: packageDirs.filter((entry) => entry.pkg.private === true).length,
    publicPackages,
    packagesWithBuildScript: packageDirs.filter((entry) =>
      Object.keys(entry.pkg.scripts ?? {}).includes("build"),
    ).length,
    packagesWithTypeScriptEntry: packageDirs.filter((entry) =>
      fs.existsSync(path.join(repoRoot, entry.directory, "src/index.ts")),
    ).length,
    kernelExports: countExports(repoRoot, "packages/platform-kernel"),
    referenceAppActions: [...application.matchAll(/name:\s*"([a-z][a-z0-9_]*)"/g)].length,
    referenceAppRoutes: [...application.matchAll(/path:\s*"([^"]+)"/g)].length,
    migrationCount: fs.existsSync(path.join(repoRoot, "packages/database/migrations"))
      ? fs
          .readdirSync(path.join(repoRoot, "packages/database/migrations"))
          .filter((name) => name.endsWith(".sql")).length
      : 0,
    packedPublicConsumerAvailable: publicPackages > 0,
    adoptionTrialsMeasured: false,
    wallClockMeasurements: "NOT_MEASURED",
  };
}

export function renderReadinessJson(readiness) {
  return `${JSON.stringify(readiness, null, 2)}\n`;
}
