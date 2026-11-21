#!/usr/bin/env node
/** M00-E12 — generate or verify the read-only PostgreSQL security inventory. */
import fs from "node:fs";
import path from "node:path";
import {
  OUTPUT_PATH,
  buildPgSecurityInventory,
  validateInventory,
} from "./platform/security/pg-security-inventory.mjs";
import { repoRootFromModule } from "./platform/inventory/repository-inventory.mjs";

const root = repoRootFromModule();
const generated = buildPgSecurityInventory(root);
const errors = validateInventory(generated);
const args = new Set(process.argv.slice(2));

if (args.has("--write")) {
  const file = path.join(root, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ migrations: generated.migrationCount, digest: generated.digest, totals: generated.totals, errors }, null, 2));
if (errors.length) process.exit(1);
if (!args.has("--write")) {
  const file = path.join(root, OUTPUT_PATH);
  if (!fs.existsSync(file) || JSON.parse(fs.readFileSync(file, "utf8")).digest !== generated.digest) {
    console.error("Committed PostgreSQL security inventory is stale; run --write.");
    process.exit(1);
  }
}
