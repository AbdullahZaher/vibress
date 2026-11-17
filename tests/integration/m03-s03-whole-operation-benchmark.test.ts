// @vitest-environment node
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client, type ClientBase } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  compileResourceSchema,
  createSchemaManifest,
  planSchemaChanges,
} from "../../packages/schema-engine/src";
import { executeApprovedAdditiveColumn } from "../../packages/database/src/platform-schema-migration-operator";

/** Agent04 disposable M03-S03 benchmark. One separate PG16 test-only installation. */
const BASE_URL = process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";
const id = randomBytes(4).toString("hex");
const applicationId = asApplicationId("s03-crm");
const password = "disposable_" + id;

type Key = "a";
interface Lab {
  readonly key: Key;
  readonly name: string;
  readonly installationId: ReturnType<typeof asInstallationId>;
  readonly author: string;
  readonly approver: string;
  readonly operatorRole: string;
  readonly runtimeRole: string;
  readonly table: string;
  readonly current: ReturnType<typeof createSchemaManifest>;
  readonly plan: ReturnType<typeof planSchemaChanges>;
  readonly dbAdmin: Client;
  readonly operator: Client;
  readonly runtime: Client;
}
const labs: Lab[] = [];
let cluster: Client;

function urlFor(database: string, role?: string): string {
  const url = new URL(BASE_URL);
  url.pathname = "/" + database;
  if (role) {
    url.username = role;
    url.password = password;
  }
  return url.toString();
}

async function connect(database: string, role?: string): Promise<Client> {
  const client = new Client({
    connectionString: urlFor(database, role),
    connectionTimeoutMillis: 4000,
  });
  await client.connect();
  return client;
}

