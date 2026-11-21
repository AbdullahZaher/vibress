#!/usr/bin/env node
/** M00-E10 — source-backed v1 capability matrix and compatibility boundaries. */
import fs from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;
export const OUTPUT_PATH =
  "docs/platform-roadmap/execution/universal-platform-2026-11-21/M00-CAPABILITY-MATRIX.json";

export const CATEGORIES = Object.freeze([
  "EXISTING_HOST_CMS",
  "UNIVERSAL_PLATFORM",
  "RESTRICTED_EXPERIMENTAL",
  "PUBLIC_CONTRACT",
  "PLANNED",
  "UNSUPPORTED_PROHIBITED",
]);

const CAPABILITIES = [
  ["CAP-01", "Custom application HTTP routes", "UNIVERSAL_PLATFORM", "apps/platform-reference/src/application.ts", "IMPLEMENTED_RESTRICTED"],
  ["CAP-02", "Transactional custom actions", "UNIVERSAL_PLATFORM", "apps/platform-reference/src/application.ts", "IMPLEMENTED_RESTRICTED"],
  ["CAP-03", "End-user frontend surface", "EXISTING_HOST_CMS", "apps/web/src", "REUSE_BASELINE"],
  ["CAP-04", "Generated CRUD REST/OpenAPI", "RESTRICTED_EXPERIMENTAL", "docs/platform-roadmap/execution/universal-platform-2026-11-21/WAVE-02-M03-M06.md", "CONTRACT_ONLY"],
  ["CAP-05", "Generated Admin UI", "RESTRICTED_EXPERIMENTAL", "docs/platform-roadmap/execution/universal-platform-2026-11-21/WAVE-02-M03-M06.md", "NOT_EVIDENCED"],
  ["CAP-06", "Trusted Module SDK", "PUBLIC_CONTRACT", "packages/plugin-sdk/src/index.ts", "PRIVATE_PACKAGE"],
  ["CAP-07", "PostgreSQL tenant isolation", "UNIVERSAL_PLATFORM", "packages/tenancy/src/scope.ts", "IMPLEMENTED_RESTRICTED"],
  ["CAP-08", "Workers and Outbox", "EXISTING_HOST_CMS", "apps/worker/src/processors", "REUSE_BASELINE"],
  ["CAP-09", "Published public SDK and CLI", "PLANNED", "docs/platform-roadmap/execution/universal-platform-2026-11-21/WAVE-03-M07-M08.md", "NOT_EVIDENCED"],
  ["CAP-10", "External CRM consumer", "UNIVERSAL_PLATFORM", "examples/external-crm-consumer/src/app.ts", "PACKED_PROOF_ONLY"],
  ["CAP-11", "Visual Builder", "PLANNED", "docs/platform-roadmap/execution/universal-platform-2026-11-21/WAVE-04-M09-M10.md", "NOT_EVIDENCED"],
  ["CAP-12", "AI-native development", "PLANNED", "docs/platform-roadmap/execution/universal-platform-2026-11-21/WAVE-04-M09-M10.md", "NOT_EVIDENCED"],
  ["CAP-13", "Cloud control plane", "PLANNED", "docs/platform-roadmap/execution/universal-platform-2026-11-21/WAVE-05-M11-M12.md", "NOT_EVIDENCED"],
  ["CAP-14", "Marketplace", "PLANNED", "docs/platform-roadmap/execution/universal-platform-2026-11-21/WAVE-05-M11-M12.md", "NOT_EVIDENCED"],
  ["CAP-15", "M04 Batch 03 runtime", "UNSUPPORTED_PROHIBITED", "docs/platform-roadmap/execution/universal-platform-2026-11-21/RELEASE-AND-GOVERNANCE-GATES.md", "NOT_AUTHORIZED"],
  ["CAP-16", "Production application hosting", "UNSUPPORTED_PROHIBITED", "docs/platform-roadmap/execution/universal-platform-2026-11-21/RELEASE-AND-GOVERNANCE-GATES.md", "NO_GO"],
  ["CAP-17", "Native mobile / arbitrary compute", "UNSUPPORTED_PROHIBITED", "docs/platform-roadmap/milestones/M00-engineering-baseline.md", "OUT_OF_SCOPE"],
  ["CAP-18", "Legacy CMS compatibility", "EXISTING_HOST_CMS", "packages/database/src/schema/operations.ts", "REUSE_BASELINE"],
];

export function buildCapabilityMatrix(root) {
  return {
    schemaVersion: SCHEMA_VERSION,
    matrixVersion: "2026-11-21",
    productionStatus: "NO-GO",
    riskAcceptance: "NONE",
    categories: [...CATEGORIES],
    capabilities: CAPABILITIES.map(([id, name, category, evidence, status]) => ({
      id,
      name,
      category,
      evidence,
      evidencePresent: fs.existsSync(path.join(root, evidence)),
      status,
      generallyAvailable: false,
    })),
  };
}

export function validateCapabilityMatrix(matrix) {
  const errors = [];
  if (matrix.schemaVersion !== SCHEMA_VERSION) errors.push("bad schemaVersion");
  if (matrix.productionStatus !== "NO-GO") errors.push("production status must remain NO-GO");
  for (const capability of matrix.capabilities) {
    if (!CATEGORIES.includes(capability.category)) errors.push(`${capability.id}: unknown category`);
    if (!capability.evidencePresent) errors.push(`${capability.id}: evidence path missing`);
    if (capability.generallyAvailable) errors.push(`${capability.id}: no capability is generally available at M00`);
  }
  if (!matrix.capabilities.some((c) => c.category === "UNSUPPORTED_PROHIBITED")) {
    errors.push("unsupported/prohibited capabilities must be explicit");
  }
  return errors;
}
