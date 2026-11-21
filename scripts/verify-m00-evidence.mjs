#!/usr/bin/env node
/** M00-E05 — generate or verify the milestone evidence index. */
import fs from "node:fs";
import path from "node:path";
import {
  INDEX_PATH,
  buildEvidenceIndex,
  validateEvidenceIndex,
} from "./platform/evidence/m00-evidence-index.mjs";
import { repoRootFromModule } from "./platform/inventory/repository-inventory.mjs";

const root = repoRootFromModule();
const generated = buildEvidenceIndex(root);
const errors = validateEvidenceIndex(generated, root);
if (process.argv.includes("--write")) {
  const file = path.join(root, INDEX_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({
  artifacts: generated.artifacts.length,
  testSuites: generated.testSuites.length,
  negativeSuites: generated.testSuites.filter((s) => s.negativeCases).length,
  shas: generated.attribution.implementationShas.length,
  ciRuns: generated.attribution.ciRunUrls.length,
  errors,
}, null, 2));
if (errors.length) process.exit(1);
if (!process.argv.includes("--write")) {
  const file = path.join(root, INDEX_PATH);
  if (!fs.existsSync(file) || JSON.parse(fs.readFileSync(file, "utf8")).artifacts.length !== generated.artifacts.length) {
    console.error("Committed evidence index is stale; run --write.");
    process.exit(1);
  }
}
