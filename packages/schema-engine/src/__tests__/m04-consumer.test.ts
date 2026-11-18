import { describe, expect, it } from "vitest";
import ts from "typescript";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockContractClient, type MockContractRequest, type MockClientResult, type MockClientOptions } from "@vibress/schema-engine";
import { crmConsumer, renderMockAdmin } from "./fixtures/m04-crm-consumer";

describe("M04 mock-only public export consumer", () => {
  it("retains disabled default and serializes a bounded list and versioned patch deterministically", async () => {
    const f = crmConsumer();
    expect(await createMockContractClient(f.contracts).invoke("deals.list", {})).toEqual({ ok: false, code: "RUNTIME_UNAVAILABLE" });
    const client = f.mock(f.permitted);
    expect(await client.invoke("deals.list", { cursor: "next_1", limit: 1 })).toMatchObject({ ok: true });
    expect(await client.invoke("deals.update", { id: "deal_1", version: "rev_1", data: { title: "عميل" } })).toMatchObject({ ok: true });
    expect(f.requests).toEqual([
      { operationId: "deals.list", method: "get", path: "/generated/v1/deals?limit=1&cursor=next_1", headers: {} },
      { operationId: "deals.update", method: "patch", path: "/generated/v1/deals/deal_1", headers: { "X-Resource-Version": "rev_1" }, body: { title: "عميل" } },
    ]);
  });
  it("compiles reviewed deal approval with version, idempotency, scope, transaction and cost requirements", async () => {
    const f = crmConsumer();
    const op = f.contracts.operations.find(x => x.operationId === "deals.approve")!;
    expect(op).toMatchObject({ action: "custom", method: "post", transactionRequired: true, idempotencyRequired: true, runtime: "DISABLED",
      authorization: { permission: "resource:deals:action:approve", requireTenantContext: true, authenticatedInstallationContext: true, enforcement: "REQUIRED_NOT_IMPLEMENTED" },
      cost: { maxRows: 1, maxMutationBatch: 1 } });
    const client = f.mock(f.permitted);
    const input = { id: "deal_1", version: "rev_1", idempotencyKey: "operation_1", data: { reason: "reviewed" } };
    expect(await client.invoke("deals.approve", input)).toMatchObject({ ok: true });
    expect(f.requests[0]).toEqual({ operationId: "deals.approve", method: "post", path: "/generated/v1/deals/actions/approve/deal_1",
      headers: { "X-Resource-Version": "rev_1", "Idempotency-Key": "operation_1" }, body: { reason: "reviewed" } });
    expect(await client.invoke("deals.approve", { ...input, idempotencyKey: undefined })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await client.invoke("deals.approve", { ...input, data: { secret_note: "hidden" } })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await client.invoke("deals.approve", { ...input, tenantId: "tenant_b" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(f.requests).toHaveLength(1);
  });
  it("exercises mock authorization denial with separate fixture identities, not runtime enforcement", async () => {
    const f = crmConsumer();
    for (const fixture of [{ ...f.permitted, tenant: "tenant_b" }, { ...f.permitted, installation: "wrong" }, { ...f.permitted, permissions: [] }])
      expect(await f.mock(fixture).invoke("deals.get", { id: "deal_1" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await f.mock({ ...f.permitted, authenticated: false }).invoke("deals.list", {})).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });
  it("refuses projection leaks, mismatched id, invalid status and wire error code, oversized requested list", async () => {
    const f = crmConsumer();
    const cases: unknown[] = [
      { status: 200, body: { ...f.row, data: { ...f.row.data, secret_note: "secret" } } },
      { status: 200, body: { ...f.row, id: "other" } },
      { status: 201, body: f.row }, { status: 403, body: { code: "NOT_FOUND" } },
      { status: 403, body: { code: "FORBIDDEN", detail: "secret" } },
    ];
    for (const response of cases) {
      const client = createMockContractClient(f.contracts, { mode: "MOCK_ONLY", transport: { async send() { return response; } } });
      expect(await client.invoke("deals.get", { id: "deal_1" })).toEqual({ ok: false, code: "INVALID_RESPONSE" });
    }
    const list = createMockContractClient(f.contracts, { mode: "MOCK_ONLY", transport: { async send() { return { status: 200, body: { items: [f.row, f.row], nextCursor: null } }; } } });
    expect(await list.invoke("deals.list", { limit: 1 })).toEqual({ ok: false, code: "INVALID_RESPONSE" });
  });
  it("denies read-only mutation and unknown query fields before transport", async () => {
    const f = crmConsumer(), c = f.mock(f.permitted);
    expect(await c.invoke("deals.create", { data: { title: "x", approved: true } })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await c.invoke("deals.list", { filter: { approved: true } })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(f.requests).toHaveLength(0);
  });
  it("cancels and times out without retries or leaking transport errors", async () => {
    const f = crmConsumer();
    let calls = 0, cancelled = 0;
    const c = createMockContractClient(f.contracts, { mode: "MOCK_ONLY", transport: { async send(_request: MockContractRequest, signal: AbortSignal) {
      calls++;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => { cancelled++; reject(Error("private")); }, { once: true }));
    } } });
    const controller = new AbortController(); controller.abort();
    expect(await c.invoke("deals.list", {}, { signal: controller.signal })).toEqual({ ok: false, code: "CANCELLED" });
    expect(calls).toBe(0);
    expect(await c.invoke("deals.list", {}, { timeoutMs: 5 })).toEqual({ ok: false, code: "TIMEOUT" });
    const live = new AbortController();
    const pending = c.invoke("deals.list", {}, { signal: live.signal }); live.abort();
    expect(await pending).toEqual({ ok: false, code: "CANCELLED" });
    expect(calls).toBe(2); expect(cancelled).toBe(2);
    const bad = createMockContractClient(f.contracts, { mode: "MOCK_ONLY", transport: { async send() { throw Error("secret"); } } });
    expect(await bad.invoke("deals.list", {})).toEqual({ ok: false, code: "TRANSPORT_FAILURE" });
  });
  it("renders escaped reference forms and tables from metadata only, excluding read-only controls and hidden fields", async () => {
    const f = crmConsumer(), meta = f.contracts.admin[0]!;
    expect(meta.fields.find(x => x.id === "approved")).toMatchObject({ editable: false, widget: "checkbox" });
    expect(meta.fields.find(x => x.id === "stage")).toMatchObject({ widget: "select", values: ["lead", "won"] });
    expect(meta.forms[0]).toMatchObject({ permission: "resource:deals:create" });
    const html = renderMockAdmin(meta, { ...f.row.data, secret_note: "PRIVATE" }, "mock-ready");
    expect(html).toContain('<label for="title">title</label>'); expect(html).toContain('<th scope="col">approved</th>');
    expect(html).not.toContain('id="approved"'); expect(html).not.toContain("secret_note"); expect(html).not.toContain("PRIVATE");
    expect(html).toContain("صفقة &lt;demo&gt;"); expect(html).toContain("<option>won</option>");
    for (const state of ["loading", "error", "runtime-disabled"] as const) {
      const view = renderMockAdmin(meta, f.row.data, state);
      expect(view).toContain('data-state="' + state + '"'); expect(view).not.toContain("<form");
    }
    // User-facing mock consumer also uses the public client, not a DB or admin.
    expect(await f.mock(f.permitted).invoke("deals.get", { id: "deal_1" })).toMatchObject({ ok: true, value: f.row });
  });
});


it("executes emitted typed adapter over the validated public mock transport", async () => {
  const f = crmConsumer();
  const directory = mkdtempSync(join(tmpdir(), "m04-generated-"));
  try {
    const source = ts.transpileModule(f.contracts.typescript, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const filename = join(directory, "generated.cjs");
    writeFileSync(filename, source);
    // Trusted generator output only; no downloaded/user executable code.
    const loaded: unknown = createRequire(import.meta.url)(filename);
    const module = loaded as { bindGeneratedMockClient(invoke: (id: string, input: unknown, options?: MockClientOptions) => Promise<MockClientResult>): {
      "deals.get"(input: {id:string}): Promise<MockClientResult>;
      "deals.approve"(input: {id:string;version:string;idempotencyKey:string;data:{reason:string}}): Promise<MockClientResult>;
    }};
    const client = module.bindGeneratedMockClient(f.mock(f.permitted).invoke);
    expect(await client["deals.get"]({id:"deal_1"})).toMatchObject({ok:true,value:f.row});
    expect(await client["deals.approve"]({id:"deal_1",version:"rev_1",idempotencyKey:"approval_1",data:{reason:"ok"}})).toMatchObject({ok:true});
    expect(f.requests.map(req=>req.operationId)).toEqual(["deals.get","deals.approve"]);
  } finally { rmSync(directory, {recursive:true,force:true}); }
});
