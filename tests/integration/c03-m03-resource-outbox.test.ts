// @vitest-environment node
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from "node:crypto";
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {Client,Pool} from "pg";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {asApplicationId,asInstallationId,asPrincipalId,asTenantId} from "@vibress/platform-kernel";
import {TenantUnitOfWork,verifyTenantScope,type ScopedTransaction} from "@vibress/tenancy";
import type {getDb} from "@vibress/database";
import {DrizzleOutboxRepository,OutboxDispatcherWorker,parseEventEnvelope,writeScopedOutboxEvent,type OutboxEventRow} from "@vibress/events";
import {openExperimentalVersionedResource,type VersionedResourceOutbox} from "../../packages/database/src/schema-operator-experimental-versioned-resource";
import * as schema from "../../packages/database/src/schema";
import {compileProvisioningTransition,compileResourceSchema,createSchemaManifest,provisioningProfileFor,type SchemaManifest} from "../../packages/schema-engine/src";
import {installExperimentalRevision,provisioningApprovalMessage,reserveExperimentalNamespace,type ProvisioningApproval} from "../../packages/database/src/schema-operator-experimental-installer";
import {DisposableDurableRecoveryAuthority} from "../../packages/database/src/schema-operator-experimental-durable-authority";
import {FileExperimentalRecoveryAnchor} from "../../packages/database/src/schema-operator-experimental-anchor";
import {recordExperimentalLifecycleTransition,type LifecycleState} from "../../packages/database/src/schema-operator-experimental-registry-lifecycle";
import {outboxQueue,outboxWorker,type OutboxRelayJobData} from "../../apps/worker/test-fixtures/m03-outbox-queue";

const requireFromDatabase=createRequire(path.resolve("packages/database/package.json"));
const {drizzle}=requireFromDatabase("drizzle-orm/node-postgres") as {drizzle:(pool:Pool,options:{schema:unknown})=>unknown};

const url=process.env.DATABASE_URL??"postgresql://vibress:vibress@127.0.0.1:5433/vibress";
const suffix=randomBytes(5).toString("hex");
const rolePasswords=new Map<string,string>();
let root:Client;
let f:Lab;
let queueAndEvents:{queue:ReturnType<typeof outboxQueue>["queue"];events:ReturnType<typeof outboxQueue>["events"]};
let consumer:ReturnType<typeof outboxWorker>|null=null;
const relayed:OutboxRelayJobData[]=[];
const failOnce=new Set<string>();
const credentials=generateKeyPairSync("ed25519"),adminKeys=generateKeyPairSync("ed25519"),epochKeys=generateKeyPairSync("ed25519");
const permissions=["resource.items.create","resource.items.update","resource.items.delete","resource.items.read"];

