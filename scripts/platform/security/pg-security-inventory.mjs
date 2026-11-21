#!/usr/bin/env node
/**
 * M00-E12 / M00-E04 — read-only PostgreSQL security inventory.
 *
 * Scans committed SQL and TypeScript sources. It never connects to a database
 * and never applies grants, RLS policy or DDL. Results are a decision input for
 * Agent 02/03/05 and a named human DBA, not a runtime privilege certificate.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;
export const OUTPUT_PATH =
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/POSTGRES-SECURITY-INVENTORY.json";

const MIGRATIONS_DIR = "packages/database/migrations";

function read(root, relative) {
  const file = path.join(root, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function collectMigrations(root) {
  const dir = path.join(root, MIGRATIONS_DIR);
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()
    : [];
  return files.map((name) => {
    const body = fs.readFileSync(path.join(dir, name), "utf8");
    return {
      name,
      sha256: sha256(body),
      securityDefiner: countMatches(body, /SECURITY\s+DEFINER/gi),
      searchPath: countMatches(body, /SET\s+search_path|search_path\s*=/gi),
      forceRls: countMatches(body, /FORCE\s+ROW\s+LEVEL\s+SECURITY/gi),
      rlsPolicies: countMatches(body, /CREATE\s+POLICY/gi),
      restrictivePolicies: countMatches(body, /AS\s+RESTRICTIVE/gi),
      publicGrants: countMatches(body, /GRANT\s+[^;]*\s+TO\s+PUBLIC/gi),
      defaultPrivileges: countMatches(body, /ALTER\s+DEFAULT\s+PRIVILEGES/gi),
      views: countMatches(body, /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW/gi),
      foreignTables: countMatches(body, /CREATE\s+FOREIGN\s+TABLE/gi),
      truncateGrants: countMatches(body, /GRANT\s+[^;]*TRUNCATE[^;]*;/gi),
      referencesGrants: countMatches(body, /GRANT\s+[^;]*REFERENCES[^;]*;/gi),
      auditFunctions: countMatches(body, /current_setting|session_user|current_user/gi),
    };
  });
}

export function buildPgSecurityInventory(root) {
  const migrations = collectMigrations(root);
  const sourceFiles = ["packages/database/src", "scripts/lib", "scripts/provision-platform-roles.ts", "scripts/audit-function-privileges.mjs"];
  let source = "";
  for (const relative of sourceFiles) {
    const base = path.join(root, relative);
    if (!fs.existsSync(base)) continue;
    if (fs.statSync(base).isDirectory()) {
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (["node_modules", "dist", "__tests__"].includes(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(ts|mjs)$/.test(entry.name)) source += fs.readFileSync(full, "utf8");
        }
      };
      walk(base);
    } else {
      source += fs.readFileSync(base, "utf8");
    }
  }
  const roleConfigs = [
    ["runtime", "packages/database/src/platform-runtime-role.ts"],
    ["membership-reader", "packages/database/src/platform-membership-reader.ts"],
    ["deployment-verifier", "packages/database/src/platform-deployment-verifier.ts"],
  ].map(([kind, file]) => {
    const body = read(root, file);
    const match = body.match(/\|\|\s*"([a-z][a-z0-9_]+)"/);
    return { kind, defaultRoleName: match?.[1] ?? null, source: file };
  });

  const totals = migrations.reduce(
    (acc, item) => {
      for (const key of Object.keys(acc)) {
        if (typeof item[key] === "number") acc[key] += item[key];
      }
      return acc;
    },
    {
      securityDefiner: 0,
      searchPath: 0,
      forceRls: 0,
      rlsPolicies: 0,
      restrictivePolicies: 0,
      publicGrants: 0,
      defaultPrivileges: 0,
      views: 0,
      foreignTables: 0,
      truncateGrants: 0,
      referencesGrants: 0,
      auditFunctions: 0,
    },
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    method: "static-read-only-source-scan",
    databaseContacted: false,
    grantsApplied: false,
    migrationCount: migrations.length,
    digest: sha256(migrations.map((item) => `${item.name}:${item.sha256}`).join("\n")),
    totals,
    roleConfigs,
    observations: {
      superuserReferences: countMatches(source, /\bsuperuser\b/gi),
      bypassRlsReferences: countMatches(source, /BYPASSRLS/gi),
      nonSuperuserChecks: countMatches(source, /rolsuper|rolbypassrls/gi),
      searchPathHardening: countMatches(source, /search_path/gi),
      r26References: countMatches(source + read(root, "docs/platform-roadmap/execution/universal-platform-2026-11-21/STATUS-AND-BASELINE.md"), /R26/g),
      f012References: countMatches(read(root, "docs/platform-roadmap/execution/universal-platform-2026-11-21/STATUS-AND-BASELINE.md"), /F-012/g),
    },
    migrations,
    requiredDecisions: [
      "R26 PUBLIC/inherited EXECUTE scope A/B — owner + AppSec + human DBA",
      "F-012 legacy CMS RLS topology A/B — owner + AppSec",
      "R35 views/foreign-table security_invoker review",
      "D-03 migration 0061 trusted-owner UPDATE/TRUNCATE — named human DBA/IAM",
    ],
    gaps: [
      ...(totals.securityDefiner === 0 ? ["No SECURITY DEFINER definition found in committed migrations"] : []),
      ...(totals.searchPath === 0 ? ["No search_path hardening definition found in committed migrations"] : []),
      ...(totals.publicGrants === 0 ? ["No explicit PUBLIC grant audit result in committed migrations"] : []),
      ...(totals.views === 0 ? ["No view/security_invoker inventory in committed migrations"] : []),
    ],
    limitations: [
      "Static scan does not prove effective privileges at runtime.",
      "No shared or production database was queried.",
      "Audit scripts are not executed here; they require disposable PG16 and explicit authorization.",
    ],
  };
}

export function validateInventory(inventory) {
  const errors = [];
  if (inventory.databaseContacted !== false || inventory.grantsApplied !== false) {
    errors.push("inventory must be read-only and must not apply grants");
  }
  if (inventory.migrationCount < 1) errors.push("no migrations inventoried");
  if (!/^[0-9a-f]{64}$/.test(inventory.digest ?? "")) errors.push("invalid digest");
  if (inventory.roleConfigs.length !== 3) errors.push("expected three serving role configs");
  if ((inventory.totals.forceRls ?? 0) < 1) errors.push("no FORCE RLS evidence found");
  if ((inventory.totals.rlsPolicies ?? 0) < 1) errors.push("no RLS policy evidence found");
  // Absence of evidence is reported as a gap, not as a validation error: the
  // current baseline must not be forced to look more hardened than it is.
  if ((inventory.requiredDecisions ?? []).length < 4) errors.push("required decision register is incomplete");
  return errors;
}
