#!/usr/bin/env node
/** M01-E09 — run the offline packed-contract external consumer proof. */
import {
  repoRootFromModule,
} from "./platform/inventory/repository-inventory.mjs";
import { runExternalConsumerProof } from "./platform/dx/external-consumer-proof.mjs";

const proof = runExternalConsumerProof(repoRootFromModule());
console.log(JSON.stringify(proof, null, 2));
if (proof.errors.length) {
  console.error(`External consumer proof FAILED (${proof.errors.length}):`);
  for (const error of proof.errors) console.error(` - ${error}`);
  process.exit(1);
}
console.log("External consumer proof PASSED (offline, nonproduction)");
