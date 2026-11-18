// @vitest-environment node
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockContractClient, type MockContractRequest, type MockClientResult, type ContractBindingIdentity, type CompiledCrudContracts } from "@vibress/schema-engine";
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


type BoundFixture = { "deals.get"(input: {id:string}): Promise<MockClientResult>;
  "deals.approve"(input:{id:string;version:string;idempotencyKey:string;data:{reason:string}}): Promise<MockClientResult> };
type GeneratedModule = { expectedBindingIdentity: ContractBindingIdentity; bindGeneratedMockClient(client: unknown): BoundFixture };
function emitted(contracts: CompiledCrudContracts, callback: (module: GeneratedModule) => Promise<void>, source = contracts.typescript) {
  const directory = mkdtempSync(join(tmpdir(), "m04-generated-"));
  try {
    const js = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const filename = join(directory, "generated.cjs"); writeFileSync(filename,js);
    // Only trusted generator output (or explicit version regression fixture).
    const module: unknown = createRequire(import.meta.url)(filename);
    return callback(module as GeneratedModule).finally(() => rmSync(directory,{recursive:true,force:true}));
  } catch (error) { rmSync(directory,{recursive:true,force:true}); throw error; }
}
it("executes emitted typed adapter over its own validated public mock client", async () => {
  const f = crmConsumer();
  await emitted(f.contracts,async module=>{
    const client = module.bindGeneratedMockClient(f.mock(f.permitted));
    expect(await client["deals.get"]({id:"deal_1"})).toMatchObject({ok:true,value:f.row});
    expect(await client["deals.approve"]({id:"deal_1",version:"rev_1",idempotencyKey:"approval_1",data:{reason:"ok"}})).toMatchObject({ok:true});
    expect(f.requests.map(req=>req.operationId)).toEqual(["deals.get","deals.approve"]);
  });
});

it("F02 reproduces legitimate cross-contract output mismatch and refuses binding before dispatch",async()=>{
  const a=crmConsumer(),b=crmConsumer({omitApproved:true});
  expect(a.contracts.operations.map(op=>op.operationId)).toEqual(b.contracts.operations.map(op=>op.operationId));
  const bClient=b.mock(b.permitted);
  // The old binder simply passed A's operation ID to B.invoke and asserted A's output type.
  const original=await bClient.invoke("deals.get",{id:"deal_1"});
  expect(original).toMatchObject({ok:true,value:b.row});
  expect(b.row.data).not.toHaveProperty("approved");
  expect(()=>a.contracts.validateOutput("deals.get",b.row)).toThrow("INVALID_OUTPUT");
  b.requests.length=0;
  await emitted(a.contracts,async module=>{
    expect(()=>module.bindGeneratedMockClient(bClient)).toThrow("INVALID_CONTRACT");
    expect(b.requests).toHaveLength(0);
    // CommonJS exposes a writable export slot even if the exported object is
    // frozen. The generated private bindingRequirement must not read that slot.
    expect(Reflect.set(module,"expectedBindingIdentity",bClient.bindingIdentity)).toBe(true);
    expect(()=>module.bindGeneratedMockClient(bClient)).toThrow("INVALID_CONTRACT");
    expect(b.requests).toHaveLength(0);
  });
});
it.each([{editableApproved:true},{actionInput:"stage" as const},{installation:"crm-other"},{manifestChange:true}])(
  "F02 rejects distinct legitimately compiled projection, custom input, installation or manifest %j",async options=>{
    const a=crmConsumer(),b=crmConsumer(options);
    expect(a.contracts.bindingIdentity.digest).not.toBe(b.contracts.bindingIdentity.digest);
    await emitted(a.contracts,async module=>{
      expect(()=>module.bindGeneratedMockClient(b.mock(b.permitted))).toThrow("INVALID_CONTRACT");
      expect(b.requests).toHaveLength(0);
    });
  });
