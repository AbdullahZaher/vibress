// @vitest-environment node
import { randomBytes } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { startDisposableTransportProxy } from "../../scripts/platform/m03-s03-benchmark/transport-latency-proxy";
import { startCommitAckDropProxy } from "../../scripts/platform/m03-s03-fault/pg-wire-proxy";
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

async function _run(lab: Lab) {
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
const checkout = process.env.M03_S03_CHECKOUT_SHA ?? "UNVERIFIED";
const sourceHead = process.env.M03_S03_PR_HEAD_SHA ?? "UNVERIFIED";
let pgVersion = "UNVERIFIED";

interface Attempt {
  case_id: string;
  profile: string;
  outcome: string;
  elapsed_ms: number;
  connection_ms: number;
  stage_ms: Record<string, number>;
  stage_calls: Record<string, number>;
  timeline_ms?: { connection_start_ms: number; connection_acquired_ms: number;
    result_classified_ms: number; client_disposed_ms: number;
    stages: Record<string, Array<{start_ms:number;end_ms:number}>>; };
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
  connectionPort?: number;
  testDeadlineMs?: number;
  preCommitReserveMs?: number;
  onConnected?: (client: Client) => Promise<void>;
  onStage?: (stage: string) => void;
};
async function supervisor(lab: Lab, options: SupervisorOptions): Promise<Attempt> {
  const start = clock(); // BEFORE connection acquisition, including libpq protocol
  const stages: Record<string, number> = {};
  const timelineStages: Record<string, Array<{start_ms:number;end_ms:number}>> = {};
  const calls: Record<string, number> = {};
  let outcome: string;
  let state: string | null = null;
  const targetUrl = new URL(urlFor(lab.name,lab.operatorRole));
  if (options.connectionPort !== undefined) targetUrl.port = String(options.connectionPort);
  const client = new Client({
    connectionString: targetUrl.toString(),
    connectionTimeoutMillis: 4000,
    query_timeout: 12000,
  });
  client.on("error", () => undefined);
  let connectedAt = start;
  const connectStart = clock();
  let classifiedAt: bigint;
  try {
    await client.connect();
    connectedAt = clock();
    if (options.onConnected) await options.onConnected(client);
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
            // Explicit TEST-ONLY admission guard. It does not cancel in-flight
            // backend work and MUST NOT be certified as a production supervisor.
            if (options.testDeadlineMs !== undefined &&
                stage !== "rollback_acknowledged_query") {
              const remaining = options.testDeadlineMs - elapsed(start,clock());
              const minReserve = stage === "commit_acknowledged_query" ||
                stage === "physical_add_field" ? (options.preCommitReserveMs ?? 0) : 0;
              if (remaining <= minReserve) throw Error("BENCH_TEST_ONLY_ADMISSION_BUDGET");
            }
            // Controlled client-side scheduling delay models latency; it is NOT
            // a measured real network hop, DNS lookup, or TLS negotiation.
            if (options.clientDelayMs) await pause(options.clientDelayMs);
            return args===undefined ? await target.query(sql) : await target.query(sql,args);
          } catch (error) {
            const code = (error as {code?:unknown})?.code;
            if(typeof code==="string" && SQLSTATE.has(code)) state=code;
            throw error;
          } finally {
            const endSql=clock();
            stages[stage]=(stages[stage] ?? 0)+elapsed(startSql,endSql);
            (timelineStages[stage] ??= []).push({
              start_ms:Number(elapsed(start,startSql).toFixed(4)),
              end_ms:Number(elapsed(start,endSql).toFixed(4)),
            });
            calls[stage]=(calls[stage] ?? 0)+1;
          }
        };
      },
    }) as ClientBase;
    const result=await executeApprovedAdditiveColumn(proxy,{
      installationId:lab.installationId,planDigest:lab.plan.digest,
    });
    outcome=result.status;
    classifiedAt=clock();
  } catch(error) {
    const code=(error as {code?:unknown})?.code;
    outcome = typeof code==="string" && /^[A-Z_0-9]{1,32}$/.test(code)
      ? code : "UNCLASSIFIED_FAILURE";
    classifiedAt=clock();
  } finally {
    await client.end().catch(()=>undefined);
  }
  const disposedAt=clock();
  if(connectedAt===start) connectedAt=disposedAt;
  const sample:Attempt={case_id:options.caseId, profile:options.profile,
    outcome,elapsed_ms:Number(elapsed(start,disposedAt).toFixed(4)),
    connection_ms:Number(elapsed(start,connectedAt).toFixed(4)),
    stage_ms:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,Number(v.toFixed(4))])),
    stage_calls:calls,sql_state:state,
    timeline_ms:{ connection_start_ms:Number(elapsed(start,connectStart).toFixed(4)),
      connection_acquired_ms:Number(elapsed(start,connectedAt).toFixed(4)),
      result_classified_ms:Number(elapsed(start,classifiedAt).toFixed(4)),
      client_disposed_ms:Number(elapsed(start,disposedAt).toFixed(4)),
      stages:timelineStages},
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
  const raw=SAMPLES.map(s=>JSON.stringify({...s,checkout_sha:checkout,
    node_version:process.version,postgres_version:pgVersion,attempts_total:SAMPLES.length})).join("\n")+"\n";
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


/** Expanded metrics are intentionally separate from historical warm-cache baseline. */
const PROFILE_SAMPLES = {network5:20,network15:20,network30:12,
  ack60:20,ack200:10,cancel:20,terminate:10,lostAck:8,
  cumulative:12,connectionFailures:24,largeIndexed:12} as const;

