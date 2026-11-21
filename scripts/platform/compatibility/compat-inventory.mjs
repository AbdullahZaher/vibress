#!/usr/bin/env node
/**
 * M00-E08 — executable compatibility inventory.
 * Reads committed manifests only. It never publishes packages or changes the
 * approved version policy.
 */
import fs from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;
export const OUTPUT_PATH =
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/SDK-COMPATIBILITY-INVENTORY.json";

function readJson(root, relative) {
  const file = path.join(root, relative);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function readText(root, relative) {
  const file = path.join(root, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

export function buildCompatibilityInventory(root) {
  const rootPkg = readJson(root, "package.json");
  const workspace = readText(root, "pnpm-workspace.yaml");
  const compose = readText(root, "compose.prod.yml");
  const supportMatrix = readText(root, "docs/platform-roadmap/RELEASE-VERSIONING-AND-SUPPORT-MATRIX.md");
  const kernel = readJson(root, "packages/platform-kernel/package.json");
  const pluginSdk = readJson(root, "packages/plugin-sdk/package.json");
  const schemaEngine = readJson(root, "packages/schema-engine/package.json");
  const journal = readJson(root, "packages/database/migrations/meta/_journal.json");
  const consumerFile = path.join(root, "examples/external-crm-consumer/src/app.ts");

  const observed = {
    hostVersion: rootPkg?.version ?? null,
    node: rootPkg?.engines?.node ?? null,
    pnpmEngine: rootPkg?.engines?.pnpm ?? null,
    packageManager: rootPkg?.packageManager ?? null,
    kernelVersion: kernel?.version ?? null,
    kernelPrivate: kernel?.private === true,
    pluginSdkVersion: pluginSdk?.version ?? null,
    pluginSdkPrivate: pluginSdk?.private === true,
    schemaEngineVersion: schemaEngine?.version ?? null,
    schemaEnginePrivate: schemaEngine?.private === true,
    composeVersionFallback: compose.match(/VIBRESS_VERSION:\s*([^\s]+)/)?.[1] ?? null,
    migrationJournalEntries: journal?.entries?.length ?? 0,
    latestMigrationTag: journal?.entries?.at(-1)?.tag ?? null,
    supportMatrixDocumented: supportMatrix.length > 0,
    externalConsumerPresent: fs.existsSync(consumerFile),
    workspaceManifestPresent: workspace.length > 0,
  };

  const checks = [
    { id: "NODE-24", expected: ">=24.0.0 <25", actual: observed.node, pass: observed.node === ">=24.0.0 <25" },
    { id: "PNPM-11", expected: ">=11.17.0", actual: observed.pnpmEngine, pass: observed.pnpmEngine === ">=11.17.0" },
    { id: "PLUGIN-SDK-PRIVATE", expected: true, actual: observed.pluginSdkPrivate, pass: observed.pluginSdkPrivate === true },
    { id: "KERNEL-PRIVATE", expected: true, actual: observed.kernelPrivate, pass: observed.kernelPrivate === true },
    { id: "MIGRATION-JOURNAL", expected: 58, actual: observed.migrationJournalEntries, pass: observed.migrationJournalEntries === 58 },
    { id: "SUPPORT-MATRIX-PRESENT", expected: true, actual: observed.supportMatrixDocumented, pass: observed.supportMatrixDocumented },
    { id: "EXTERNAL-CONSUMER", expected: true, actual: observed.externalConsumerPresent, pass: observed.externalConsumerPresent },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    policyStatus: "UNCHANGED_PENDING_AUTHORIZED_OWNER_APPROVAL",
    packagesPublished: false,
    observed,
    checks,
    failedChecks: checks.filter((check) => !check.pass).map((check) => check.id),
    notes: [
      "PostgreSQL 16 and Redis 7 are documented deployment prerequisites; runtime versions are not probed here.",
      "ADR-013 Host 1.2.0 vs Compose VIBRESS_VERSION fallback requires the R40 owner decision.",
      "No private package was published and no registry operation was performed.",
    ],
  };
}

export function validateCompatibility(inventory) {
  const errors = [];
  if (inventory.schemaVersion !== SCHEMA_VERSION) errors.push("bad schemaVersion");
  if (inventory.packagesPublished !== false) errors.push("packages must not be published by this inventory");
  if (inventory.checks.length < 7) errors.push("incomplete compatibility checks");
  for (const check of inventory.checks) {
    if (typeof check.pass !== "boolean") errors.push(`${check.id}: missing pass result`);
  }
  return errors;
}