it("F02 equivalent independently compiled contracts bind; frozen identity and receiver reject copied/tampered/missing metadata",async()=>{
  const a=crmConsumer(),b=crmConsumer({equivalentOrder:true});
  expect(a.contracts.bindingIdentity).toEqual(b.contracts.bindingIdentity);
  expect(a.contracts.digest).toBe(b.contracts.digest);
  const client=b.mock(b.permitted),identity=client.bindingIdentity;
  expect(Object.isFrozen(identity)).toBe(true);expect(Object.isFrozen(client)).toBe(true);
  expect(Reflect.set(identity,"digest","0".repeat(64))).toBe(false);
  expect(Reflect.set(client,"bindingIdentity",{version:2,digest:"0".repeat(64)})).toBe(false);
  await emitted(a.contracts,async module=>{
    expect(Object.isFrozen(module.expectedBindingIdentity)).toBe(true);
    const bound=module.bindGeneratedMockClient(client);
    for(const wrong of [undefined,client.invoke,{invoke:client.invoke},{...client},{...client,bindingIdentity:{...identity,digest:"0".repeat(64)}},{...client,bindingIdentity:{...identity,version:1}}])
      expect(()=>module.bindGeneratedMockClient(wrong)).toThrow("INVALID_CONTRACT");
    expect(()=>client.bindContract({version:1,digest:identity.digest})).toThrow("INVALID_CONTRACT");
    const detached=client.bindContract;
    expect(()=>detached(identity)).toThrow("INVALID_CONTRACT");
    expect(()=>createMockContractClient({...b.contracts,bindingIdentity:{...b.contracts.bindingIdentity,digest:"0".repeat(64)}})).toThrow("INVALID_CONTRACT");
    expect(b.requests).toHaveLength(0);
    expect(await bound["deals.get"]({id:"deal_1"})).toMatchObject({ok:true,value:b.row});
  });
  const incompatible=a.contracts.typescript.replace(JSON.stringify(a.contracts.bindingIdentity),JSON.stringify({...a.contracts.bindingIdentity,version:1}));
  expect(incompatible).not.toBe(a.contracts.typescript);
  await emitted(a.contracts,async module=>{
    const before=b.requests.length;
    expect(()=>module.bindGeneratedMockClient(client)).toThrow("INVALID_CONTRACT");
    expect(b.requests).toHaveLength(before);
  },incompatible);
});

it("F03 operation-specific projections match schemas, OpenAPI and Admin; custom effects remain unresolved",()=>{
  const f=crmConsumer();
  const exposed=["amount","approved","occurred_at","reason","stage","title"];
  const editable=exposed.filter(x=>x!=="approved");
  for(const op of f.contracts.operations){
    const custom=op.action==="custom";
    const write=custom?["reason"]:op.action==="create"||op.action==="update"?editable:[];
    const read=op.action==="delete"?[]:exposed;
    expect(op.authorization).toMatchObject({exposedFieldIds:exposed,readFieldIds:read,writeFieldIds:write,
      customInputFieldIds:custom?["reason"]:[],customEffects:custom?"UNRESOLVED_RUNTIME_REVIEW":"NOT_APPLICABLE",
      enforcement:"REQUIRED_NOT_IMPLEMENTED"});
    const data=op.input.properties.data;
    expect(data&&"type" in data&&data.type==="object"?Object.keys(data.properties):[]).toEqual(write);
    expect(op.authorization).not.toHaveProperty("fieldIds");
    for(const fields of [op.authorization.exposedFieldIds,op.authorization.readFieldIds,op.authorization.writeFieldIds,op.authorization.customInputFieldIds]){
      expect(fields).not.toContain("secret_note");expect(fields).not.toContain("id");expect(fields).not.toContain("version");
    }
    expect(f.contracts.openapi.paths[op.path]?.[op.method]).toMatchObject({"x-vibress-authorization":op.authorization});
    expect(f.contracts.admin[0]?.operationAuthorization).toContainEqual({operationId:op.operationId,requirements:op.authorization});
  }
  expect(f.contracts.admin[0]?.forms.every(form=>JSON.stringify(form.fields)===JSON.stringify(editable))).toBe(true);
  expect(()=>f.contracts.validateInput("deals.approve",{id:"x",version:"v",idempotencyKey:"k",data:{approved:true}})).toThrow();
});

it.each(["CANCELLED","TIMEOUT"] as const)("mutation %s is local observation, not rollback; late mock completion and no retry",async expected=>{
  const f=crmConsumer();let calls=0,effects=0;
  let release!:()=>void,done!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const settled=new Promise<void>(resolve=>{done=resolve;});
  const c=createMockContractClient(f.contracts,{mode:"MOCK_ONLY",transport:{async send(){
    calls++;await gate;effects++;done();return {status:200,body:f.row};
  }}});
  const controller=new AbortController();
  const pending=c.invoke("deals.update",{id:"deal_1",version:"rev_1",data:{title:"late"}},{signal:controller.signal,timeoutMs:expected==="TIMEOUT"?5:1000});
  if(expected==="CANCELLED")controller.abort();
  expect(await pending).toEqual({ok:false,code:expected});
  expect(calls).toBe(1);expect(effects).toBe(0);
  release();await settled;
  expect(effects).toBe(1);expect(calls).toBe(1);
});
