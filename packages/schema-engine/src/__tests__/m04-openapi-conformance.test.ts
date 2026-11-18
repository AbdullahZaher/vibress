import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { crmConsumer } from "./fixtures/m04-crm-consumer";

function validator() {
  // OAI document schema allows extension vocabularies; no coercion/defaults,
  // schema mutation, remote reference loading or executable customer schema.
  return addFormats(new Ajv2020({ strict: false, allErrors: true, validateFormats: true,
    coerceTypes: false, useDefaults: false, removeAdditional: false }));
}
const officialSchema: unknown = JSON.parse(readFileSync(new URL("./fixtures/openapi-3.1-2025-11-23.json", import.meta.url), "utf8"));
describe("M04 independent OpenAPI 3.1 / JSON Schema conformance", () => {
  it("validates the complete document against the unchanged official OAI structural schema", () => {
    const f = crmConsumer(), ajv = validator();
    const check = ajv.compile(officialSchema as object);
    expect(check(f.contracts.openapi), JSON.stringify(check.errors)).toBe(true);
    expect(check({ ...f.contracts.openapi, info: {} })).toBe(false);
    const operations = Object.entries(f.contracts.openapi.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, item]) => ({ path, method, item })));
    expect(operations).toHaveLength(6);
    const ids = new Set<string>();
    for (const op of f.contracts.operations) {
      const wire = operations.find(o => o.path === op.path && o.method === op.method);
      expect(wire).toBeDefined();
      expect(wire?.item).toMatchObject({ operationId: op.operationId, security: [{ futureBearer: [] }],
        "x-vibress-runtime": "DISABLED" });
      ids.add(op.operationId);
      // Independently validate the actual emitted Schema Objects; the OAI
      // structural schema intentionally does not validate these subschemas.
      expect(ajv.validateSchema(op.input)).toBe(true);
      expect(ajv.validateSchema(op.output)).toBe(true);
      if (op.input.properties.data) expect(ajv.validateSchema(op.input.properties.data)).toBe(true);
      const params = [{name:"id",in:"path",required:true}].filter(() => op.path.endsWith("/{id}"));
      if (op.requiresOptimisticConcurrency) params.push({ name: "X-Resource-Version", in: "header", required: true });
      if (op.idempotencyRequired) params.push({ name: "Idempotency-Key", in: "header", required: true });
      if (op.action === "list") params.push(...Object.keys(op.input.properties).map(name => ({name,in:"query",required:false})));
      expect(wire?.item).toMatchObject({ parameters: params, responses: {
        [op.action === "create" ? "201" : "200"]: { content: { "application/json": { schema: op.output } } },
        "400": { content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "503": { content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      } });
      if (op.input.properties.data) expect(wire?.item).toMatchObject({ requestBody: { required: true,
        content: { "application/json": { schema: op.input.properties.data } } } });
    }
    expect(ids.size).toBe(operations.length);
    const errors = ajv.compile(f.contracts.openapi.components.schemas.Error);
    expect(errors({ code: "FORBIDDEN" })).toBe(true);
    expect(errors({ code: "FORBIDDEN", detail: "private" })).toBe(false);
    expect(errors({ code: "unexpected" })).toBe(false);
    const json = JSON.stringify(f.contracts.openapi);
    expect(json).not.toContain("secret_note");
    expect(json).not.toContain(f.scope.installationId);
  });
  it("compares internal and independent Draft 2020-12 validation on portable JSON corpus", () => {
    const f = crmConsumer(), ajv = validator();
    const cases: ReadonlyArray<readonly [string, "input" | "output", unknown, boolean]> = [
      ["deals.create","input",{data:{title:"العربية 😀"}},true],
      ["deals.create","input",{data:{title:"x",amount:null}},true],
      ["deals.create","input",{data:{title:"x",stage:"lead"}},true],
      ["deals.create","input",{data:{title:"x",stage:"other"}},false],
      ["deals.create","input",{data:{title:null}},false],
      ["deals.create","input",{data:{}},false],
      ["deals.create","input",{data:{title:"x",approved:true}},false],
      ["deals.create","input",{data:{title:"x",secret_note:"hidden"}},false],
      ["deals.create","input",{data:{title:"a\u0000b"}},false],
      ["deals.create","input",{data:{title:"\ud800"}},false],
      ["deals.create","input",{data:{title:"\udfff"}},false],
      ["deals.create","input",{data:{title:"😀".repeat(4096)}},true],
      ["deals.create","input",{data:{title:"😀".repeat(4097)}},false],
      ["deals.create","input",{data:{title:"x",occurred_at:"2024-02-29T00:00:00.123Z"}},true],
      ["deals.create","input",{data:{title:"x",occurred_at:"2024-02-30T00:00:00Z"}},false],
      ["deals.create","input",{data:{title:"x",occurred_at:"0000-01-01T00:00:00Z"}},false],
      ["deals.create","input",{data:{title:"x",occurred_at:"2024-01-01T00:00:00+03:00"}},false],
      ["deals.update","input",{id:"x",version:"v",data:{}},false],
      ["deals.update","input",{id:"x",version:"v",data:{amount:null}},true],
      ["deals.update","input",{id:"x\n",version:"v",data:{title:"x"}},false],
      ["deals.list","input",{limit:25,cursor:"next"},true],
      ["deals.list","input",{limit:26},false],
      ["deals.list","input",{count:true},false],
      ["deals.approve","input",{id:"x",version:"v",idempotencyKey:"k",data:{reason:"ok"}},true],
      ["deals.approve","input",{id:"x",version:"v",data:{reason:"ok"}},false],
      ["deals.get","output",f.row,true],
      ["deals.get","output",{...f.row,data:{...f.row.data,secret_note:"x"}},false],
      ["deals.list","output",{items:[f.row],nextCursor:null},true],
      ["deals.list","output",{items:[],nextCursor:null,total:1},false],
    ];
    let executed = 0;
    for (const [id, direction, value, expected] of cases) {
      const op = f.contracts.operations.find(x => x.operationId === id)!;
      const external = ajv.compile(direction === "input" ? op.input : op.output);
      let internal = true;
      try { direction === "input" ? f.contracts.validateInput(id,value) : f.contracts.validateOutput(id,value); }
      catch { internal = false; }
      expect(internal, id + " internal case " + executed).toBe(expected);
      expect(external(value), id + " external case " + executed).toBe(expected);
      executed++;
    }
    expect(executed).toBe(29);
  });
  it("retains stricter non-JSON and transport-level constraints rather than weakening validation", () => {
    const f = crmConsumer(), ajv = validator();
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => f.contracts.validateInput("deals.create",{data:{title:"x",amount:value}})).toThrow();
    }
    const schema = f.contracts.operations.find(x => x.operationId === "deals.create")!.input;
    const leapSecond = { data: { title:"x", occurred_at:"2016-12-31T23:59:60Z" } };
    expect(() => f.contracts.validateInput("deals.create",leapSecond)).toThrow();
    // RFC3339 permits leap seconds; this PostgreSQL/JS portability profile does not.
    expect(ajv.compile(schema)(leapSecond)).toBe(true);
    const large = {items:Array.from({length:25},(_,i)=>({...f.row,id:"r_"+i,data:{...f.row.data,title:"😀".repeat(4096),reason:"😀".repeat(4096)}})),nextCursor:null};
    // Normalized aggregate byte budget is not a portable JSON Schema keyword:
    // original list budget is 1 MiB, this fixture is below it. Verify a larger
    // bounded schema through the existing aggregate budget regression tests.
    expect(ajv.compile(f.contracts.operations.find(x=>x.operationId==="deals.list")!.output)(large)).toBe(true);
    expect(()=>f.contracts.validateOutput("deals.list",large)).not.toThrow();
  });
});
