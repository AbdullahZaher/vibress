import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  compileResourceSchema,
  defineResource,
  type ResourceDefinition,
  type SchemaCompilationScope,
} from "../schema";
import { createSchemaManifest, planSchemaChanges } from "../planning";

/**
 * Fixture only: customer_reference is ordinary text; it is NOT a foreign key.
 * A real relation field is modeled but remains unsupported for physical DDL.
 */
export const crmScope: SchemaCompilationScope = Object.freeze({
  applicationId: asApplicationId("customer-crm"),
  installationId: asInstallationId("crm-local"),
});

export function crmCustomers(includeWebsite = false): ResourceDefinition {
  return defineResource({
    ...crmScope,
    id: "customers",
    ownership: "tenant",
    fields: [
      { id: "name", type: "text", required: true },
      { id: "active", type: "boolean", required: false },
      ...(includeWebsite ? [{ id: "website", type: "text" as const, required: false }] : []),
    ],
  });
}

export function crmDeals(): ResourceDefinition {
  return defineResource({
    ...crmScope,
    id: "deals",
    ownership: "tenant",
    fields: [
      { id: "title", type: "text", required: true },
      { id: "amount", type: "number", required: false },
      { id: "customer_reference", type: "text", required: false },
    ],
  });
}

export function crmActivities(): ResourceDefinition {
  return defineResource({
    ...crmScope,
    id: "activities",
    ownership: "tenant",
    fields: [
      { id: "subject", type: "text", required: true },
      { id: "occurred_at", type: "datetime", required: false },
    ],
  });
}

export function crmPlanningExample() {
  const initialIr = compileResourceSchema([crmDeals(), crmCustomers()], crmScope);
  const initialManifest = createSchemaManifest(initialIr);
  const initialPlan = planSchemaChanges(null, initialIr, {
    expectedCurrentDigest: null,
    scope: crmScope,
  });
  const expandedIr = compileResourceSchema(
    [crmActivities(), crmCustomers(true), crmDeals()], crmScope,
  );
  const additivePlan = planSchemaChanges(initialManifest, expandedIr, {
    expectedCurrentDigest: initialManifest.digest,
    scope: crmScope,
  });
  return { initialIr, initialManifest, initialPlan, expandedIr, additivePlan };
}
