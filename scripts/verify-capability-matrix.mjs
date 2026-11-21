#!/usr/bin/env node
/** M00-E10 — generate or verify the capability matrix. */
import fs from "node:fs";
import path from "node:path";
import {
  OUTPUT_PATH,
  buildCapabilityMatrix,
  validateCapabilityMatrix,
} from "./platform/capability/capability-matrix.mjs";
import { repoRootFromModule } from "./platform/inventory/repository-inventory.mjs";

const root = repoRootFromModule();
const generated = buildCapabilityMatrix(root);
const errors = validateCapabilityMatrix(generated);
if (process.argv.includes("--write")) {
  const file = path.join(root, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ capabilities: generated.capabilities.length, errors }, null, 2));
if (errors.length) process.exit(1);
if (!process.argv.includes("--write")) {
  const file = path.join(root, OUTPUT_PATH);
  if (!fs.existsSync(file) || JSON.parse(fs.readFileSync(file, "utf8")).capabilities.length !== generated.capabilities.length) {
    console.error("Committed capability matrix is stale; run --write.");
    process.exit(1);
  }
}
