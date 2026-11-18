import assert from "node:assert/strict";
import { createMockContractClient } from "@vibress/schema-engine";
import { crmConsumer, renderMockAdmin } from "./m04-crm-consumer";
import { bindGeneratedMockClient, expectedBindingIdentity } from "./generated";

async function main() {
  const f = crmConsumer(), b = crmConsumer({ omitApproved: true });
  assert.equal(f.contracts.contractVersion, 2);
  assert.deepEqual(expectedBindingIdentity, f.contracts.bindingIdentity);
  assert.deepEqual(await createMockContractClient(f.contracts).invoke("deals.get", { id: "deal_1" }), { ok: false, code: "RUNTIME_UNAVAILABLE" });
  assert.throws(() => f.contracts.assertRuntimeAvailable(), /RUNTIME_UNAVAILABLE/);
  const client = bindGeneratedMockClient(f.mock(f.permitted));
  assert.deepEqual(await client["deals.get"]({ id: "deal_1" }), { ok: true, value: f.row });
  assert.deepEqual(await client["deals.approve"]({ id: "deal_1", version: "rev_1", idempotencyKey: "approval_1", data: { reason: "reviewed" } }), { ok: true, value: f.row });
  assert.deepEqual(f.requests.map(x => x.operationId), ["deals.get", "deals.approve"]);
  assert.throws(() => bindGeneratedMockClient(b.mock(b.permitted)), /INVALID_CONTRACT/);
  assert.equal(b.requests.length, 0);
  const c = crmConsumer({ installation: "other-crm" });
  assert.throws(() => bindGeneratedMockClient(c.mock(c.permitted)), /INVALID_CONTRACT/);
  assert.equal(c.requests.length, 0);
  assert.deepEqual(await f.mock({ ...f.permitted, tenant: "tenant_b" }).invoke("deals.get", { id: "deal_1" }), { ok: false, code: "FORBIDDEN" });
  const meta = f.contracts.admin[0];
  assert.ok(meta);
  const html = renderMockAdmin(meta, { ...f.row.data, secret_note: "PRIVATE" }, "mock-ready");
  assert.match(html, /صفقة &lt;demo&gt;/);
  assert.doesNotMatch(html, /PRIVATE|secret_note|id="approved"/);
  assert.match(html, /disabled/);
  assert.deepEqual(await createMockContractClient(f.contracts, { mode: "MOCK_ONLY", transport: { async send() { return { status: 403, body: { code: "NOT_FOUND" } }; } } }).invoke("deals.get", { id: "deal_1" }), { ok: false, code: "INVALID_RESPONSE" });
  console.log("EXTERNAL_M04_V2_ADAPTER_AND_MOCK_ADMIN=PASS");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
