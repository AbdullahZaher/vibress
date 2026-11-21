#!/usr/bin/env node
/**
 * M00-E06 — verify (or regenerate) the Epic execution traceability ledger.
 *
 * Usage:
 *   node scripts/verify-execution-traceability.mjs            # check
 *   node scripts/verify-execution-traceability.mjs --write    # refresh from checklists
 *   node scripts/verify-execution-traceability.mjs --json     # machine-readable summary
 *
 * Exit code 1 means the ledger is incomplete, drifted or claims closure
 * without the evidence required by MILESTONE-TEST-AND-MERGE-PROTOCOL.md.
 */
import {
  buildRegistry,
  loadRegistry,
  parseMilestoneDocs,
  parseWaveDocs,
  repoRootFromModule,
  summarize,
  validateLedger,
  writeRegistry,
} from "./platform/execution/epic-ledger.mjs";

const args = new Set(process.argv.slice(2));
const repoRoot = repoRootFromModule();
const write = args.has("--write");
const asJson = args.has("--json");

const parsedWave = parseWaveDocs(repoRoot);
const parsedMilestones = parseMilestoneDocs(repoRoot);
let registry = loadRegistry(repoRoot);

if (write) {
  registry = buildRegistry(parsedWave, parsedMilestones, registry);
  writeRegistry(repoRoot, registry);
  if (!asJson) {
    console.log(`Wrote ${registry.epics.length} Epics to the execution ledger.`);
  }
}

if (!registry) {
  console.error(
    "Epic execution ledger is missing. Run with --write to generate it from the Wave checklists.",
  );
  process.exit(1);
}

const { errors, warnings } = validateLedger(registry, parsedWave, parsedMilestones);
const summary = summarize(registry);

if (asJson) {
  console.log(JSON.stringify({ summary, errors, warnings }, null, 2));
} else {
  console.log("Epic execution traceability");
  console.log(
    JSON.stringify(
      {
        totalEpics: summary.totalEpics,
        formallyClosed: summary.formallyClosedFraction,
        waveCounts: parsedWave.waveCounts,
        byStatus: summary.byStatus,
      },
      null,
      2,
    ),
  );
  for (const warning of warnings) console.warn(`WARN ${warning}`);
}

if (errors.length) {
  console.error(`Execution traceability FAILED (${errors.length} error(s)):`);
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

if (!asJson) console.log("Execution traceability PASSED");
