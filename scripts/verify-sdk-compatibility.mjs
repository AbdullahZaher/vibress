#!/usr/bin/env node
/** M00-E08 — generate or verify the SDK/migration compatibility inventory. */
import fs from "node:fs";
import path from "node:path";
import {
  OUTPUT_PATH,
  buildCompatibilityInventory,
  validateCompatibility,
} from "./platform/compatibility/compat-inventory.mjs";
import { repoRootFromModule } from "./platform/inventory/repository-inventory.mjs";

const root = repoRootFromModule();
const generated = buildCompatibilityInventory(root);
const errors = validateCompatibility(generated);
if (process.argv.includes("--write")) {
  const file = path.join(root, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ observed: generated.observed, failedChecks: generated.failedChecks, errors }, null, 2));
if (errors.length) process.exit(1);
if (!process.argv.includes("--write")) {
  const file = path.join(root, OUTPUT_PATH);
  if (!fs.existsSync(file) || JSON.parse(fs.readFileSync(file, "utf8")).observed.hostVersion !== generated.observed.hostVersion) {
    console.error("Committed compatibility inventory is stale; run --write.");
    process.exit(1);
  }
}