function sampleFault(profile:string,caseId:string,outcome:string,
  start:bigint,fields:Record<string,number>={},sqlState:string|null=null): Attempt {
  const ms=Number(elapsed(start,clock()).toFixed(4));
  const result:Attempt={profile,case_id:caseId,outcome,
    elapsed_ms:ms,connection_ms:fields.connection_ms ?? 0,
    stage_ms:fields,stage_calls:{},sql_state:sqlState};
  SAMPLES.push(result);
  return result;
}
async function noCompletedJournal(lab:Lab){
  expect(await hasWebsite(lab)).toBe(false);
  const r=await lab.dbAdmin.query(
    "SELECT 1 FROM public.platform_schema_migration_journal WHERE installation_id=$1",
    [lab.installationId]);
  expect(r.rowCount).toBe(0);
  const state=await lab.dbAdmin.query<{manifest_digest:string}>(
    "SELECT manifest_digest FROM public.platform_schema_registry WHERE installation_id=$1",
    [lab.installationId]);
  expect(state.rows[0]?.manifest_digest).toBe(lab.current.digest);
}
async function independentlyReconcile(lab:Lab){
  const t0=clock();
  // Fresh trusted database observer; immutable plan/digest identity pins
  // prevent relying on the uncertain operator's in-memory result alone.
  const fresh=await connect(lab.name);
  try{
    const state=(await fresh.query<{manifest_digest:string}>(
      "SELECT manifest_digest FROM public.platform_schema_registry "+
      "WHERE installation_id=$1",[lab.installationId])).rows[0]?.manifest_digest;
    const journal=(await fresh.query<{status:string,plan_digest:string}>(
      "SELECT status,plan_digest FROM public.platform_schema_migration_journal "+
      "WHERE installation_id=$1",[lab.installationId])).rows;
    const physical=(await fresh.query<{found:boolean}>(
      "SELECT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid "+
      "JOIN pg_namespace n ON n.oid=c.relnamespace "+
      "WHERE n.nspname='public' AND c.relname=$1 AND a.attname='website' "+
      "AND a.attnum>0 AND NOT a.attisdropped) AS found",[lab.table])).rows[0]?.found;
    const committed = state===lab.plan.proposedManifest.digest &&
      physical===true && journal.length===1 &&
      journal[0]?.status==="COMPLETED" && journal[0]?.plan_digest===lab.plan.digest;
    const rolledBack = state===lab.current.digest &&
      physical===false && journal.length===0;
    return {state:committed?"COMMITTED":rolledBack?"ROLLED_BACK":"HALT_UNRECONCILABLE",
      latency_ms:Number(elapsed(t0,clock()).toFixed(4))};
  }finally{await fresh.end().catch(()=>undefined);}
}
function targetTable(lab:Lab){return '"public".'+lab.dbAdmin.escapeIdentifier(lab.table);}
const deadlines:{a:number;b:number;reserve:number}={a:0,b:0,reserve:0};
function deriveTestCandidates(){
  const allSuccess=SAMPLES.filter(s=>s.outcome==="APPLIED");
  // Acceptance class: localhost + one profile of at most 30ms one-way
  // proxy delay OR <=900ms external lock; not simultaneous unless separately
  // measured. Exclude injected 2200ms lock timeouts from success p99.
  const considered=allSuccess.filter(x=>x.profile==="normal" ||
    x.profile==="table_contention"||x.profile==="network_oneway_5ms"||
    x.profile==="network_oneway_15ms"||x.profile==="network_oneway_30ms"||
    x.profile==="cumulative_3_lock_waits"||x.profile==="ack_extra_200ms");
  const maxSuccessful=Math.max(...considered.map(s=>s.elapsed_ms));
  const p99=Math.max(...[...new Set(considered.map(x=>x.profile))].map(profile=>{
    const xs=considered.filter(x=>x.profile===profile).map(x=>x.elapsed_ms);
    return statistics(xs).p99_ms ?? 0;
  }));
  const cleanup=SAMPLES.filter(x=>x.profile==="cancel_lock_wait");
  const cancelTail=statistics(cleanup.map(x=>x.stage_ms["cancel_to_classification_ms"] ?? 0)).p99_ms ?? 0;
  const rollbackTail=statistics(cleanup.map(x=>x.stage_ms["rollback_acknowledged_query"] ?? 0)).p99_ms ?? 0;
  // Empirically measured cleanup tail + explicit 100ms unvalidated scheduler
  // allowance; this is an OWNER SLO assumption, not a proven physical bound.
  const reserve=Math.ceil(cancelTail+rollbackTail+100);
  // Candidate A covers measured p99 (not worst) plus cleanup allowance.
  // Candidate B covers the observed maximum plus two cleanup reserves.
  deadlines.a=Math.ceil(p99+reserve);
  deadlines.b=Math.ceil(maxSuccessful+reserve*2);
  deadlines.reserve=reserve;
  if(deadlines.a<1||deadlines.b<=deadlines.a||
     !Number.isSafeInteger(deadlines.b))
    throw Error("BENCH_NO_DEFENSIBLE_TEST_DEADLINE");
}
function writeExpandedArtifacts() {
  const cohort=(p:string)=>SAMPLES.filter(s=>s.profile===p);
  const profiles=[...new Set(SAMPLES.map(s=>s.profile))];
  const attempts=Object.fromEntries(profiles.map(p=>{
    const set=cohort(p);
    return [p,{attempts:set.length,results:Object.fromEntries(
      [...new Set(set.map(x=>x.outcome))].map(o=>[o,set.filter(x=>x.outcome===o).length])),
      elapsed_all:statistics(set.map(x=>x.elapsed_ms)),
      elapsed_applied:statistics(set.filter(x=>x.outcome==="APPLIED").map(x=>x.elapsed_ms)),
      sqlstates:Object.fromEntries([...new Set(set.map(x=>x.sql_state).filter(Boolean))]
        .map(code=>[code,set.filter(x=>x.sql_state===code).length]))}];
  }));
  const faultProfiles=profiles.filter(p=>/(cancel|terminate|ack|connection|budget)/i.test(p));
  const fault={
    schema:"m03-s03-fault-timing/v1",checkout_sha:checkout,node_version:process.version,
    all_attempts:SAMPLES.length,
    postgres_version:pgVersion,
    profiles:Object.fromEntries(faultProfiles.map(p=>[p,attempts[p]])),
    important:"cancel signal delivery != backend completion; COMMIT ACK loss != rollback",
  };
  const all=SAMPLES.filter(s=>s.outcome==="APPLIED");
  function empiricalDeadline(ms:number){
    const supported=all.filter(x=>x.profile==="normal"||
      x.profile==="table_contention"||x.profile.startsWith("network_oneway_")||
      x.profile==="cumulative_3_lock_waits"||x.profile==="ack_extra_200ms");
    return {n:supported.length,observed_exceedances:supported.filter(x=>x.elapsed_ms>ms).length,
      observed_rate_percent:Number((100*supported.filter(x=>x.elapsed_ms>ms).length/
      Math.max(1,supported.length)).toFixed(4))};
  }
  const decision={
    schema:"m03-s03-conditional-lab-deadline/v1",checkout_sha:checkout,
    node_version:process.version,postgres_version:pgVersion,attempts_total:SAMPLES.length,
    owner_slo:"MISSING - illustrative assumption only: <=1% extra false deadlines in stated lab class",
    production_authorization:false,policy_a_owner_selected:true,
    recommendations_unapproved:true,
    formula:"A=ceil(max profile-specific measured successful p99 + reserve); B=ceil(max observed successful duration + 2*reserve)",
    reserve_ms:deadlines.reserve,
    reserve_basis:"measured cancellation-to-classification p99 plus rollback-ACK p99 plus 100ms explicitly unverified scheduling margin",
    supported_topology:"isolated loopback PG16, no TLS, at most one injected 30ms one-way transport proxy OR <=900ms table contention",
    candidate_a_ms:deadlines.a,candidate_b_ms:deadlines.b,
    candidate_a_empirical:empiricalDeadline(deadlines.a),
    candidate_b_empirical:empiricalDeadline(deadlines.b),
    profiles:attempts,
    caveats:"No rigorous p99 network or cancellation guarantee; no physical commit upper bound. Not production.",
  };
  mkdirSync(OUT_DIR,{recursive:true});
  writeFileSync(path.join(OUT_DIR,"deadline-candidates.json"),
    JSON.stringify(decision,null,2)+"\n",{mode:0o600});
  writeFileSync(path.join(OUT_DIR,"fault-timing-summary.json"),
    JSON.stringify(fault,null,2)+"\n",{mode:0o600});
  writeFileSync(path.join(OUT_DIR,"topology-assumptions.json"),JSON.stringify({
    schema:"m03-s03-topology/v1",checkout_sha:checkout,node:process.version,
    postgres:pgVersion,transport:"localhost real TCP byte delay proxy; not DNS/TLS/WAN",
    database:"disposable single PG16 installation migration 0059/0060",
    lock_timeout_ms:2000,statement_timeout_ms:10000,idle_transaction_timeout_ms:15000,
    baseline_attempts:NORMAL_ATTEMPTS,contention_attempts:CONTENTION_ATTEMPTS,
    additional_profile_target_counts:PROFILE_SAMPLES,
    latency_assumptions:[5,15,30],
    risk:"warm relation; repeated same DDL, no independent installation variance or production workload",
  },null,2)+"\n",{mode:0o600});
  console.log("AG04_NUMERIC_LAB_CANDIDATES "+JSON.stringify({
    a:deadlines.a,b:deadlines.b,reserve:deadlines.reserve,
    evidence:decision.candidate_a_empirical,network30:attempts["network_oneway_30ms"]?.elapsed_applied,
  }));
}
afterAll(async()=>{
  if(SAMPLES.some(x=>x.profile==="network_oneway_30ms") && deadlines.a!==0) writeExpandedArtifacts();
},120000);