async function createLab(key: Key): Promise<Lab> {
  const name = "vibress_s03_" + key + "_" + id;
  const installationId = asInstallationId("s03-" + key);
  const author = "s03_author_" + key + "_" + id;
  const approver = "s03_approver_" + key + "_" + id;
  const operatorRole = "s03_operator_" + key + "_" + id;
  const runtimeRole = "s03_runtime_" + key + "_" + id;
  for (const role of [author, approver, operatorRole, runtimeRole]) {
    await cluster.query("CREATE ROLE " + cluster.escapeIdentifier(role) +
      " LOGIN PASSWORD " + cluster.escapeLiteral(password) +
      " NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
  }
  await cluster.query("CREATE DATABASE " + cluster.escapeIdentifier(name));
  await cluster.query("REVOKE CONNECT ON DATABASE " +
    cluster.escapeIdentifier(name) + " FROM PUBLIC");
  for (const role of [author, approver, operatorRole, runtimeRole]) {
    await cluster.query("GRANT CONNECT ON DATABASE " + cluster.escapeIdentifier(name) +
      " TO " + cluster.escapeIdentifier(role));
  }
  const dbAdmin = await connect(name);
  const schema = readFileSync(path.resolve(
    process.cwd(), "packages/database/migrations/0059_platform_schema_execution_registry.sql"), "utf8");
  await dbAdmin.query(
    "CREATE TABLE platform_applications (id text PRIMARY KEY, name text NOT NULL);" +
    "CREATE TABLE platform_installations (id text PRIMARY KEY, application_id text NOT NULL " +
    "REFERENCES platform_applications(id), environment text NOT NULL);",
  );
  await dbAdmin.query(schema);
  await dbAdmin.query(readFileSync(path.resolve(process.cwd(),
    "packages/database/migrations/0060_platform_schema_authenticated_approvals.sql"), "utf8"));
  await dbAdmin.query(
    "INSERT INTO platform_applications (id,name) VALUES ($1,$2)",
    [applicationId, "Fixture CRM"],
  );
  await dbAdmin.query(
    "INSERT INTO platform_installations (id,application_id,environment) VALUES ($1,$2,'test')",
    [installationId, applicationId],
  );
  const scope = { applicationId, installationId };
  const resource = (hasWebsite: boolean) => ({
    ...scope, id: "catalog", ownership: "application" as const,
    fields: [
      { id: "name", type: "text" as const, required: true },
      ...(hasWebsite ? [{ id: "website", type: "text" as const, required: false }] : []),
    ],
  });
  const before = compileResourceSchema([resource(false)], scope);
  const after = compileResourceSchema([resource(true)], scope);
  const current = createSchemaManifest(before);
  const plan = planSchemaChanges(current, after, {
    scope, expectedCurrentDigest: current.digest,
  });
  const table = current.resources[0]?.tableName;
  if (!table) throw new Error("missing compiled physical table");
  const qualified = '"public".' + dbAdmin.escapeIdentifier(table);
  await dbAdmin.query("CREATE TABLE " + qualified + ' ("name" text NOT NULL)');
  await dbAdmin.query("ALTER TABLE " + qualified + " OWNER TO " +
    dbAdmin.escapeIdentifier(operatorRole));
  await dbAdmin.query("INSERT INTO " + qualified + '("name") VALUES ($1),($2)',
    ["Alice", "Bob"]);
  await dbAdmin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  for (const role of [author, approver, operatorRole, runtimeRole]) {
    await dbAdmin.query("GRANT USAGE ON SCHEMA public TO " +
      dbAdmin.escapeIdentifier(role));
  }
  await dbAdmin.query("GRANT SELECT,INSERT,UPDATE,DELETE ON " + qualified +
    " TO " + dbAdmin.escapeIdentifier(runtimeRole));
  await dbAdmin.query("GRANT SELECT ON platform_installations," +
    "platform_schema_registry,platform_schema_plans,platform_schema_approvals," +
    "platform_schema_trusted_actors,platform_schema_migration_journal TO " +
    dbAdmin.escapeIdentifier(operatorRole));
  await dbAdmin.query("GRANT UPDATE(manifest,manifest_digest,updated_at) " +
    "ON platform_schema_registry TO " + dbAdmin.escapeIdentifier(operatorRole));
  await dbAdmin.query("GRANT INSERT ON platform_schema_migration_journal TO " +
    dbAdmin.escapeIdentifier(operatorRole));
  // Owner-controlled isolated database logins; no direct table DML grants.
  await dbAdmin.query("INSERT INTO platform_schema_trusted_actors " +
    "(login_name,principal_id,actor_kind) VALUES ($1,$2,'AUTHOR'),($3,$4,'APPROVER')",
    [author, "individual:" + author, approver, "individual:" + approver]);
  await dbAdmin.query("GRANT EXECUTE ON FUNCTION " +
    "public.platform_schema_submit_plan(text,text,text,text) TO " +
    dbAdmin.escapeIdentifier(author));
  await dbAdmin.query("GRANT EXECUTE ON FUNCTION " +
    "public.platform_schema_approve_operation(text,text,text,timestamptz), " +
    "public.platform_schema_revoke_operation(text,text,text) TO " +
    dbAdmin.escapeIdentifier(approver));
  await dbAdmin.query(
    "INSERT INTO platform_schema_registry " +
    "(installation_id,application_id,environment,database_name,operator_role,runtime_role,manifest,manifest_digest) " +
    "VALUES($1,$2,'test',$3,$4,$5,$6,$7)",
    [installationId, applicationId, name, operatorRole, runtimeRole,
      JSON.stringify(current), current.digest],
  );
  const writer = await connect(name, author);
  try {
    await writer.query(
      "SELECT public.platform_schema_submit_plan($1,$2,$3,$4)",
      [installationId, plan.digest, JSON.stringify(current), JSON.stringify(plan)],
    );
  } finally {
    await writer.end();
  }
  const operator = await connect(name, operatorRole);
  const runtime = await connect(name, runtimeRole);
  return { key, name, installationId, author, approver, operatorRole, runtimeRole,
    table, current, plan, dbAdmin, operator, runtime };
}

async function approve(lab: Lab): Promise<void> {
  const actor = await connect(lab.name, lab.approver);
  try {
    await actor.query(
      "SELECT public.platform_schema_approve_operation(" +
      "$1,$2,$3,clock_timestamp()+interval '20 minutes')",
      [lab.installationId, lab.plan.digest, lab.plan.operations[0]?.id],
    );
  } finally {
    await actor.end();
  }
}

async function run(lab: Lab) {
  return executeApprovedAdditiveColumn(lab.operator, {
    installationId: lab.installationId, planDigest: lab.plan.digest,
  });
}
async function hasWebsite(lab: Lab): Promise<boolean> {
  const r = await lab.dbAdmin.query<{ present: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_attribute a " +
    "JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace " +
    "WHERE n.nspname='public' AND c.relname=$1 AND a.attname='website' " +
    "AND a.attnum>0 AND NOT a.attisdropped) AS present",
    [lab.table],
  );
  return r.rows[0]?.present ?? false;
}

async function contentChecksum(lab: Lab): Promise<string> {
  const qualified = '"public".' + lab.dbAdmin.escapeIdentifier(lab.table);
  const result = await lab.dbAdmin.query<{ digest: string }>(
    "SELECT md5(string_agg(name, ',' ORDER BY name)) AS digest FROM " + qualified,
  );
  const value = result.rows[0]?.digest;
  if (!value) throw new Error("fixture content checksum unavailable");
  return value;
}


const OUT_DIR = "artifacts/m03-s03-deadline";
const NORMAL_ATTEMPTS = Number(process.env.M03_S03_NORMAL_ATTEMPTS ?? "1000");
const CONTENTION_ATTEMPTS = Number(process.env.M03_S03_CONTENTION_ATTEMPTS ?? "100");
const SAMPLES: Attempt[] = [];
let checkout = process.env.M03_S03_CHECKOUT_SHA ?? "UNVERIFIED";
let sourceHead = process.env.M03_S03_PR_HEAD_SHA ?? "UNVERIFIED";
let pgVersion = "UNVERIFIED";

interface Attempt {
  case_id: string;
  profile: string;
  outcome: string;
  elapsed_ms: number;
  connection_ms: number;
  stage_ms: Record<string, number>;
  stage_calls: Record<string, number>;
  sql_state: string | null;
}
const clock = () => process.hrtime.bigint();
const elapsed = (a: bigint, b: bigint) => Number(b - a) / 1_000_000;
const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
function percentile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const p = (sorted.length - 1) * q;
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  return Number((sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (p - lo)).toFixed(4));
}
function statistics(values: number[]) {
  const s = [...values].sort((a,b) => a-b);
  return { samples: s.length, p50_ms: percentile(s,0.5), p95_ms: percentile(s,0.95),
    p99_ms: percentile(s,0.99), max_ms: s.length ? Number(s[s.length-1]!.toFixed(4)) : null };
}
function stageName(sql: string): string {
  if (sql.startsWith("BEGIN ")) return "transaction_begin";
  if (sql.includes("vibress_m03s03_approval")) return "approval_advisory_wait";
  if (sql.includes("vibress_m03s03")) return "installation_advisory_wait";
  if (sql.includes("platform_schema_registry") && sql.includes("FOR UPDATE")) return "registry_row_lock";
  if (sql.startsWith("LOCK TABLE ")) return "target_access_exclusive_wait";
  if (sql.includes("platform_schema_approvals") && sql.includes("checked_at")) return "final_approval_authorization";
  if (sql.includes("platform_schema_approvals")) return "initial_approval_verification";
  if (sql.includes("pg_proc") || sql.includes("pg_roles") || sql.includes("has_table_privilege")) return "effective_privilege_check";
  if (sql.includes("pg_attribute") || sql.includes("pg_constraint") || sql.includes("pg_class")) return "catalog_inspection";
  if (sql.startsWith("ALTER TABLE ")) return "physical_add_field";
  if (sql.startsWith("UPDATE public.platform_schema_registry")) return "registry_cas";
  if (sql.startsWith("INSERT INTO public.platform_schema_migration_journal")) return "journal_finalize";
  if (sql === "COMMIT") return "commit_acknowledged_query";
  if (sql === "ROLLBACK") return "rollback_acknowledged_query";
  if (sql.includes("count(*)::text AS rows")) return "row_count_check";
  return "operator_preflight_other";
}
const SQLSTATE = new Set(["55P03", "57014", "40P01", "08006", "08003", "08000", "57P01"]);
type SupervisorOptions = {
  profile: string;
  caseId: string;
  clientDelayMs?: number;
  onStage?: (stage: string) => void;
};
async function supervisor(lab: Lab, options: SupervisorOptions): Promise<Attempt> {
  const start = clock(); // BEFORE connection acquisition, including libpq protocol
  const stages: Record<string, number> = {};
  const calls: Record<string, number> = {};
  let outcome = "UNKNOWN";
  let state: string | null = null;
  const client = new Client({
    connectionString: urlFor(lab.name,lab.operatorRole),
    connectionTimeoutMillis: 4000,
    query_timeout: 12000,
  });
  client.on("error", () => undefined);
  let connectedAt = start;
  try {
    await client.connect();
    connectedAt = clock();
    const proxy = new Proxy(client,{
      get(target,key) {
        if(key !== "query") {
          const value = Reflect.get(target,key,target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (sql: string, args?: unknown[]) => {
          const stage = stageName(sql);
          options.onStage?.(stage);
          const startSql = clock();
          try {
            // Controlled client-side scheduling delay models latency; it is NOT
            // a measured real network hop, DNS lookup, or TLS negotiation.
            if (options.clientDelayMs) await pause(options.clientDelayMs);
            return args===undefined ? await target.query(sql) : await target.query(sql,args);
          } catch (error) {
            const code = (error as {code?:unknown})?.code;
            if(typeof code==="string" && SQLSTATE.has(code)) state=code;
            throw error;
          } finally {
            stages[stage]=(stages[stage] ?? 0)+elapsed(startSql,clock());
            calls[stage]=(calls[stage] ?? 0)+1;
          }
        };
      },
    }) as ClientBase;
    const result=await executeApprovedAdditiveColumn(proxy,{
      installationId:lab.installationId,planDigest:lab.plan.digest,
    });
    outcome=result.status;
  } catch(error) {
    const code=(error as {code?:unknown})?.code;
    outcome = typeof code==="string" && /^[A-Z_0-9]{1,32}$/.test(code)
      ? code : "UNCLASSIFIED_FAILURE";
  } finally {
    await client.end().catch(()=>undefined);
  }
  const sample:Attempt={case_id:options.caseId, profile:options.profile,
    outcome,elapsed_ms:Number(elapsed(start,clock()).toFixed(4)),
    connection_ms:Number(elapsed(start,connectedAt).toFixed(4)),
    stage_ms:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,Number(v.toFixed(4))])),
    stage_calls:calls,sql_state:state,
  };
  SAMPLES.push(sample);
  return sample;
}
async function resetForNext(lab:Lab) {
  const target='"public".'+lab.dbAdmin.escapeIdentifier(lab.table);
  await lab.dbAdmin.query("ALTER TABLE "+target+" DROP COLUMN IF EXISTS website");
  await lab.dbAdmin.query("DELETE FROM public.platform_schema_migration_journal WHERE installation_id=$1",[lab.installationId]);
  await lab.dbAdmin.query("UPDATE public.platform_schema_registry SET manifest=$1,manifest_digest=$2 WHERE installation_id=$3",
    [JSON.stringify(lab.current),lab.current.digest,lab.installationId]);
}
async function assertPhysical(lab:Lab,expectedDigest:string) {
  const state=(await lab.dbAdmin.query<{manifest_digest:string}>(
    "SELECT manifest_digest FROM public.platform_schema_registry WHERE installation_id=$1",
    [lab.installationId])).rows[0]?.manifest_digest;
  expect(state).toBe(expectedDigest);
  const journal=(await lab.dbAdmin.query<{status:string}>(
    "SELECT status FROM public.platform_schema_migration_journal WHERE installation_id=$1",
    [lab.installationId])).rows;
  expect(journal).toEqual([{status:"COMPLETED"}]);
  expect(await hasWebsite(lab)).toBe(true);
}
function groups() {
  const profiles=[...new Set(SAMPLES.map(s=>s.profile))];
  return Object.fromEntries(profiles.map(profile=>{
    const set=SAMPLES.filter(s=>s.profile===profile);
    const valid=set.filter(s=>s.outcome==="APPLIED");
    const stageNames=[...new Set(set.flatMap(s=>Object.keys(s.stage_ms)))];
    return [profile,{
      attempted:set.length,
      outcomes:Object.fromEntries([...new Set(set.map(s=>s.outcome))].map(outcome=>
        [outcome,set.filter(s=>s.outcome===outcome).length])),
      elapsed_success:statistics(valid.map(s=>s.elapsed_ms)),
      elapsed_all:statistics(set.map(s=>s.elapsed_ms)),
      connect:statistics(set.map(s=>s.connection_ms)),
      stages:Object.fromEntries(stageNames.map(k=>[k,statistics(set.map(s=>s.stage_ms[k] ?? 0))])),
      sql_state_counts:Object.fromEntries([...new Set(set.map(s=>s.sql_state).filter(Boolean))].map(code=>
        [code,set.filter(s=>s.sql_state===code).length])),
    }];
  }));
}
function writeArtifacts() {
  mkdirSync(OUT_DIR,{recursive:true});
  const raw=SAMPLES.map(s=>JSON.stringify(s)).join("\n")+"\n";
  writeFileSync(path.join(OUT_DIR,"raw-attempts.jsonl"),raw,{mode:0o600});
  const summary={
    schema:"m03-s03-whole-operation-benchmark/v1",checkout_sha:checkout,
    pr_head_sha:sourceHead,postgres_version:pgVersion,node_version:process.version,
    topology:"disposable localhost PG16 via GitHub Actions; no external DNS/TLS, no production workload",
    measurement:"hrtime bigint starts before connection and ends after result/connection disposal",
    samples:SAMPLES.length,
    expected_normal:NORMAL_ATTEMPTS,expected_contention:CONTENTION_ATTEMPTS,
    groups:groups(),owner_slo:"MISSING",policy_a:"NOT_APPROVED",
    deadline_approved:false, production_representative:false,
  };
  writeFileSync(path.join(OUT_DIR,"summary.json"),JSON.stringify(summary,null,2)+"\n",{mode:0o600});
  console.log("AG04_BENCH_SUMMARY "+JSON.stringify({
    samples:summary.samples,checkout:checkout,normal:summary.groups["normal"]?.elapsed_success,
    contention:summary.groups["table_contention"]?.elapsed_all,
  }));
}
beforeAll(async()=>{
  if(!Number.isInteger(NORMAL_ATTEMPTS)||NORMAL_ATTEMPTS<1||NORMAL_ATTEMPTS>1500||
     !Number.isInteger(CONTENTION_ATTEMPTS)||CONTENTION_ATTEMPTS<1||CONTENTION_ATTEMPTS>200)
    throw Error("BENCHMARK_COUNTS_OUT_OF_BOUNDS");
  const target=new URL(BASE_URL);
  if(target.hostname!=="127.0.0.1"||target.port!=="5433"||
     target.pathname!=="/vibress"||target.username!=="vibress"||
     target.password!=="vibress"||target.search!=="")
    throw Error("REFUSE_NON_DISPOSABLE_POSTGRESQL");
  cluster=await connect("vibress");
  const info=(await cluster.query<{superuser:boolean;version:number}>(
    "SELECT r.rolsuper AS superuser,current_setting('server_version_num')::int AS version "+
    "FROM pg_roles r WHERE r.rolname=current_user")).rows[0];
  if(!info?.superuser||info.version<160000||info.version>=170000)
    throw Error("DISPOSABLE_PG16_SUPERUSER_REQUIRED");
  pgVersion=String(info.version);
  const lab=await createLab("a");
  labs.push(lab);
  await approve(lab);
},120000);
afterAll(async()=>{
  // Emit evidence even when a test fails. Never mark incomplete matrices PASS.
  writeArtifacts();
  for(const lab of labs) {
    await lab.operator.end().catch(()=>undefined);
    await lab.runtime.end().catch(()=>undefined);
    await lab.dbAdmin.end().catch(()=>undefined);
  }
  if(cluster){
    const names=labs.map(l=>l.name);
    await cluster.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity "+
      "WHERE datname=ANY($1::text[]) AND pid<>pg_backend_pid()",[names]);
    for(const lab of labs){
      await cluster.query("DROP DATABASE "+cluster.escapeIdentifier(lab.name));
      for(const role of [lab.runtimeRole,lab.operatorRole,lab.approver,lab.author]){
        await cluster.query("DROP ROLE "+cluster.escapeIdentifier(role));
      }
    }
    const remaining=await cluster.query<{n:number}>(
      "SELECT (SELECT count(*)::int FROM pg_database WHERE datname=ANY($1::text[]))+"+
      "(SELECT count(*)::int FROM pg_roles WHERE rolname=ANY($2::text[])) AS n",
      [names,labs.flatMap(l=>[l.runtimeRole,l.operatorRole,l.approver,l.author])]);
    await cluster.end();
    expect(remaining.rows[0]?.n).toBe(0);
  }
},120000);
describe("Agent04 M03-S03 real PG16 end-to-end timing (DISPOSABLE only)",()=>{
  it("measures normal physical ADD_FIELD start-before-connect through COMMIT ACK",async()=>{
    const lab=labs[0]!;
    const checksum=await contentChecksum(lab);
    // Warmups are excluded and disclosed; each operation is reset outside
    // its measured interval with exactly the original canonical manifest.
    for(let w=0;w<3;w++){
      const result=await supervisor(lab,{profile:"warmup",caseId:"warmup-"+w});
      expect(result.outcome).toBe("APPLIED");
      await resetForNext(lab);
    }
    for(let i=0;i<NORMAL_ATTEMPTS;i++){
      const sample=await supervisor(lab,{profile:"normal",caseId:"N-"+String(i).padStart(4,"0")});
      expect(sample.outcome).toBe("APPLIED");
      if(i%100===0) {
        await assertPhysical(lab,lab.plan.proposedManifest.digest);
        expect(await contentChecksum(lab)).toBe(checksum);
      }
      await resetForNext(lab);
    }
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(checksum);
  },900000);
  it("measures moderate/high table locks and actual 2s lock-timeouts",async()=>{
    const lab=labs[0]!;
    const blocker=await connect(lab.name);
    const checksum=await contentChecksum(lab);
    try{
      for(let i=0;i<CONTENTION_ATTEMPTS;i++){
        const hold=i%10===0 ? 2200 : i%4===0 ? 900 : 120;
        await blocker.query("BEGIN");
        await blocker.query('LOCK TABLE ONLY "public".'+blocker.escapeIdentifier(lab.table)+
          " IN ACCESS SHARE MODE");
        let notify!:()=>void;
        const entered=new Promise<void>(resolve=>{notify=resolve;});
        const inFlight=supervisor(lab,{
          profile:"table_contention",caseId:"C-"+String(i).padStart(3,"0"),
          onStage:(stage)=>{if(stage==="target_access_exclusive_wait")notify();},
        });
        await Promise.race([entered,pause(7000).then(()=>{throw Error("BENCH_LOCK_STAGE_NOT_REACHED")})]);
        await pause(hold);
        await blocker.query("ROLLBACK");
        const sample=await inFlight;
        expect(["APPLIED","UNAUTHORIZED","INDETERMINATE"]).toContain(sample.outcome);
        // Timeouts must not fabricate a completed journal.
        if(sample.outcome==="APPLIED")await assertPhysical(lab,lab.plan.proposedManifest.digest);
        else {
          const n=(await lab.dbAdmin.query(
            "SELECT 1 FROM public.platform_schema_migration_journal")).rowCount;
          expect(n).toBe(0);
        }
        expect(await contentChecksum(lab)).toBe(checksum);
        await resetForNext(lab);
      }
    } finally {await blocker.query("ROLLBACK").catch(()=>undefined);await blocker.end().catch(()=>undefined);}
  },450000);
  it("measures cumulative sub-statement client transport/scheduling delays",async()=>{
    const lab=labs[0]!;
    for(let i=0;i<12;i++){
      const sample=await supervisor(lab,{profile:"injected_client_delay_4ms_per_sql",
        caseId:"D-"+String(i).padStart(3,"0"), clientDelayMs:4});
      expect(sample.outcome).toBe("APPLIED");
      await resetForNext(lab);
    }
  },120000);
  it("measures larger seeded table ADD_FIELD within the permitted operation",async()=>{
    const lab=labs[0]!;
    const target='"public".'+lab.dbAdmin.escapeIdentifier(lab.table);
    await lab.dbAdmin.query("INSERT INTO "+target+" (name) SELECT 'bench-'||g::text "+
      "FROM generate_series(1,10000) g");
    try{
      for(let i=0;i<12;i++){
        const sample=await supervisor(lab,{profile:"seeded_table_10002_rows",
          caseId:"L-"+String(i).padStart(3,"0")});
        expect(sample.outcome).toBe("APPLIED");
        await resetForNext(lab);
      }
    }finally{
      await lab.dbAdmin.query("DELETE FROM "+target+" WHERE name LIKE 'bench-%'");
    }
  },120000);
});
