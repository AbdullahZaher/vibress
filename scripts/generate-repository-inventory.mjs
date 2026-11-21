#!/usr/bin/env node
/**
 * M00-E01 — generate or verify the deterministic repository inventory.
 *
 *   node scripts/generate-repository-inventory.mjs --write
 *   node scripts/generate-repository-inventory.mjs --check
 *   node scripts/generate-repository-inventory.mjs --json
 */
import {
  buildInventory,
  readCommittedInventory,
  repoRootFromModule,
  validateInventory,
  writeInventory,
} from "./platform/inventory/repository-inventory.mjs";

const args = new Set(process.argv.slice(2));
const repoRoot = repoRootFromModule();
const generated = buildInventory(repoRoot);
const { errors, warnings } = validateInventory(generated);

if (args.has("--write")) {
  writeInventory(repoRoot, generated);
  if (!args.has("--json")) console.log("Repository inventory written.");
}

if (args.has("--json")) {
  console.log(
    JSON.stringify(
      { summary: generated.summary, violations: generated.dependencyBoundaries.violations, errors, warnings },
      null,
      2,
    ),
  );
} else {
  console.log("Repository inventory");
  console.log(JSON.stringify(generated.summary, null, 2));
  console.log(`Boundary violations: ${generated.dependencyBoundaries.violations.length}`);
  for (const warning of warnings) console.warn(`WARN ${warning}`);
}

if (errors.length) {
  console.error(`Repository inventory check FAILED (${errors.length} error(s)):`);
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

const committed = readCommittedInventory(repoRoot);
if (!committed) {
  console.error("Committed inventory is missing; run with --write.");
  process.exit(1);
}
if (JSON.stringify(committed) !== JSON.stringify(generated)) {
  console.error("Committed inventory is stale; run --write on the same source tree.");
  process.exit(1);
}
console.log("Repository inventory PASSED");
