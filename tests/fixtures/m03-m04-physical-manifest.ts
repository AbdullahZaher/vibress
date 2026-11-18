import assert from "node:assert/strict";
import { asApplicationId, asInstallationId } from "../../packages/platform-kernel/src/index";
import { compileResourceSchema, createSchemaManifest, defineResource, parseSchemaManifest, planSchemaChanges } from "../../packages/schema-engine/src/index";

// Only a scalar customer contract is persisted. The fixed deal FK is a separate
// physical fixture; the merged compiler still refuses automatic relation DDL.
const scope = { applicationId: asApplicationId("customer-crm"), installationId: asInstallationId("disposable-crm") };
const foreignScope = { ...scope, installationId: asInstallationId("other-crm") };
function customer(s: typeof scope) {
  return defineResource({ ...s, id: "customers", ownership: "tenant", fields: [
    { id: "label", type: "text", required: true },
  ] });
}
const ir = compileResourceSchema([customer(scope)], scope);
const expected = createSchemaManifest(ir);
const foreignIr = compileResourceSchema([customer(foreignScope)], foreignScope);
const foreign = createSchemaManifest(foreignIr);
assert.deepEqual(parseSchemaManifest(JSON.parse(JSON.stringify(expected))), expected);
assert.deepEqual(parseSchemaManifest(JSON.parse(JSON.stringify(foreign))), foreign);
assert.notEqual(expected.digest, foreign.digest);
assert.equal(expected.resources[0]?.tableName, "vr_customers_055ab105b715");
assert.equal(foreign.resources[0]?.tableName, expected.resources[0]?.tableName);
assert.throws(() => planSchemaChanges(null, foreignIr, { expectedCurrentDigest: null, scope }), { code: "BOUNDARY_VIOLATION" });
assert.throws(() => parseSchemaManifest({ ...expected, installationId: foreignScope.installationId }));
const plan = planSchemaChanges(null, ir, { expectedCurrentDigest: null, scope });
assert.equal(plan.disposition, "REVIEW_REQUIRED");
assert.equal(plan.operations[0]?.status, "REQUIRES_REVIEW");
const deal = defineResource({ ...scope, id: "deals", ownership: "tenant", fields: [
  { id: "customer_reference", type: "relation", required: true, targetResource: "customers" },
] });
const relationPlan = planSchemaChanges(null, compileResourceSchema([customer(scope), deal], scope), {
  expectedCurrentDigest: null, scope,
});
assert.equal(relationPlan.operations.find((op) => op.resourceId === "deals")?.status, "UNSUPPORTED");
process.stdout.write(JSON.stringify({ expected: JSON.stringify(expected), foreign: JSON.stringify(foreign) }));
