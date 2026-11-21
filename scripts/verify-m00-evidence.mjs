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
  if (!fs.existsSync(file)) {
    console.error("Committed evidence index is missing; run --write.");
    process.exit(1);
  }
  const committed = JSON.parse(fs.readFileSync(file, "utf8"));
  const committedByPath = new Map(committed.artifacts.map((artifact) => [artifact.path, artifact.sha256]));
  for (const artifact of generated.artifacts) {
    if (committedByPath.get(artifact.path) !== artifact.sha256) {
      console.error(`Committed evidence index is stale for ${artifact.path}; run --write.`);
      process.exit(1);
    }
  }
  if (committed.artifacts.length !== generated.artifacts.length) {
    console.error("Committed evidence index has a different artifact set; run --write.");
    process.exit(1);
  }
  const committedSuites = new Map(
    (committed.testSuites ?? []).map((suite) => [suite.path, suite.sha256]),
  );
  if (committedSuites.size !== generated.testSuites.length) {
    console.error("Committed evidence index has a different test suite set; run --write.");
    process.exit(1);
  }
  for (const suite of generated.testSuites) {
    if (committedSuites.get(suite.path) !== suite.sha256) {
      console.error(`Committed evidence index test digest is stale for ${suite.path}; run --write.`);
      process.exit(1);
    }
  }
  for (const field of ["implementationShas", "ciRunUrls", "referencedSourcePaths", "mandatoryChecks"]) {
    const committedValue = JSON.stringify(committed.attribution?.[field] ?? (field === "mandatoryChecks" ? committed[field] : undefined));
    const generatedValue = JSON.stringify(
      field === "mandatoryChecks"
        ? generated.mandatoryChecks
        : generated.attribution[field],
    );
    if (committedValue !== generatedValue) {
      console.error(`Committed evidence index ${field} does not match generated attribution; run --write.`);
      process.exit(1);
    }
  }
  if (committed.certificationNotice !== generated.certificationNotice) {
    console.error("Committed certification notice does not match generated value; run --write.");
    process.exit(1);
  }
  for (const [pathOnDisk, digest] of committedByPath) {
    if (!fs.existsSync(path.join(root, pathOnDisk))) {
      console.error(`Committed evidence index references missing file ${pathOnDisk}.`);
      process.exit(1);
    }
    if (digest !== generated.artifacts.find((artifact) => artifact.path === pathOnDisk)?.sha256) {
      console.error(`Committed evidence index digest does not match file contents: ${pathOnDisk}.`);
      process.exit(1);
    }
  }
}