type Lab={name:string;scope:{applicationId:ReturnType<typeof asApplicationId>;installationId:ReturnType<typeof asInstallationId>};installer:string;runtime:string;namespace:string;oid:string;authority:DisposableDurableRecoveryAuthority;admin:Client;pool:Pool;dir:string};
function qi(name:string){return '"'+name.replace(/"/g,'""')+'"';}
function dbUrl(db:string,role?:string){const u=new URL(url);u.pathname="/"+db;if(role){u.username=role;u.password=rolePasswords.get(role)!;}return u.toString();}
async function connect(db:string,role?:string){const c=new Client({connectionString:dbUrl(db,role),connectionTimeoutMillis:4000});await c.connect();return c;}
async function createFixtureRole(role:string){const password=randomBytes(24).toString("hex");await root.query("CREATE ROLE "+qi(role)+" LOGIN PASSWORD "+root.escapeLiteral(password)+" NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");rolePasswords.set(role,password);}

async function lab():Promise<Lab>{
  const name="vibress_s03_norm_c03_"+suffix,installer="v3_inst_c03_"+suffix,runtime="v3_run_c03_"+suffix;
  const scope={applicationId:asApplicationId("reference-c03-outbox"),installationId:asInstallationId("installation-c03")};
  for(const role of [installer,runtime])await createFixtureRole(role);
  await root.query("CREATE DATABASE "+qi(name));
  await root.query("REVOKE ALL ON DATABASE "+qi(name)+" FROM PUBLIC");
  for(const role of [installer,runtime])await root.query("GRANT CONNECT ON DATABASE "+qi(name)+" TO "+qi(role));
  const admin=await connect(name),pool=new Pool({connectionString:dbUrl(name,runtime),max:4}),dir=mkdtempSync(path.join(tmpdir(),"m03-c03-outbox-"));
  const anchorDir=path.join(dir,"anchor");mkdirSync(anchorDir);
  const anchor=new FileExperimentalRecoveryAnchor(anchorDir,generateKeyPairSync("ed25519").privateKey);
  const authority=DisposableDurableRecoveryAuthority.initialize(dir,epochKeys.privateKey,scope.installationId,name,randomUUID(),anchor,adminKeys.publicKey);
  await admin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE TABLE public.platform_applications(id text PRIMARY KEY,name text NOT NULL); CREATE TABLE public.platform_installations(id text PRIMARY KEY,application_id text NOT NULL REFERENCES public.platform_applications(id),environment text NOT NULL)");
  await admin.query("INSERT INTO public.platform_applications VALUES($1,$2)",[scope.applicationId,"reference-c03-outbox"]);
  await admin.query("INSERT INTO public.platform_installations VALUES($1,$2,'test')",[scope.installationId,scope.applicationId]);
  await admin.query(readFileSync("packages/database/migrations/0059_platform_schema_execution_registry.sql","utf8"));
  await admin.query(readFileSync("tests/fixtures/m03-normative-registry-v1.sql","utf8"));
  const oid=(await admin.query<{oid:string}>("SELECT oid::text AS oid FROM pg_database WHERE datname=current_database()")).rows[0]!.oid;
  const namespace=await reserveExperimentalNamespace(admin,scope,{installer,runtime},credentials.publicKey,authority);
  return {name,scope,installer,runtime,namespace,oid,authority,admin,pool,dir};
}

function itemsManifest(l:Lab):SchemaManifest{
  return createSchemaManifest(compileResourceSchema([{...l.scope,id:"items",ownership:"tenant",fields:[
    {id:"code",type:"text",required:true},{id:"name",type:"text",required:true},
    {id:"version_token",type:"text",required:true},{id:"deleted_on",type:"datetime",required:false},
  ]}],l.scope));
}
function approval(l:Lab,next:SchemaManifest,overrides:Partial<ProvisioningApproval>={}){
  const plan=compileProvisioningTransition(null,next,l.scope),state=l.authority.authenticatedSnapshot();
  const e:ProvisioningApproval={version:1,profile:provisioningProfileFor(next),applicationId:l.scope.applicationId,installationId:l.scope.installationId,databaseName:l.name,databaseOid:l.oid,epoch:state.epoch,ledgerId:state.ledgerId,authorityHead:state.head,authoritySequence:state.sequence,parent:null,manifestDigest:next.digest,physicalDigest:plan.physical.digest,planDigest:plan.digest,operationId:randomUUID(),approvalId:randomUUID(),...overrides};
  const message=provisioningApprovalMessage(e);
  return {e,message,signature:sign(null,Buffer.from(message),credentials.privateKey).toString("base64url")};
}
const prepareLifecycle=async(l:Lab,m:SchemaManifest,a:ReturnType<typeof approval>)=>{
  const c=await connect(l.name);
  try{
    await c.query("BEGIN");
    try{
      let current:LifecycleState|null=null;
      for(const next of ["PROPOSED","VALIDATED","APPROVED"] as const){
        await recordExperimentalLifecycleTransition(c,{installationId:l.scope.installationId,revisionDigest:m.digest,expectedState:current,nextState:next,operationId:a.e.operationId,approvalId:a.e.approvalId,epoch:a.e.epoch,head:a.e.authorityHead,sequence:a.e.authoritySequence,actor:"fixture-operator"});
        current=next;
      }
      await c.query("COMMIT");
    }catch(error){await c.query("ROLLBACK").catch(()=>undefined);throw error;}
  }finally{await c.end();}
};
const apply=async(l:Lab,m:SchemaManifest,a:ReturnType<typeof approval>)=>{await prepareLifecycle(l,m,a);return installExperimentalRevision(dbUrl(l.name,l.installer),JSON.stringify(m),a.message,a.signature,l.authority);};
function scope(l:Lab,tenant:string){
  const tenantId=asTenantId(tenant),principalId=asPrincipalId("fixture-principal"),applicationId=l.scope.applicationId;
  return verifyTenantScope({applicationId,tenantId,principal:{id:principalId,kind:"staff",applicationId,tenantIds:[tenantId],roles:["staff"],permissions},membership:{applicationId,tenantId,principalId,active:true,roles:["staff"],permissions},authorization:{allowed:true,permissions,policyVersion:"fixture-c03-v1"}});
}
function stableId(eventType:string,recordId:string,versionToken:string,tenant="tenant-a",resourceId="items"){
  return createHash("sha256").update(JSON.stringify(["VIBRESS-M03-RESOURCE-EVENT-V1",f.scope.installationId,f.scope.applicationId,tenant,resourceId,recordId,eventType,versionToken])).digest("hex");
}
async function outboxRows(where="TRUE",params:unknown[]=[]){
  return (await f.admin.query<Omit<OutboxEventRow,"createdAt"|"updatedAt"|"availableAfter"|"publishedAt"> & {created_at:string;updated_at:string}>(`SELECT id,event_type,payload,status,attempts FROM public.outbox_events WHERE ${where} ORDER BY created_at,id`,params)).rows;
}
async function eventCount(){return (await f.admin.query<{n:number}>("SELECT count(*)::int AS n FROM public.outbox_events")).rows[0]!.n;}

let uow:TenantUnitOfWork;
let m:SchemaManifest;
let ta:ReturnType<typeof scope>;
let tb:ReturnType<typeof scope>;
const port=(tx:ScopedTransaction):VersionedResourceOutbox=>({emit:event=>writeScopedOutboxEvent(tx,event)});
const open=<T>(scopeArg:ReturnType<typeof scope>,action:(resource:Awaited<ReturnType<typeof openExperimentalVersionedResource>>)=>Promise<T>,sink?:VersionedResourceOutbox)=>uow.run(scopeArg,async tx=>action(await openExperimentalVersionedResource(tx,JSON.stringify(m),"items",f.authority,undefined,sink??port(tx))));
let dispatcherPool:Pool|null=null;
let dispatcherRef:{repository:DrizzleOutboxRepository;relay:{deliver(row:OutboxEventRow):Promise<void>}};

beforeAll(async()=>{
  const u=new URL(url);
  const ports=process.env.GITHUB_ACTIONS==="true"?["5433"]:["5433","5434"];
  if(!["localhost","127.0.0.1"].includes(u.hostname)||!ports.includes(u.port)||u.pathname!=="/vibress"||u.username!=="vibress"||u.password!=="vibress"||u.search)throw Error("disposable fixture only");
  root=await connect("vibress");
  const row=(await root.query<{version:number;superuser:boolean}>("SELECT current_setting('server_version_num')::int AS version,rolsuper AS superuser FROM pg_roles WHERE rolname=current_user")).rows[0]!;
  if(!row.superuser||row.version<160000||row.version>=170000)throw Error("disposable PG16 required");
  f=await lab();
  m=itemsManifest(f);
  await apply(f,m,approval(f,m));
  // The disposable CORE V1 profile permits the runtime only namespace-scoped
  // privileges, so the outbox grant is added after its ACL verification.
  const outboxMigration=readFileSync("packages/database/migrations/0015_dizzy_magdalene.sql","utf8");
  for(const statement of outboxMigration.split("--> statement-breakpoint"))if(statement.includes("outbox_events"))await f.admin.query(statement);
  await f.admin.query("CREATE TABLE public.m03_c03_receipts(event_id text PRIMARY KEY,tenant_id text NOT NULL,resource_id text NOT NULL,record_id text NOT NULL,version_token text NOT NULL,event_type text NOT NULL,deliveries int NOT NULL DEFAULT 1)");
  await f.admin.query("GRANT SELECT,INSERT,UPDATE,DELETE ON public.outbox_events,public.m03_c03_receipts TO "+qi(f.runtime));
  uow=new TenantUnitOfWork(f.pool);ta=scope(f,"tenant-a");tb=scope(f,"tenant-b");
  dispatcherPool=new Pool({connectionString:dbUrl(f.name),max:4});
  const db=drizzle(dispatcherPool,{schema}) as unknown as ReturnType<typeof getDb>;
  const repository=new DrizzleOutboxRepository(db);
  const queueName="m03-c03-outbox-"+suffix;
  queueAndEvents=outboxQueue(queueName);
  await queueAndEvents.events.waitUntilReady();
  consumer=outboxWorker(queueName,async job=>{
    const d=job.data;
    await f.admin.query("INSERT INTO public.m03_c03_receipts(event_id,tenant_id,resource_id,record_id,version_token,event_type) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id) DO NOTHING",[d.eventId,d.tenantId,d.resourceId,d.recordId,d.versionToken,d.eventType]);
    return {recorded:true};
  });
  await consumer.waitUntilReady();
  const relay={
    async deliver(row:OutboxEventRow){
      if(failOnce.delete(row.id))throw Error("relay unavailable");
      const envelope=parseEventEnvelope(row.payload);
      const payload=envelope.payload as {tenantId:string;applicationId:string;installationId:string;resourceId:string;recordId:string;versionToken:string};
      const data:OutboxRelayJobData={eventId:row.id,eventType:row.eventType,tenantId:payload.tenantId,applicationId:payload.applicationId,installationId:payload.installationId,resourceId:payload.resourceId,recordId:payload.recordId,versionToken:payload.versionToken,envelope:row.payload};
      relayed.push(data);
      await queueAndEvents.queue.add(row.eventType,data,{jobId:row.id});
    },
  };
  dispatcherRef={repository,relay};
},60000);

afterAll(async()=>{
  if(dispatcherPool)await dispatcherPool.end().catch(()=>undefined);
  if(consumer)await consumer.close().catch(()=>undefined);
  if(queueAndEvents){
    await queueAndEvents.queue.obliterate({force:true}).catch(()=>undefined);
    await queueAndEvents.events.close().catch(()=>undefined);
    await queueAndEvents.queue.close().catch(()=>undefined);
  }
  if(f){
    await f.authority.close?.();
    await f.pool.end();
    await f.admin.end();
  }
  if(root){
    if(f){await root.query("DROP DATABASE "+qi(f.name));await root.query("DROP ROLE "+qi(f.runtime));await root.query("DROP ROLE "+qi(f.installer));rmSync(f.dir,{recursive:true,force:true});}
    await root.end();
  }
},30000);

async function waitFor(check:()=>Promise<boolean>,label:string){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}
  throw Error("timeout waiting for "+label);
}
const receiptCount=(id:string)=>f.admin.query<{n:number}>("SELECT count(*)::int AS n FROM public.m03_c03_receipts WHERE event_id=$1",[id]).then(r=>r.rows[0]!.n);
const rowStatus=(id:string)=>f.admin.query<{status:string;attempts:number;available_after:Date|null}>("SELECT status,attempts,available_after FROM public.outbox_events WHERE id=$1",[id]).then(r=>r.rows[0]);

describe("C03 generated-resource transactional outbox",()=>{
  it("writes versioned events with stable scoped identities in the mutation transaction",async()=>{
    const a=await open(ta,resource=>resource.create("evt-1","First"));
    const [created]=await outboxRows("id=$1",[stableId("m03.resource.created",a.id,a.version_token)]);
    expect(created).toMatchObject({event_type:"m03.resource.created",status:"pending",attempts:0});
    expect(created!.payload).toEqual({version:1,eventType:"m03.resource.created",payload:{applicationId:f.scope.applicationId,installationId:f.scope.installationId,tenantId:"tenant-a",resourceId:"items",recordId:a.id,code:"evt-1",versionToken:a.version_token}});
    const updated=await open(ta,resource=>resource.update(a.id,a.version_token,"Renamed"));
    const [updateEvent]=await outboxRows("id=$1",[stableId("m03.resource.updated",a.id,updated!.version_token)]);
    expect(updateEvent).toMatchObject({event_type:"m03.resource.updated"});
    expect(updateEvent!.payload.payload).toMatchObject({recordId:a.id,code:"evt-1",versionToken:updated!.version_token});
    expect(updateEvent!.id).not.toBe(created!.id);
    expect(await open(ta,resource=>resource.update(a.id,a.version_token,"Stale"))).toBeNull();
    expect(await eventCount()).toBe(2);
    expect(await open(ta,resource=>resource.remove(a.id,updated!.version_token))).toBe(true);
    const tombstone=(await f.admin.query<{version_token:string}>("SELECT version_token FROM "+qi(f.namespace)+"."+qi(m.resources.find(r=>r.id==="items")!.tableName)+" WHERE tenant_id='tenant-a' AND id=$1",[a.id])).rows[0]!;
    const [deleted]=await outboxRows("id=$1",[stableId("m03.resource.deleted",a.id,tombstone.version_token)]);
    expect(deleted).toMatchObject({event_type:"m03.resource.deleted"});
    expect(deleted!.payload.payload).toMatchObject({recordId:a.id,versionToken:tombstone.version_token});
    expect(await eventCount()).toBe(3);
    console.info("M03_C03_ATOMIC_VERSIONED_EVENTS=PASS");
  },60000);

  it("rolls back mutation with event, refuses stale writes without events and deduplicates producer replay",async()=>{
    const before=await eventCount();
    await expect(open(ta,resource=>resource.create("atomic-1","No event"),{emit:async()=>{throw Error("outbox sink unavailable");}})).rejects.toThrow("outbox sink unavailable");
    const items=(tenant:string,code:string)=>f.admin.query<{n:number}>("SELECT count(*)::int AS n FROM "+qi(f.namespace)+"."+qi(m.resources.find(r=>r.id==="items")!.tableName)+" WHERE tenant_id=$1 AND code=$2",[tenant,code]).then(r=>r.rows[0]!.n);
    expect(await items("tenant-a","atomic-1")).toBe(0);
    expect(await eventCount()).toBe(before);
    const kept=await open(ta,resource=>resource.create("atomic-2","Kept"));
    const originalEvent=(await outboxRows("event_type='m03.resource.created' AND payload->'payload'->>'recordId'=$1",[kept.id]))[0]!;
    await uow.run(ta,tx=>writeScopedOutboxEvent(tx,{id:originalEvent.id,eventType:"m03.resource.created",payload:originalEvent.payload.payload as never}));
    expect(await eventCount()).toBe(before+1);
    await expect(open(ta,resource=>resource.create("atomic-2","Duplicate"))).rejects.toMatchObject({code:"23505"});
    expect(await open(tb,resource=>resource.update(kept.id,kept.version_token,"Wrong tenant"))).toBeNull();
    expect(await open(ta,resource=>resource.remove(kept.id,randomUUID()))).toBe(false);
    expect(await eventCount()).toBe(before+1);
    await expect(open(ta,resource=>resource.remove(kept.id,kept.version_token),{emit:async()=>{throw Error("outbox sink unavailable");}})).rejects.toThrow("outbox sink unavailable");
    const alive=(await f.admin.query<{live:boolean}>("SELECT deleted_on IS NULL AS live FROM "+qi(f.namespace)+"."+qi(m.resources.find(r=>r.id==="items")!.tableName)+" WHERE tenant_id='tenant-a' AND id=$1",[kept.id])).rows[0]!;
    expect(alive.live).toBe(true);
    expect(await eventCount()).toBe(before+1);
    console.info("M03_C03_ATOMICITY_REPLAY_DEDUP=PASS");
  },60000);

  it("actual dispatcher delivers to BullMQ at-least-once with retry, restart reclaim and consumer dedup",async()=>{
    const target=await open(ta,resource=>resource.create("delivery-1","Retry me"));
    const targetId=stableId("m03.resource.created",target.id,target.version_token);
    failOnce.add(targetId);
    const dispatcher=new OutboxDispatcherWorker(dispatcherRef.repository,dispatcherRef.relay,{staleClaimMs:1000});
    await dispatcher.runDispatchCycle();
    const failed=await rowStatus(targetId);
    expect(failed).toMatchObject({status:"pending",attempts:1});
    expect(failed!.available_after!.getTime()).toBeGreaterThan(Date.now());
    expect(await receiptCount(targetId)).toBe(0);
    await f.admin.query("UPDATE public.outbox_events SET available_after=now()-interval '1 second' WHERE id=$1",[targetId]);
    await dispatcher.runDispatchCycle();
    expect(await rowStatus(targetId)).toMatchObject({status:"published",attempts:1});
    await waitFor(async()=>await receiptCount(targetId)===1,"retried delivery receipt");
    const job=relayed.find(job=>job.eventId===targetId)!;
    expect(job).toMatchObject({eventType:"m03.resource.created",tenantId:"tenant-a",applicationId:f.scope.applicationId,installationId:f.scope.installationId,resourceId:"items",recordId:target.id,versionToken:target.version_token});
    expect(job.envelope).toMatchObject({version:1,eventType:"m03.resource.created"});
    const restart=await open(ta,resource=>resource.create("restart-1","Crash survivor"));
    const restartId=stableId("m03.resource.created",restart.id,restart.version_token);
    await f.admin.query("UPDATE public.outbox_events SET status='delivering',updated_at=now()-interval '2 minutes' WHERE id=$1",[restartId]);
    const restarted=new OutboxDispatcherWorker(dispatcherRef.repository,dispatcherRef.relay,{staleClaimMs:1000});
    await restarted.runDispatchCycle();
    expect(await rowStatus(restartId)).toMatchObject({status:"published"});
    await waitFor(async()=>await receiptCount(restartId)===1,"reclaimed delivery receipt");
    const data=relayed.find(job=>job.eventId===restartId)!;
    await queueAndEvents.queue.add(data.eventType,data,{jobId:restartId+"-replay"}).then(job=>job.waitUntilFinished(queueAndEvents.events,10000));
    await waitFor(async()=>await receiptCount(restartId)===1,"consumer dedup");
    expect(relayed.filter(job=>job.eventId===targetId)).toHaveLength(1);
    console.info("M03_C03_DISPATCHER_QUEUE_RETRY_RESTART_DEDUP=PASS");
  },60000);
});