describe("M03-S03 Agent04 additional real-PG16 latency and fault profiles",()=>{
  it("measures real loopback TCP payload-delay profiles, not DNS/TLS",async()=>{
    const lab=labs[0]!;
    for(const [delay,count] of [[5,PROFILE_SAMPLES.network5],
      [15,PROFILE_SAMPLES.network15],[30,PROFILE_SAMPLES.network30]] as const){
      const proxy=await startDisposableTransportProxy({
        upstreamMs:delay,downstreamMs:delay});
      try{
        for(let i=0;i<count;i++){
          const s=await supervisor(lab,{profile:"network_oneway_"+delay+"ms",
            caseId:"NET"+delay+"-"+i,connectionPort:proxy.port});
          expect(s.outcome).toBe("APPLIED");
          await resetForNext(lab);
        }
      }finally{await proxy.close();}
    }
  },420000);
  it("measures deliberately delayed COMMIT response separately from physical commit",async()=>{
    const lab=labs[0]!;
    for(const [delay,count] of [[60,PROFILE_SAMPLES.ack60],
      [200,PROFILE_SAMPLES.ack200]] as const){
      const proxy=await startDisposableTransportProxy({commitAckExtraMs:delay});
      try{
        for(let i=0;i<count;i++){
          const s=await supervisor(lab,{profile:"ack_extra_"+delay+"ms",
            caseId:"ACK"+delay+"-"+i,connectionPort:proxy.port});
          expect(s.outcome).toBe("APPLIED");
          expect(s.stage_ms["commit_acknowledged_query"] ?? 0).toBeGreaterThan(delay*.75);
          await resetForNext(lab);
        }
      }finally{await proxy.close();}
    }
  },120000);
  it("measures connection errors from T0 before TCP authentication",async()=>{
    const lab=labs[0]!;
    for(const mode of ["refused","bad_auth","blackhole"] as const){
      const count=8;
      const proxy=mode==="blackhole"?
        await startDisposableTransportProxy({handshakeMode:"blackhole"}):undefined;
      try{
        for(let i=0;i<count;i++){
          const started=clock();
          const url=new URL(urlFor(lab.name,lab.operatorRole));
          if(mode==="refused") url.port="1";
          if(mode==="bad_auth") url.password="definitely_incorrect_test_password";
          if(mode==="blackhole")url.port=String(proxy!.port);
          const client=new Client({connectionString:url.toString(),
            connectionTimeoutMillis:mode==="blackhole"?120:700});
          client.on("error",()=>undefined);
          let result="UNEXPECTED_SUCCESS",code:string|null=null;
          try{await client.connect();}
          catch(e){
            code=typeof (e as {code?:unknown})?.code==="string" ?
              (e as {code:string}).code:null;
            result=mode==="refused"?"CONNECTION_REFUSED":
              mode==="bad_auth"?"AUTH_FAILED":"CONNECT_TIMEOUT";
          }finally{await client.end().catch(()=>undefined);}
          const sample=sampleFault("connection_"+mode,"CON-"+mode+"-"+i,
            result,started,{connection_ms:Number(elapsed(started,clock()).toFixed(4))},code);
          expect(sample.outcome).not.toBe("UNEXPECTED_SUCCESS");
        }
      }finally{await proxy?.close();}
    }
  },30000);
  it("repeats three independently short actual PostgreSQL waits in one operation",async()=>{
    const lab=labs[0]!;
    const baseChecksum=await contentChecksum(lab);
    for(let i=0;i<PROFILE_SAMPLES.cumulative;i++){
      const install=await connect(lab.name),registry=await connect(lab.name),
        relation=await connect(lab.name);
      const pending:Promise<unknown>[]=[];
      try{
        await install.query("BEGIN");
        await install.query("SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03'), hashtext($1::text))",
          [lab.installationId]);
        await registry.query("BEGIN");
        await registry.query("SELECT 1 FROM platform_schema_registry WHERE installation_id=$1 FOR UPDATE",
          [lab.installationId]);
        await relation.query("BEGIN");
        await relation.query("LOCK TABLE ONLY "+targetTable(lab)+" IN ACCESS SHARE MODE");
        const stageToSession:Record<string,Client>={
          installation_advisory_wait:install,registry_row_lock:registry,
          target_access_exclusive_wait:relation,
        };
        const released=new Set<string>();
        const s=await supervisor(lab,{profile:"cumulative_3_lock_waits",
          caseId:"W-"+i,onStage:(stage)=>{
            const held=stageToSession[stage];
            if(held && !released.has(stage)){
              released.add(stage);
              pending.push(pause(250).then(()=>held.query("ROLLBACK")));
            }
          }});
        await Promise.all(pending);
        expect(released.size).toBe(3);
        expect(s.outcome).toBe("APPLIED");
        expect(s.elapsed_ms).toBeGreaterThan(700);
        await assertPhysical(lab,lab.plan.proposedManifest.digest);
        expect(await contentChecksum(lab)).toBe(baseChecksum);
        await resetForNext(lab);
      }finally{
        for(const cl of [install,registry,relation]){
          await cl.query("ROLLBACK").catch(()=>undefined);
          await cl.end().catch(()=>undefined);
        }
      }
    }
  },120000);
  it("measures verified out-of-band pg_cancel_backend and acknowledged ROLLBACK",async()=>{
    const lab=labs[0]!;
    const checksum=await contentChecksum(lab);
    const blocker=await connect(lab.name);
    try{
      for(let i=0;i<PROFILE_SAMPLES.cancel;i++){
        await blocker.query("BEGIN");
        await blocker.query("LOCK TABLE ONLY "+targetTable(lab)+" IN ACCESS SHARE MODE");
        let backendPid=0;
        let dispatch=0n;
        let sent=0n;
        let cancelSuccess=false;
        let cancelTask:Promise<void>|undefined;
        const start=clock();
        const s=await supervisor(lab,{profile:"cancel_lock_wait",caseId:"CAN-"+i,
          onConnected:async client=>{
            backendPid=(await client.query<{pid:number}>(
              "SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
          },onStage:stage=>{
            if(stage==="target_access_exclusive_wait"&&!cancelTask){
              cancelTask=(async()=>{
                await pause(45);
                dispatch=clock();
                cancelSuccess=(await lab.dbAdmin.query<{signal:boolean}>(
                  "SELECT pg_cancel_backend($1) AS signal",[backendPid]))
                  .rows[0]?.signal ?? false;
                sent=clock();
              })();
            }
          }});
        await cancelTask;
        await blocker.query("ROLLBACK");
        expect(cancelSuccess).toBe(true);
        expect(s.outcome).toBe("UNAUTHORIZED"); // existing sanitized operator behavior
        expect(s.sql_state).toBe("57014");
        s.stage_ms["cancel_signal_dispatch_ms"]=Number(elapsed(dispatch,sent).toFixed(4));
        s.stage_ms["cancel_to_classification_ms"]=Number(elapsed(dispatch,clock()).toFixed(4));
        s.stage_ms["cancel_total_from_t0_ms"]=Number(elapsed(start,clock()).toFixed(4));
        await noCompletedJournal(lab);
        expect(await contentChecksum(lab)).toBe(checksum);
        const r=await independentlyReconcile(lab);
        expect(r.state).toBe("ROLLED_BACK");
        s.stage_ms["fresh_reconcile_ms"]=r.latency_ms;
      }
    }finally{
      await blocker.query("ROLLBACK").catch(()=>undefined);
      await blocker.end().catch(()=>undefined);
    }
  },120000);
  it("measures real terminated backend and independently proven rollback",async()=>{
    const lab=labs[0]!;
    const checksum=await contentChecksum(lab);
    const blocker=await connect(lab.name);
    try{
      for(let i=0;i<PROFILE_SAMPLES.terminate;i++){
        await blocker.query("BEGIN");
        await blocker.query("LOCK TABLE ONLY "+targetTable(lab)+" IN ACCESS SHARE MODE");
        let pid=0;
        let dispatch=0n,ended=0n;
        let task:Promise<void>|undefined;
        const s=await supervisor(lab,{profile:"backend_terminated",
          caseId:"TERM-"+i,onConnected:async client=>{
            pid=(await client.query<{pid:number}>(
              "SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
          },onStage:stage=>{
            if(stage==="target_access_exclusive_wait"&&!task){
              task=(async()=>{
                await pause(45);
                dispatch=clock();
                const signaled=await lab.dbAdmin.query<{ok:boolean}>(
                  "SELECT pg_terminate_backend($1) AS ok",[pid]);
                expect(signaled.rows[0]?.ok).toBe(true);
                ended=clock();
              })();
            }
          }});
        await task;
        await blocker.query("ROLLBACK");
        expect(["INDETERMINATE","UNAUTHORIZED"]).toContain(s.outcome);
        const remaining=(await lab.dbAdmin.query<{n:number}>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1",[pid]))
          .rows[0]?.n;
        expect(remaining).toBe(0); // server can no longer COMMIT
        await noCompletedJournal(lab);
        expect(await contentChecksum(lab)).toBe(checksum);
        const r=await independentlyReconcile(lab);
        expect(r.state).toBe("ROLLED_BACK");
        s.stage_ms["backend_signal_dispatch_ms"]=Number(elapsed(dispatch,ended).toFixed(4));
        s.stage_ms["fresh_reconcile_ms"]=r.latency_ms;
      }
    }finally{
      await blocker.query("ROLLBACK").catch(()=>undefined);
      await blocker.end().catch(()=>undefined);
    }
  },120000);
  it("measures real dropped COMMIT ACK and fresh-session committed reconciliation",async()=>{
    const lab=labs[0]!;
    const checksum=await contentChecksum(lab);
    for(let i=0;i<PROFILE_SAMPLES.lostAck;i++){
      const proxy=await startCommitAckDropProxy();
      try{
        const s=await supervisor(lab,{profile:"ack_lost_indeterminate",
          caseId:"LOST-"+i,connectionPort:proxy.port});
        await Promise.race([proxy.serverCommitObserved,
          pause(5000).then(()=>{throw Error("LOST_ACK_NOT_SEEN")})]);
        expect(s.outcome).toBe("INDETERMINATE");
        const r=await independentlyReconcile(lab);
        expect(r.state).toBe("COMMITTED");
        s.stage_ms["fresh_reconcile_ms"]=r.latency_ms;
        await assertPhysical(lab,lab.plan.proposedManifest.digest);
        expect(await contentChecksum(lab)).toBe(checksum);
        await resetForNext(lab);
      }finally{await proxy.close();}
    }
  },120000);
  it("measures representative synthetic indexed and constrained table",async()=>{
    const lab=labs[0]!;
    const name="s03_bench_idx_"+id;
    const qualified=targetTable(lab);
    await lab.dbAdmin.query("CREATE INDEX "+lab.dbAdmin.escapeIdentifier(name)+
      " ON "+qualified+" (name)");
    await lab.dbAdmin.query("ALTER TABLE "+qualified+
      " ADD CONSTRAINT name_nonempty CHECK (length(name) > 0)");
    await lab.dbAdmin.query("INSERT INTO "+qualified+
      " (name) SELECT 'indexed-'||n::text FROM generate_series(1,25000) n");
    try{
      for(let i=0;i<PROFILE_SAMPLES.largeIndexed;i++){
        const s=await supervisor(lab,{profile:"indexed_constrained_25002_rows",
          caseId:"IDX-"+i});
        // Unauthorized additional indexes/constraints are NOT part of the
        // approved canonical manifest. A secure operator MUST reject live
        // catalog drift instead of silently accepting an unmodeled index.
        expect(s.outcome).toBe("CATALOG_DRIFT");
        await noCompletedJournal(lab);
      }
    }finally{
      await lab.dbAdmin.query("DELETE FROM "+qualified+" WHERE name LIKE 'indexed-%'");
      await lab.dbAdmin.query("ALTER TABLE "+qualified+" DROP CONSTRAINT name_nonempty");
      await lab.dbAdmin.query("DROP INDEX public."+lab.dbAdmin.escapeIdentifier(name));
    }
  },120000);
  it("derives nonapproved exact integer laboratory deadlines and retests admission",async()=>{
    const lab=labs[0]!;
    deriveTestCandidates();
    expect(deadlines.a).toBeGreaterThan(0);
    expect(deadlines.b).toBeGreaterThan(deadlines.a);
    for(const [candidate,ms] of [["A",deadlines.a],["B",deadlines.b]] as const){
      for(let i=0;i<8;i++){
        const s=await supervisor(lab,{profile:"candidate_"+candidate+"_normal",
          caseId:candidate+"-N-"+i,testDeadlineMs:ms,
          preCommitReserveMs:deadlines.reserve});
        expect(s.outcome).toBe("APPLIED");
        await resetForNext(lab);
      }
      for(let i=0;i<8;i++){
        const blocker=await connect(lab.name);
        let release:Promise<void>|undefined;
        try{
          await blocker.query("BEGIN");
          await blocker.query("LOCK TABLE ONLY "+targetTable(lab)+" IN ACCESS SHARE MODE");
          const s=await supervisor(lab,{profile:"candidate_"+candidate+"_table_lock_500ms",
            caseId:candidate+"-L-"+i,testDeadlineMs:ms,
            preCommitReserveMs:deadlines.reserve,
            onStage:stage=>{
              if(stage==="target_access_exclusive_wait"&&!release){
                release=pause(500).then(async()=>{await blocker.query("ROLLBACK");});
              }
            }});
          await release;
          expect(s.outcome).toBe("APPLIED");
          await resetForNext(lab);
        }finally{
          await blocker.query("ROLLBACK").catch(()=>undefined);
          await blocker.end().catch(()=>undefined);
        }
      }
      for(let i=0;i<4;i++){
        const s=await supervisor(lab,{profile:"candidate_"+candidate+"_deadline_exhaustion",
          caseId:candidate+"-EXP-"+i,testDeadlineMs:ms,
          preCommitReserveMs:deadlines.reserve,
          clientDelayMs:Math.max(120,Math.ceil(ms/9))});
        // No DDL/journal even when multiple individually short waits
        // exhaust a client budget. Runtime error class is NOT certified.
        expect(s.outcome).not.toBe("APPLIED");
        await noCompletedJournal(lab);
      }
    }
    writeExpandedArtifacts();
  },120000);
  it("validates frozen independent 2408/2517ms candidates against new real PG workloads",async()=>{
    // Constants are from THREE completed prior independent raw CI artifacts;
    // they are not dynamically chosen from this validation cohort.
    // 2408=ceil(max successful profile p99 2298.0869 + max cleanup reserve 109)
    // 2517=ceil(max full-success 2298.1778 + 2*109)
    const lab=labs[0]!;
    for(const [label,budget] of [["A",2408],["B",2517]] as const){
      for(let i=0;i<8;i++){
        const s=await supervisor(lab,{profile:"frozen_candidate_"+label+"_normal",
          caseId:"F"+label+"-N-"+i,testDeadlineMs:budget,
          preCommitReserveMs:109});
        expect(s.outcome).toBe("APPLIED");
        expect(s.elapsed_ms).toBeLessThanOrEqual(budget);
        await resetForNext(lab);
      }
      for(let i=0;i<8;i++){
        const blocker=await connect(lab.name);
        let release:Promise<void>|undefined;
        try{
          await blocker.query("BEGIN");
          await blocker.query("LOCK TABLE ONLY "+targetTable(lab)+" IN ACCESS SHARE MODE");
          const s=await supervisor(lab,{
            profile:"frozen_candidate_"+label+"_table_lock_500ms",
            caseId:"F"+label+"-L-"+i,testDeadlineMs:budget,preCommitReserveMs:109,
            onStage:stage=>{
              if(stage==="target_access_exclusive_wait"&&!release){
                release=pause(500).then(async()=>{await blocker.query("ROLLBACK");});
              }
            },
          });
          await release;
          expect(s.outcome).toBe("APPLIED");
          expect(s.elapsed_ms).toBeLessThanOrEqual(budget);
          await assertPhysical(lab,lab.plan.proposedManifest.digest);
          await resetForNext(lab);
        }finally{
          await blocker.query("ROLLBACK").catch(()=>undefined);
          await blocker.end().catch(()=>undefined);
        }
      }
      for(let i=0;i<4;i++){
        const s=await supervisor(lab,{
          profile:"frozen_candidate_"+label+"_deadline_exhaustion",
          caseId:"F"+label+"-D-"+i,testDeadlineMs:budget,
          preCommitReserveMs:109,clientDelayMs:Math.ceil(budget/9),
        });
        expect(s.outcome).not.toBe("APPLIED");
        await noCompletedJournal(lab);
      }
    }
    writeExpandedArtifacts();
  },120000);

});


/**
 * AG02 + AG04 combined-fault D1 engineering laboratory.
 * This is intentionally NOT the deployed CLI supervisor or an approved M.
 * All real PostgreSQL sessions are disposed of by the inherited strict hooks.
 */
const COMBINED_D1_MS = 2517;
type D1Class = "ON_TIME_APPLIED" | "COMMITTED_LATE" | "INDETERMINATE" | "NOT_APPLIED";
const combinedMeta: Record<string, unknown> = {};
const d1Pg06Proof: Array<Record<string, unknown>> = [];
const combinedEvents: Array<Record<string, unknown>> = [];
const combinedClock = () => process.hrtime.bigint();

function classifyD1TestOnly(status: string, t13: number | null, t14: number,
  definitiveAck: boolean): {classification: D1Class; deadline_breached: boolean} {
  const onTime = definitiveAck && t13 !== null &&
    t13 <= COMBINED_D1_MS && t14 <= COMBINED_D1_MS;
  if (status === "APPLIED" && onTime) {
    return {classification:"ON_TIME_APPLIED",deadline_breached:false};
  }
  if (status === "APPLIED" && definitiveAck) {
    return {classification:"COMMITTED_LATE",deadline_breached:true};
  }
  if (status === "INDETERMINATE" || !definitiveAck) {
    return {classification:"INDETERMINATE",deadline_breached:true};
  }
  return {classification:"NOT_APPLIED",deadline_breached:t14>COMBINED_D1_MS};
}
function combinedCandidateMarginGate(remainingMs:number, hypotheticalMarginMs:number){
  if (!Number.isFinite(remainingMs) || remainingMs<=0) return false;
  if (!Number.isSafeInteger(hypotheticalMarginMs) || hypotheticalMarginMs<1) return false;
  return remainingMs > hypotheticalMarginMs;
}
function addedTimeline(sample:Attempt){
  const commit=sample.timeline_ms?.stages["commit_acknowledged_query"]?.[0];
  const t14=sample.timeline_ms?.result_classified_ms ?? null;
  return {t0_ms:0, t12_ms:commit?.start_ms ?? null,t13_ms:
    commit && sample.outcome==="APPLIED" ? commit.end_ms : null,
    t14_ms:t14,t15_ms:sample.timeline_ms?.client_disposed_ms ?? null,
    remaining_precommit_ms:commit ? Number((COMBINED_D1_MS-commit.start_ms).toFixed(4)):null,
    commit_ack_ms:commit ? Number((commit.end_ms-commit.start_ms).toFixed(4)):null,
    d1_compliant:sample.outcome==="APPLIED" && commit!==undefined &&
      commit.end_ms<=COMBINED_D1_MS && t14!==null && t14<=COMBINED_D1_MS};
}
function recordCombined(sample:Attempt, other:Record<string,unknown>={}){
  const stage=addedTimeline(sample);
  const row={case_id:sample.case_id,profile:sample.profile,outcome:sample.outcome,
    elapsed_ms:sample.elapsed_ms,sql_state:sample.sql_state,
    connection_ms:sample.connection_ms,stage_elapsed_ms:sample.stage_ms,
    stage_monotonic_timeline_ms:sample.timeline_ms?.stages ?? {},
    ...stage,...other};
  combinedEvents.push(row);
  return row;
}
function busyStall(ms:number){
  const end=combinedClock()+BigInt(ms)*1_000_000n;
  while(combinedClock()<end) { /* deliberate test-only event-loop pressure */ }
}
function writeCombinedEvidence(){
  const basedir="artifacts/m03-s03-combined-fault";
  mkdirSync(basedir,{recursive:true});
  const rows=combinedEvents.map(row=>JSON.stringify(row)).join("\n")+"\n";
  writeFileSync(path.join(basedir,"combined-fault-raw-attempts.jsonl"),rows,{mode:0o600});
  const profiles=[...new Set(combinedEvents.map(x=>String(x.profile)))];
  const groups=Object.fromEntries(profiles.map(profile=>{
    const xs=combinedEvents.filter(x=>x.profile===profile);
    const toN=(key:string)=>xs.map(x=>x[key]).filter((v):v is number=>
      typeof v==="number" && Number.isFinite(v));
    return [profile,{n:xs.length,outcomes:Object.fromEntries(
      [...new Set(xs.map(x=>String(x.outcome)))].map(outcome=>
        [outcome,xs.filter(x=>x.outcome===outcome).length])),
      elapsed:statistics(toN("elapsed_ms")),
      t12_precommit:statistics(toN("t12_ms")),
      ack:statistics(toN("commit_ack_ms")),
      t14:statistics(toN("t14_ms")),
      remaining_at_commit:statistics(toN("remaining_precommit_ms")),
      d1_late_applied:xs.filter(x=>x.outcome==="APPLIED"&&x.d1_compliant!==true).length,
      d1_compliant_applied:xs.filter(x=>x.d1_compliant===true).length}];
  }));
  const summary={schema:"m03-s03-d1-combined-fault/v1",source_sha:sourceHead,
    checkout_sha:checkout,operator_blob_expected:"31b1e862f594434944fec516f768265baf794525",
    node_version:process.version,postgres_version:pgVersion,
    owner_policy:"FINAL_PRE_DDL",owner_d1_ms:COMBINED_D1_MS,
    execution:"restricted disposable PG16 only; no integrated global supervisor",
    measurement:"actual loopback byte-delay proxy plus real lock/commit and test-only adapters",
    combined_cases:combinedEvents.length,
    groups,uncertainty:"descriptive; no supported D1 hard bound, production SLA or human approval",
    d1pg06:d1Pg06Proof,events:combinedMeta,
    generated_at:new Date().toISOString()};
  writeFileSync(path.join(basedir,"combined-fault-summary.json"),
    JSON.stringify(summary,null,2)+"\n",{mode:0o600});
  const candidates={schema:"m03-s03-commit-admission-candidates/v1",
    owner_d1_ms:COMBINED_D1_MS,
    measured_max_commit_ack:Math.max(0,...combinedEvents.map(x=>Number(x.commit_ack_ms ?? 0))),
    candidate_margin_ms:null,
    decision:"NOT DETERMINABLE until complete combined fault/SLO/recovery statistical evidence",
    historic_109ms_is_not_ack_margin:true,
    approval_status:"NOT APPROVED",owner_d1_unchanged:true};
  writeFileSync(path.join(basedir,"commit-admission-candidates.json"),
    JSON.stringify(candidates,null,2)+"\n",{mode:0o600});
  writeFileSync(path.join(basedir,"cancellation-recovery-timings.json"),
    JSON.stringify({schema:"m03-s03-combined-cancel/v1",source_sha:sourceHead,
      cases:combinedEvents.filter(x=>String(x.profile).includes("cancel")||
        String(x.profile).includes("lost_ack")||
        String(x.profile).includes("kill")),
      note:"Signals alone do not prove ROLLBACK; fresh admin reconciliation required",
    },null,2)+"\n",{mode:0o600});
  writeFileSync(path.join(basedir,"d1-pg06-regression.json"),
    JSON.stringify({schema:"m03-s03-d1-pg06/v1",source_sha:sourceHead,
      owner_d1_ms:COMBINED_D1_MS,
      cases:d1Pg06Proof, production_supervisor_integrated:false},null,2)+"\n",{mode:0o600});
  console.log("AG02_AG04_COMBINED_FAULT_RESULTS",JSON.stringify({
    count:combinedEvents.length,profiles:Object.fromEntries(profiles.map(p=>
      [p,groups[p]?.n])),late_applied:Object.values(groups).reduce((a,g)=>a+(g?.d1_late_applied??0),0),
    pg06:d1Pg06Proof.length,policy:"NOT CERTIFIED"}));
}
afterAll(()=>{writeCombinedEvidence();},120000);

describe("AG02-AG04 D1 combined-fault independent disposable PG16",()=>{
  it("samples physical TCP delays 5/15/30ms combined with +60/+200ms COMMIT ACK delay",async()=>{
    const lab=labs[0]!;
    for(const upstream of [5,15,30] as const){
      for(const additionalAck of [60,200] as const){
        const count=upstream===30?12:6;
        const p=await startDisposableTransportProxy({
          upstreamMs:upstream,downstreamMs:upstream,commitAckExtraMs:additionalAck});
        try{
          for(let i=0;i<count;i++){
            const sample=await supervisor(lab,{profile:
              "combined_tcp_"+upstream+"_ack_"+additionalAck,
              caseId:"C-TCP-"+upstream+"-"+additionalAck+"-"+i,connectionPort:p.port});
            expect(sample.outcome).toBe("APPLIED"); // original source has no D1 timing guard
            recordCombined(sample,{transport_one_way_ms:upstream,
              commit_extra_ms:additionalAck});
            await assertPhysical(lab,lab.plan.proposedManifest.digest);
            await resetForNext(lab);
          }
        }finally{await p.close();}
      }
    }
  },300000);

  it("samples actual PG ACCESS EXCLUSIVE waits of 500/900ms under 30ms TCP byte delay",async()=>{
    const lab=labs[0]!;
    const p=await startDisposableTransportProxy({upstreamMs:30,downstreamMs:30});
    try{
      for(const waitMs of [500,900] as const){
        for(let i=0;i<5;i++){
          const blocker=await connect(lab.name);
          let release:Promise<void>|undefined;
          try{
            await blocker.query("BEGIN");
            await blocker.query("LOCK TABLE ONLY "+targetTable(lab)+" IN ACCESS SHARE MODE");
            const sample=await supervisor(lab,{profile:"combined_tcp_30_lock_"+waitMs,
              caseId:"C-LOCK-"+waitMs+"-"+i,connectionPort:p.port,onStage:stage=>{
                if(stage==="target_access_exclusive_wait"&&!release){
                  release=pause(waitMs).then(()=>blocker.query("ROLLBACK")).then(()=>undefined);
                }
              }});
            await release;
            expect(sample.outcome).toBe("APPLIED");
            recordCombined(sample,{transport_one_way_ms:30,table_wait_ms:waitMs});
            await assertPhysical(lab,lab.plan.proposedManifest.digest);
            await resetForNext(lab);
          }finally{
            await blocker.query("ROLLBACK").catch(()=>undefined);
            await blocker.end().catch(()=>undefined);
          }
        }
      }
    }finally{await p.close();}
  },180000);

  it("samples 30ms TCP proxy plus three actual sequential 250ms PostgreSQL locks",async()=>{
    const lab=labs[0]!;
    const p=await startDisposableTransportProxy({upstreamMs:30,downstreamMs:30});
    try{
      for(let i=0;i<4;i++){
        const install=await connect(lab.name),registry=await connect(lab.name),
          relation=await connect(lab.name);
        const releases:Promise<unknown>[]=[];
        try{
          await install.query("BEGIN");
          await install.query(
            "SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03'),hashtext($1::text))",
            [lab.installationId]);
          await registry.query("BEGIN");
          await registry.query(
            "SELECT 1 FROM platform_schema_registry WHERE installation_id=$1 FOR UPDATE",
            [lab.installationId]);
          await relation.query("BEGIN");
          await relation.query("LOCK TABLE ONLY "+targetTable(lab)+" IN ACCESS SHARE MODE");
          const gates:Record<string,Client>={installation_advisory_wait:install,
            registry_row_lock:registry,target_access_exclusive_wait:relation};
          const released=new Set<string>();
          const sample=await supervisor(lab,{profile:"combined_tcp_30_three_locks",
            caseId:"C-MULTI-"+i,connectionPort:p.port,onStage:stage=>{
              const gate=gates[stage];
              if(gate&&!released.has(stage)){
                released.add(stage);
                releases.push(pause(250).then(()=>gate.query("ROLLBACK")));
              }
            }});
          await Promise.all(releases);
          expect(released.size).toBe(3);
          expect(sample.outcome).toBe("APPLIED");
          recordCombined(sample,{transport_one_way_ms:30,observed_real_lock_stages:3});
          await assertPhysical(lab,lab.plan.proposedManifest.digest);
          await resetForNext(lab);
        }finally{
          for(const db of [install,registry,relation]){
            await db.query("ROLLBACK").catch(()=>undefined);
            await db.end().catch(()=>undefined);
          }
        }
      }
    }finally{await p.close();}
  },150000);

  it("proves actual backend 57014 cancellation and physical ROLLBACK under 30ms transport + table contention",async()=>{
    const lab=labs[0]!;
    const checksum=await contentChecksum(lab);
    const p=await startDisposableTransportProxy({upstreamMs:30,downstreamMs:30});
    try{
      for(let i=0;i<5;i++){
        const blocker=await connect(lab.name);
        let cancelJob:Promise<void>|undefined;
        let cancelInitiated=0n,cancelAcknowledged=0n;
        let acknowledged=false;
        try{
          await blocker.query("BEGIN");
          await blocker.query("LOCK TABLE ONLY "+targetTable(lab)+" IN ACCESS SHARE MODE");
          let pid=0,backendStart="";
          const sample=await supervisor(lab,{profile:"combined_tcp_30_cancel_lock",
            caseId:"C-CAN-"+i,connectionPort:p.port,
            onConnected:async client=>{
              pid=(await client.query<{pid:number}>("SELECT pg_backend_pid() AS pid"))
                .rows[0]!.pid;
              const ident=await lab.dbAdmin.query<{start:string}>(
                "SELECT backend_start::text AS start FROM pg_stat_activity "+
                "WHERE pid=$1 AND usename=$2 AND datname=current_database()",
                [pid,lab.operatorRole]);
              expect(ident.rows).toHaveLength(1);
              backendStart=ident.rows[0]!.start;
            },
            onStage:stage=>{
              if(stage==="target_access_exclusive_wait"&&!cancelJob){
                cancelJob=(async()=>{
                  let observedLock=false;
                  for(let attempt=0;attempt<90;attempt++){
                    const current=await lab.dbAdmin.query<{wait_event_type:string|null;query:string|null}>(
                      "SELECT wait_event_type,query FROM pg_stat_activity WHERE pid=$1",
                      [pid]);
                    if(current.rows[0]?.wait_event_type==="Lock" &&
                      current.rows[0]?.query?.includes("LOCK TABLE")){
                      observedLock=true;break;
                    }
                    await pause(12);
                  }
                  expect(observedLock).toBe(true);
                  cancelInitiated=clock();
                  const signal=await lab.dbAdmin.query<{ok:boolean}>(
                    "SELECT pg_cancel_backend(pid) AS ok FROM pg_stat_activity "+
                    "WHERE pid=$1 AND usename=$2 AND datname=current_database() "+
                    "AND backend_start::text=$3",
                    [pid,lab.operatorRole,backendStart]);
                  cancelAcknowledged=clock();
                  acknowledged=signal.rows[0]?.ok===true;
                })();
              }
            }});
          await cancelJob;
          expect(acknowledged).toBe(true);
          await blocker.query("ROLLBACK");
          expect(sample.sql_state).toBe("57014");
          expect(sample.outcome).toBe("UNAUTHORIZED"); // old generic classification
          await noCompletedJournal(lab);
          expect(await contentChecksum(lab)).toBe(checksum);
          const fence=await lab.dbAdmin.query<{count:number}>(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid=$1",
            [pid]);
          expect(fence.rows[0]?.count).toBe(0);
          const recon=await independentlyReconcile(lab);
          expect(recon.state).toBe("ROLLED_BACK");
          recordCombined(sample,{control_signal_accepted:true,
            cancel_signal_elapsed_ms:Number(elapsed(cancelInitiated,cancelAcknowledged).toFixed(4)),
            original_backend_gone:true,physical_rollback_verified:true,
            fresh_reconcile_ms:recon.latency_ms});
        }finally{
          await blocker.query("ROLLBACK").catch(()=>undefined);
          await blocker.end().catch(()=>undefined);
        }
      }
    }finally{await p.close();}
  },120000);

  it("combines 30ms TCP byte-delay and real protocol-level lost COMMIT ACK",async()=>{
    const lab=labs[0]!;
    const checksum=await contentChecksum(lab);
    for(let i=0;i<4;i++){
      const dropped=await startCommitAckDropProxy();
      const delayed=await startDisposableTransportProxy({
        upstreamMs:30,downstreamMs:30,upstreamPort:dropped.port});
      try{
        const sample=await supervisor(lab,{profile:"combined_tcp_30_lost_ack",
          caseId:"C-LOSS-"+i,connectionPort:delayed.port});
        await Promise.race([dropped.serverCommitObserved,
          pause(6000).then(()=>{throw Error("COMMIT_WIRE_CONFIRM_NOT_SEEN")})]);
        expect(sample.outcome).toBe("INDETERMINATE");
        const recon=await independentlyReconcile(lab);
        expect(recon.state).toBe("COMMITTED");
        await assertPhysical(lab,lab.plan.proposedManifest.digest);
        expect(await contentChecksum(lab)).toBe(checksum);
        recordCombined(sample,{physical_server_commit_seen:true,
          ack_received_by_client:false,reconciled:"COMMITTED",
          fresh_reconcile_ms:recon.latency_ms});
        await resetForNext(lab);
      }finally{await delayed.close();await dropped.close();}
    }
  },120000);

  it("measures deliberate event-loop stall + physical 30ms TCP proxy + 200ms ACK delay",async()=>{
    const lab=labs[0]!;
    const p=await startDisposableTransportProxy({upstreamMs:30,downstreamMs:30,
      commitAckExtraMs:200});
    const lag=monitorEventLoopDelay({resolution:5});lag.enable();
    try{
      for(let i=0;i<5;i++){
        let stalled=false;
        const sample=await supervisor(lab,{profile:"combined_tcp30_ack200_eventloop25",
          caseId:"C-LAG-"+i,connectionPort:p.port,onStage:stage=>{
            if(stage==="commit_acknowledged_query"&&!stalled){
              stalled=true;busyStall(25);
            }
          }});
        expect(stalled).toBe(true);
        expect(sample.outcome).toBe("APPLIED");
        recordCombined(sample,{deliberate_scheduler_stall_ms:25});
        await assertPhysical(lab,lab.plan.proposedManifest.digest);
        await resetForNext(lab);
      }
    }finally{
      lag.disable();
      combinedMeta.event_loop_lag_p99_ms=Number((lag.percentile(99)/1e6).toFixed(4));
      combinedMeta.event_loop_lag_max_ms=Number((lag.max/1e6).toFixed(4));
      await p.close();
    }
  },120000);


  it("measures genuine THREE-way stress: 30ms TCP+500/900ms table lock+200ms COMMIT ACK",async()=>{
    const lab=labs[0]!;
    const p=await startDisposableTransportProxy({
      upstreamMs:30,downstreamMs:30,commitAckExtraMs:200});
    try{
      for(const waitMs of [500,900] as const){
        for(let i=0;i<4;i++){
          const blocker=await connect(lab.name);
          let release:Promise<void>|undefined;
          try{
            await blocker.query("BEGIN");
            await blocker.query("LOCK TABLE ONLY "+targetTable(lab)+" IN ACCESS SHARE MODE");
            const sample=await supervisor(lab,{profile:"combined_tcp30_ack200_lock_"+waitMs,
              caseId:"C-TRIPLE-"+waitMs+"-"+i,connectionPort:p.port,
              onStage:stage=>{
                if(stage==="target_access_exclusive_wait"&&!release){
                  release=pause(waitMs).then(()=>blocker.query("ROLLBACK")).then(()=>undefined);
                }
              }});
            await release;
            expect(sample.outcome).toBe("APPLIED"); // unguarded old source; D1 may fail
            recordCombined(sample,{three_way_stressor:true,
              transport_one_way_ms:30,commit_extra_ms:200,table_wait_ms:waitMs});
            await assertPhysical(lab,lab.plan.proposedManifest.digest);
            await resetForNext(lab);
          }finally{
            await blocker.query("ROLLBACK").catch(()=>undefined);
            await blocker.end().catch(()=>undefined);
          }
        }
      }
    }finally{await p.close();}
  },160000);

  it("measures real parallel PostgreSQL CPU workload under 30ms TCP+200ms ACK",async()=>{
    const lab=labs[0]!;
    const p=await startDisposableTransportProxy({
      upstreamMs:30,downstreamMs:30,commitAckExtraMs:200});
    const pressure=await connect(lab.name);
    try{
      for(let i=0;i<3;i++){
        const t=clock();
        // Real read-only PostgreSQL backend CPU pressure; no production writes.
        const competing=pressure.query("SELECT SUM(n::bigint) FROM generate_series(1,8000000) n");
        const sample=await supervisor(lab,{profile:"combined_tcp30_ack200_db_cpu",
          caseId:"C-DBCPU-"+i,connectionPort:p.port});
        await competing;
        expect(sample.outcome).toBe("APPLIED");
        recordCombined(sample,{real_parallel_pg_cpu:true,
          competing_query_elapsed_observation_ms:Number(elapsed(t,clock()).toFixed(4)),
          generated_rows:8000000});
        await assertPhysical(lab,lab.plan.proposedManifest.digest);
        await resetForNext(lab);
      }
    }finally{
      await pressure.end().catch(()=>undefined);
      await p.close();
    }
  },140000);

  it("withholds real COMMIT after D1 expiry in TEST-ONLY admission decorator; verifies physical rollback",async()=>{
    const lab=labs[0]!;
    const checksum=await contentChecksum(lab);
    for(let i=0;i<4;i++){
      let reachedPrecommit=false;
      let originalPid=0,originalBackendStart="";
      const sample=await supervisor(lab,{
        profile:"combined_test_only_d1_precommit_denial",
        caseId:"C-ADMIT-DENY-"+i,
        testDeadlineMs:COMBINED_D1_MS,preCommitReserveMs:300, // HYPOTHETICAL M
        onConnected:async client=>{
          originalPid=client.processID ?? 0;
          const original=await lab.dbAdmin.query<{started:string}>(
            "SELECT backend_start::text AS started FROM pg_stat_activity "+
            "WHERE pid=$1 AND usename=$2 AND datname=current_database()",
            [originalPid,lab.operatorRole]);
          expect(original.rows).toHaveLength(1);
          originalBackendStart=original.rows[0]!.started;
        },
        onStage:stage=>{
          if(stage==="commit_acknowledged_query"){
            reachedPrecommit=true;
            busyStall(2600); // test-only passage of D1 AFTER DDL/journal BEFORE COMMIT
          }
        },
      });
      expect(reachedPrecommit).toBe(true);
      expect(sample.outcome).toBe("INDETERMINATE");
      // The core sets commitAttempted BEFORE invoking its query adapter.
      // The test-only adapter refuses BEFORE sending SQL COMMIT, and the core
      // conservatively emits INDETERMINATE without explicit ROLLBACK. Only
      // proven original backend termination PLUS fresh physical verification
      // supports this TEST FIXTURE's final rolled-back classification.
      let originalGone=false;
      for(let n=0;n<60;n++){
        const current=await lab.dbAdmin.query<{n:number}>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1 "+
          "AND backend_start::text=$2",
          [originalPid,originalBackendStart]);
        if(current.rows[0]?.n===0){originalGone=true;break;}
        await pause(12);
      }
      expect(originalGone).toBe(true);
      await noCompletedJournal(lab);
      expect(await contentChecksum(lab)).toBe(checksum);
      const recon=await independentlyReconcile(lab);
      expect(recon.state).toBe("ROLLED_BACK");
      recordCombined(sample,{test_only_admission_guard:true,
        hypothetical_margin_ms:300,commit_dispatched:false,
        physical_rollback_verified:true,backend_gone_verified:true,
        cleaned_after_d1:sample.timeline_ms?.client_disposed_ms !== undefined &&
          sample.timeline_ms.client_disposed_ms>COMBINED_D1_MS,
        fresh_reconcile_ms:recon.latency_ms});
    }
  },30000);

  it("reproduces D1-PG06 physical COMMIT then delayed wrapper result; test-only classifier contains the breach",async()=>{
    const lab=labs[0]!;
    for(let i=0;i<2;i++){
      const started=clock();
      const client=await connect(lab.name,lab.operatorRole);
      client.on("error",()=>undefined);
      let sawRealAck=false,t13:number|null=null;
      try{
        const held=new Proxy(client,{
          get(target,key){
            if(key!=="query"){
              const value:unknown=Reflect.get(target,key,target);
              return typeof value==="function" ? value.bind(target):value;
            }
            return async (sql:string,args?:unknown[])=>{
              const result=args===undefined?await target.query(sql):await target.query(sql,args);
              if(sql==="COMMIT"){
                sawRealAck=true;
                t13=Number(elapsed(started,clock()).toFixed(4));
                await pause(2600); // TEST-ONLY delay AFTER physical PG COMMIT ACK
              }
              return result;
            };
          },
        }) as ClientBase;
        const original=await executeApprovedAdditiveColumn(held,{
          installationId:lab.installationId,planDigest:lab.plan.digest});
        const t14=Number(elapsed(started,clock()).toFixed(4));
        expect(original.status).toBe("APPLIED"); // reproducible UNGUARDED source defect
        expect(sawRealAck).toBe(true);
        expect(t13).not.toBeNull();
        expect(t14).toBeGreaterThan(COMBINED_D1_MS);
        const contained=classifyD1TestOnly(original.status,t13,t14,true);
        expect(contained).toEqual({classification:"COMMITTED_LATE",
          deadline_breached:true});
        const unknown=classifyD1TestOnly("INDETERMINATE",null,t14,false);
        expect(unknown.classification).toBe("INDETERMINATE");
        await assertPhysical(lab,lab.plan.proposedManifest.digest);
        const recon=await independentlyReconcile(lab);
        expect(recon.state).toBe("COMMITTED");
        d1Pg06Proof.push({case_id:"C-PG06-"+i,original_outcome:original.status,
          test_only_classification:contained.classification,
          definite_t13_ms:t13,t14_ms:t14,owner_d1_ms:COMBINED_D1_MS,
          physical_commit:true,reconciled:recon.state,
          source_defect_reproduced:true});
        await resetForNext(lab);
      }finally{await client.end().catch(()=>undefined);}
    }
  },15000);

  it("validates synthetic exact-margin admission equality semantics without claiming approved M",()=>{
    const TEST_ONLY_M=300; // HYPOTHETICAL; NOT derived/approved COMMIT margin
    for(const [remaining,allow] of [[TEST_ONLY_M-1,false],
      [TEST_ONLY_M,false],[TEST_ONLY_M+1,true],
      [-1,false],[0,false],[1,false]] as const){
      expect(combinedCandidateMarginGate(remaining,TEST_ONLY_M)).toBe(allow);
    }
    combinedMeta.synthetic_margin_boundary_only_ms=TEST_ONLY_M;
    combinedMeta.synthetic_margin_approved=false;
  });
});
