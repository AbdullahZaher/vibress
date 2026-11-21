#!/usr/bin/env node
/**
 * M00-E01 — deterministic repository inventory.
 *
 * Reads the workspace only. No network, no credentials, no timestamps, no
 * absolute paths. The committed JSON artifact is regenerated with --write and
 * compared byte-for-byte with --check so drift is detectable.
 *
 * This is an inventory, not a certification: it records what exists, not
 * whether any milestone is accepted.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 1;
export const INVENTORY_RELATIVE_PATH =
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/REPOSITORY-INVENTORY.json";
export const INVENTORY_MARKDOWN_PATH =
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/REPOSITORY-INVENTORY.md";
export const LEDGER_RELATIVE_PATH =
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/EPIC-EXECUTION-LEDGER.json";

const WORKSPACE_ROOTS = [
  ["apps", "application"],
  ["packages", "package"],
  ["packages/domains", "package"],
];
const SOURCE_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
const ROLE_DEFAULT =
  /\|\|\s*"([a-z][a-z0-9_]+)"/g;

export function repoRootFromModule() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function sorted(values) {
  return [...values].sort((a, b) => String(a).localeCompare(String(b)));
}

function listDirectories(root, directory) {
  const base = path.join(root, directory);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      dir: `${directory}/${entry.name}`,
      name: entry.name,
    }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

function walkFiles(directory, predicate) {
  const found = [];
  if (!fs.existsSync(directory)) return found;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".next") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(full, predicate));
    else if (entry.isFile() && predicate(entry.name)) found.push(full);
  }
  return found;
}

function collectUnits(root) {
  const units = new Map();
  for (const [directory, kind] of WORKSPACE_ROOTS) {
    for (const item of listDirectories(root, directory)) {
      const packageFile = path.join(root, item.dir, "package.json");
      if (!fs.existsSync(packageFile)) continue;
      const pkg = readJson(packageFile);
      if (!pkg.name) continue;
      units.set(pkg.name, {
        name: pkg.name,
        directory: item.dir,
        kind,
        version: pkg.version ?? null,
        private: pkg.private === true,
        pkg,
      });
    }
  }
  return units;
}

function declaredWorkspaceDependencies(unit, units) {
  const deps = {
    ...(unit.pkg.dependencies ?? {}),
    ...(unit.pkg.devDependencies ?? {}),
    ...(unit.pkg.peerDependencies ?? {}),
  };
  return sorted(
    Object.keys(deps).filter((name) => units.has(name) && name !== unit.name),
  );
}

function sourceImports(root, unit) {
  const files = walkFiles(path.join(root, unit.directory, "src"), (name) =>
    /\.tsx?$/.test(name),
  );
  const result = [];
  for (const file of files) {
    if (file.includes(`${path.sep}__tests__${path.sep}`)) continue;
    const content = fs.readFileSync(file, "utf8");
    let inTemplate = false;
    for (const line of content.split("\n")) {
      // Generated sample code inside template literals is not a real import.
      if (!inTemplate) {
        for (const match of line.matchAll(SOURCE_IMPORT)) {
          const before = [...line.slice(0, match.index).matchAll(/(?<!\\)`/g)].length;
          if (before % 2 === 1) continue;
          result.push({ file: relative(root, file), specifier: match[1] });
        }
      }
      const backticks = [...line.matchAll(/(?<!\\)`/g)].length;
      if (backticks % 2 === 1) inTemplate = !inTemplate;
    }
  }
  return result.sort((a, b) =>
    `${a.file}:${a.specifier}`.localeCompare(`${b.file}:${b.specifier}`),
  );
}

function exportCount(root, unit) {
  const entry = path.join(root, unit.directory, "src", "index.ts");
  if (!fs.existsSync(entry)) return 0;
  const body = fs.readFileSync(entry, "utf8");
  return [...body.matchAll(/^export\s+(?:\*|\{|type|interface|class|function|const|enum)/gm)].length;
}

function collectBoundaryViolations(root, units, importsByUnit) {
  const errors = [];
  for (const unit of units.values()) {
    const declared = new Set(declaredWorkspaceDependencies(unit, units));
    if (unit.name === "@vibress/platform-kernel") {
      for (const dep of declared) {
        errors.push(`${unit.name} must not depend on workspace package ${dep}`);
      }
    }
    if (unit.name === "@vibress/tenancy") {
      for (const dep of declared) {
        if (dep !== "@vibress/platform-kernel") {
          errors.push(`${unit.name} may depend only on @vibress/platform-kernel, found ${dep}`);
        }
      }
    }
    for (const dep of declared) {
      if (units.get(dep)?.kind === "application") {
        errors.push(`${unit.directory} must not depend on an application: ${dep}`);
      }
    }
    const unitRoot = path.resolve(root, unit.directory);
    for (const entry of importsByUnit.get(unit.name) ?? []) {
      const specifier = entry.specifier;
      if (specifier.startsWith("@vibress/")) {
        if (!declared.has(specifier) && units.has(specifier)) {
          errors.push(`${entry.file} imports undeclared workspace package ${specifier}`);
        }
        continue;
      }
      if (specifier.startsWith(".")) {
        const resolved = path.resolve(path.dirname(path.join(root, entry.file)), specifier);
        if (resolved !== unitRoot && !resolved.startsWith(`${unitRoot}${path.sep}`)) {
          errors.push(`${entry.file} relative import escapes ${unit.directory}: ${specifier}`);
        }
      }
    }
  }
  return sorted(errors);
}

function collectMigrations(root) {
  const directory = path.join(root, "packages/database/migrations");
  const files = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
    : [];
  const records = files.map((name) => {
    const bytes = fs.readFileSync(path.join(directory, name));
    return { name, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const journalFile = path.join(directory, "meta/_journal.json");
  const journal = fs.existsSync(journalFile) ? readJson(journalFile) : { entries: [] };
  const journalTags = sorted((journal.entries ?? []).map((entry) => entry.tag));
  const fileTags = records.map((record) => record.name.replace(/\.sql$/, ""));
  return {
    count: records.length,
    journalEntries: journal.entries?.length ?? 0,
    latestTag: fileTags.at(-1) ?? null,
    journalLatestTag: journalTags.at(-1) ?? null,
    digest: sha256(records.map((record) => `${record.name}:${record.sha256}`).join("\n")),
    journalFileMissingTags: journalTags.filter((tag) => !fileTags.includes(tag)),
    journalFileExtraTags: fileTags.filter((tag) => !journalTags.includes(tag)),
    files: records,
  };
}

function collectDatabaseRoles(root) {
  const files = [
    "packages/database/src/platform-runtime-role.ts",
    "packages/database/src/platform-membership-reader.ts",
    "packages/database/src/platform-deployment-verifier.ts",
    "scripts/provision-platform-roles.ts",
    "scripts/lib/provision-platform-roles-atomic.ts",
  ];
  const names = new Set();
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const body = fs.readFileSync(full, "utf8");
    for (const match of body.matchAll(ROLE_DEFAULT)) names.add(match[1]);
  }
  return sorted(names).map((name) => ({
    name,
    usage: "least-privilege serving/provisioning identity",
    source: "packages/database/src + scripts/provision-platform-roles.ts",
  }));
}

function collectWorkers(root) {
  const processors = walkFiles(path.join(root, "apps/worker/src/processors"), (name) =>
    /\.ts$/.test(name),
  )
    .filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`))
    .map((file) => relative(root, file))
    .sort();
  const queues = walkFiles(path.join(root, "apps/worker/src/queues"), (name) => /\.ts$/.test(name))
    .map((file) => relative(root, file))
    .sort();
  return { processors, queues };
}

function collectEvidence(root) {
  const ledgerFile = path.join(root, LEDGER_RELATIVE_PATH);
  const ledger = fs.existsSync(ledgerFile) ? readJson(ledgerFile) : null;
  const applicationFile = path.join(root, "apps/platform-reference/src/application.ts");
  const application = fs.existsSync(applicationFile)
    ? fs.readFileSync(applicationFile, "utf8")
    : "";
  const actions = sorted(
    [...application.matchAll(/name:\s*"([a-z][a-z0-9_]*)"/g)].map((match) => match[1]),
  );
  const routes = sorted(
    [...application.matchAll(/path:\s*"([^"]+)"/g)].map((match) => match[1]),
  );
  return {
    epicLedger: ledger
      ? {
          epics: ledger.epics.length,
          formallyClosed: ledger.epics.filter((epic) => epic.formallyClosed).length,
          path: LEDGER_RELATIVE_PATH,
        }
      : null,
    referenceApplication: {
      path: "apps/platform-reference/src/application.ts",
      actions,
      httpRoutes: routes,
    },
  };
}

export function buildInventory(root) {
  const rootPkg = readJson(path.join(root, "package.json"));
  const units = collectUnits(root);
  const importsByUnit = new Map(
    [...units.values()].map((unit) => [unit.name, sourceImports(root, unit)]),
  );

  const applications = [...units.values()]
    .filter((unit) => unit.kind === "application")
    .map((unit) => ({
      directory: unit.directory,
      packageName: unit.name,
      version: unit.version,
      scripts: sorted(Object.keys(unit.pkg.scripts ?? {})),
      sourceFileCount: importsByUnit.get(unit.name)?.length ?? 0,
      dependencies: declaredWorkspaceDependencies(unit, units),
    }));

  const packages = [...units.values()]
    .filter((unit) => unit.kind === "package")
    .map((unit) => {
      const entry = path.join(root, unit.directory, "src/index.ts");
      const entryKind = fs.existsSync(entry)
        ? unit.pkg.main === "src/index.ts"
          ? "typescript-source"
          : "declared-entry"
        : "none";
      return {
        directory: unit.directory,
        packageName: unit.name,
        version: unit.version,
        private: unit.private,
        hasBuildScript: Object.keys(unit.pkg.scripts ?? {}).includes("build"),
        entryKind,
        exportCount: exportCount(root, unit),
        nxTags: sorted(unit.pkg.nx?.tags ?? []),
        dependencies: declaredWorkspaceDependencies(unit, units),
      };
    });

  const dependents = new Map();
  for (const unit of units.values()) {
    for (const dep of declaredWorkspaceDependencies(unit, units)) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep).push(unit.name);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    toolchain: {
      node: rootPkg.engines?.node ?? null,
      pnpm: rootPkg.engines?.pnpm ?? null,
      packageManager: rootPkg.packageManager ?? null,
    },
    applications,
    packages: packages.map((pkg) => ({
      ...pkg,
      dependents: sorted(dependents.get(pkg.packageName) ?? []),
    })),
    summary: {
      applications: applications.length,
      packages: packages.length,
      privatePackages: packages.filter((pkg) => pkg.private).length,
      publicPackages: packages.filter((pkg) => !pkg.private).length,
      builtPackages: packages.filter((pkg) => pkg.hasBuildScript).length,
    },
    dependencyBoundaries: {
      violations: collectBoundaryViolations(root, units, importsByUnit),
      rules: [
        "@vibress/platform-kernel has no workspace dependencies",
        "@vibress/tenancy may depend only on @vibress/platform-kernel",
        "packages must not depend on applications",
        "workspace imports must be declared in package.json",
        "relative imports must not escape the owning unit directory",
      ],
    },
    migrations: collectMigrations(root),
    databaseRoles: collectDatabaseRoles(root),
    workers: collectWorkers(root),
    publicContracts: packages
      .filter((pkg) => pkg.exportCount > 0)
      .map((pkg) => ({
        packageName: pkg.packageName,
        entryKind: pkg.entryKind,
        exportCount: pkg.exportCount,
      })),
    implementationEvidence: collectEvidence(root),
  };
}

export function validateInventory(inventory) {
  const errors = [];
  const warnings = [];
  if (inventory.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!inventory.summary || inventory.summary.applications < 1) {
    errors.push("at least one application must be inventoried");
  }
  if (!inventory.summary || inventory.summary.packages < 1) {
    errors.push("at least one package must be inventoried");
  }
  for (const rule of [
    "@vibress/platform-kernel has no workspace dependencies",
    "@vibress/tenancy may depend only on @vibress/platform-kernel",
    "packages must not depend on applications",
    "workspace imports must be declared in package.json",
    "relative imports must not escape the owning unit directory",
  ]) {
    if (!inventory.dependencyBoundaries?.rules?.includes(rule)) {
      errors.push(`missing boundary rule: ${rule}`);
    }
  }
  const kernel = inventory.packages.find((pkg) => pkg.packageName === "@vibress/platform-kernel");
  if (kernel && kernel.dependencies.length > 0) {
    errors.push("@vibress/platform-kernel has workspace dependencies");
  }
  const tenancy = inventory.packages.find((pkg) => pkg.packageName === "@vibress/tenancy");
  if (tenancy && tenancy.dependencies.some((dep) => dep !== "@vibress/platform-kernel")) {
    errors.push("@vibress/tenancy has dependencies beyond the kernel");
  }
  const migrations = inventory.migrations ?? {};
  if (migrations.count !== migrations.journalEntries) {
    errors.push(
      `migration journal has ${migrations.journalEntries} entries but ${migrations.count} SQL files`,
    );
  }
  if ((migrations.journalFileMissingTags ?? []).length || (migrations.journalFileExtraTags ?? []).length) {
    errors.push("migration tags do not match between journal and SQL files");
  }
  if (!/^[0-9a-f]{64}$/.test(migrations.digest ?? "")) {
    errors.push("migration digest is not a sha256 hex string");
  }
  if ((inventory.databaseRoles ?? []).length < 3) {
    errors.push("expected at least three least-privilege database roles");
  }
  if ((inventory.workers?.processors ?? []).length < 1) {
    errors.push("expected at least one worker processor");
  }
  if (inventory.implementationEvidence?.epicLedger?.epics !== 140) {
    errors.push("implementation evidence must reference the 140-Epic ledger");
  }
  for (const [key, value] of Object.entries(inventory)) {
    if (/percent|burndown|completionRate/i.test(key)) {
      errors.push(`invented progress metric field: ${key}`);
    }
    if (typeof value === "number" && /percent|burndown/i.test(key)) {
      errors.push(`invented progress metric value: ${key}`);
    }
  }
  for (const violation of inventory.dependencyBoundaries?.violations ?? []) {
    if (/must not|only on|undeclared|escapes/.test(violation)) {
      errors.push(`boundary violation: ${violation}`);
    }
  }
  if (inventory.summary?.publicPackages === 0) {
    warnings.push("no package is currently publishable; packed public consumer remains blocked");
  }
  return { errors, warnings };
}

export function renderMarkdown(inventory) {
  const lines = [
    "# Repository Inventory (generated)",
    "",
    "> Generated by `scripts/generate-repository-inventory.mjs --write`. Do not edit by hand.",
    "> This records source facts only; it is not milestone certification.",
    "",
    "## Toolchain",
    "",
    `- Node: ${inventory.toolchain.node ?? "not declared"}`,
    `- pnpm: ${inventory.toolchain.pnpm ?? "not declared"}`,
    `- Package manager: ${inventory.toolchain.packageManager ?? "not declared"}`,
    "",
    "## Summary",
    "",
    `- Applications: ${inventory.summary.applications}`,
    `- Packages: ${inventory.summary.packages}`,
    `- Private packages: ${inventory.summary.privatePackages}`,
    `- Packages with a build script: ${inventory.summary.builtPackages}`,
    `- Migrations: ${inventory.migrations.count} (journal ${inventory.migrations.journalEntries}, latest ${inventory.migrations.latestTag})`,
    `- Migration digest: \`${inventory.migrations.digest}\``,
    `- Boundary violations: ${inventory.dependencyBoundaries.violations.length}`,
    `- Database roles: ${inventory.databaseRoles.map((role) => role.name).join(", ")}`,
    `- Epic ledger: ${inventory.implementationEvidence.epicLedger?.epics ?? 0} Epics, ${inventory.implementationEvidence.epicLedger?.formallyClosed ?? 0} formally closed`,
    "",
    "## Boundary rules",
    "",
    ...inventory.dependencyBoundaries.rules.map((rule) => `- ${rule}`),
    "",
    "## Public contracts",
    "",
    "| Package | Entry | Exports |",
    "| --- | --- | --- |",
    ...inventory.publicContracts.map(
      (contract) => `| ${contract.packageName} | ${contract.entryKind} | ${contract.exportCount} |`,
    ),
    "",
    "## Worker surfaces",
    "",
    `- Processors: ${inventory.workers.processors.length}`,
    `- Queues: ${inventory.workers.queues.length}`,
    "",
    "## Reference application",
    "",
    `- Actions: ${inventory.implementationEvidence.referenceApplication.actions.join(", ")}`,
    `- HTTP routes: ${inventory.implementationEvidence.referenceApplication.httpRoutes.join(", ")}`,
    "",
  ];
  return lines.join("\n");
}

export function writeInventory(root, inventory) {
  const file = path.join(root, INVENTORY_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(root, INVENTORY_MARKDOWN_PATH), renderMarkdown(inventory), "utf8");
}

export function readCommittedInventory(root) {
  const file = path.join(root, INVENTORY_RELATIVE_PATH);
  return fs.existsSync(file) ? readJson(file) : null;
}
