// @vitest-environment node
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from "node:crypto";
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fork,spawnSync,type ChildProcess} from "node:child_process";
import {build} from "esbuild";
import {referenceQueue} from "../../apps/worker/test-fixtures/m03-normative-queue";
import {referenceAction,referenceProducer,referenceOperationId,referenceJobMessage,type ReferenceWork,type ReferenceJob} from "../../apps/worker/test-fixtures/m03-normative-job-contract";
import {Client,Pool} from "pg";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {asApplicationId,asInstallationId,asPrincipalId,asTenantId} from "@vibress/platform-kernel";
import {TenantUnitOfWork,verifyTenantScope,PolicyEngine} from "@vibress/tenancy";
import {PlatformMembershipResolver} from "../../packages/database/src/platform-application-registry";
import {openExperimentalVersionedResource} from "../../packages/database/src/schema-operator-experimental-versioned-resource";
import {projectExperimentalResources} from "../../packages/database/src/schema-operator-experimental-introspection";
import {compileResourceSchema,createSchemaManifest,compileProvisioningContract,compileProvisioningTransition,compilePortableProvisioningIdentity,compileRenameIntent,provisioningConstraintName,provisioningIdentifier as qi,provisioningNamespace,provisioningProfileFor,PROVISIONING_PROFILE,PROVISIONING_PROFILE_V2,type FieldDefinition,type ResourceDefinition,type SchemaCompilationScope,type SchemaManifest} from "../../packages/schema-engine/src";
import {reserveExperimentalNamespace,installExperimentalRevision,verifyExperimentalProvisionedCatalog,provisioningApprovalMessage,collectExperimentalProvisioningCommit,collectExperimentalProvisioningCheckpoint,runExperimentalBackfillChunk,experimentalBackfillMessage,runExperimentalRename,experimentalRenameMessage,type ProvisioningApproval,type ExperimentalBackfillApproval,type ExperimentalRenameApproval} from "../../packages/database/src/schema-operator-experimental-installer";
import {experimentalBusinessMessage,collectExperimentalBusinessOutcome,type BusinessApproval} from "../../packages/database/src/schema-operator-experimental-business";
import {startStatementAckFaultProxy,startTransactionAckFaultProxy} from "../../scripts/platform/m03-s03-fault/pg-wire-proxy";
import {DisposableDurableRecoveryAuthority,recoveryAdministrationMessage} from "../../packages/database/src/schema-operator-experimental-durable-authority";
import {FileExperimentalRecoveryAnchor} from "../../packages/database/src/schema-operator-experimental-anchor";
import {recordExperimentalLifecycleTransition,reattestExperimentalLifecycleAfterRecovery,type LifecycleState} from "../../packages/database/src/schema-operator-experimental-registry-lifecycle";
import {settleExperimentalDomains} from "../../packages/database/src/schema-operator-experimental-settlement";
import {moduleNamespaceName,reserveExperimentalModuleNamespace,verifyExperimentalModuleNamespace} from "../../packages/database/src/schema-operator-experimental-module-namespace";
import {continueExperimentalOperation,inspectExperimentalOperations} from "../../packages/database/src/schema-operator-experimental-continuation";
import {createDefaultStudioDocument} from "../../packages/studio-core/src";
import {getFallbackChain} from "../../packages/i18n/src";
const url=process.env.DATABASE_URL??"postgresql://vibress:vibress@127.0.0.1:5433/vibress";
const suffix=randomBytes(5).toString("hex");
const rolePasswords=new Map<string,string>();
const rolePassword=(role:string)=>{const password=rolePasswords.get(role);if(!password)throw Error("unknown fixture role");return password;};
async function createFixtureRole(role:string){const password=randomBytes(24).toString("hex");await root.query("CREATE ROLE "+qi(role)+" LOGIN PASSWORD "+root.escapeLiteral(password)+" NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");rolePasswords.set(role,password);}
let root:Client;
const labs:Lab[]=[];
const credentials=generateKeyPairSync("ed25519"),adminKeys=generateKeyPairSync("ed25519"),epochKeys=generateKeyPairSync("ed25519");
function dbUrl(db:string,role?:string){const u=new URL(url);u.pathname="/"+db;if(role){u.username=role;u.password=rolePassword(role);}return u.toString();}
function wire(m:SchemaManifest){return JSON.stringify(m);}
async function connect(db:string,role?:string){const c=new Client({connectionString:dbUrl(db,role),connectionTimeoutMillis:4000});await c.connect();return c;}
type Lab={name:string;reader?:string;scope:SchemaCompilationScope;installer:string;runtime:string;namespace:string;oid:string;authority:DisposableDurableRecoveryAuthority;anchor:FileExperimentalRecoveryAnchor;admin:Client;pool:Pool;dir:string};
async function lab(tag:string,app:string):Promise<Lab>{
  const name="vibress_s03_norm_"+tag+"_"+suffix,installer="v3_inst_"+tag+"_"+suffix,runtime="v3_run_"+tag+"_"+suffix;
  const scope={applicationId:asApplicationId(app),installationId:asInstallationId("installation-"+tag)};
  for(const role of [installer,runtime])await createFixtureRole(role);
  await root.query("CREATE DATABASE "+qi(name));
  await root.query("REVOKE ALL ON DATABASE "+qi(name)+" FROM PUBLIC");
  for(const role of [installer,runtime])await root.query("GRANT CONNECT ON DATABASE "+qi(name)+" TO "+qi(role));
  const admin=await connect(name),pool=new Pool({connectionString:dbUrl(name,runtime),max:4}),dir=mkdtempSync(path.join(tmpdir(),"m03-normative-"));
  const anchorDir=path.join(dir,"anchor");mkdirSync(anchorDir);
  const anchor=new FileExperimentalRecoveryAnchor(anchorDir,generateKeyPairSync("ed25519").privateKey);
  const authority=DisposableDurableRecoveryAuthority.initialize(dir,epochKeys.privateKey,scope.installationId,name,randomUUID(),anchor,adminKeys.publicKey);
  const f:Lab={name,scope,installer,runtime,namespace:"",oid:"",admin,pool,dir,authority,anchor};labs.push(f);
  await admin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE TABLE public.platform_applications(id text PRIMARY KEY,name text NOT NULL); CREATE TABLE public.platform_installations(id text PRIMARY KEY,application_id text NOT NULL REFERENCES public.platform_applications(id),environment text NOT NULL)");
  await admin.query("INSERT INTO public.platform_applications VALUES($1,$2)",[scope.applicationId,app]);
  await admin.query("INSERT INTO public.platform_installations VALUES($1,$2,'test')",[scope.installationId,scope.applicationId]);
  await admin.query(readFileSync("packages/database/migrations/0059_platform_schema_execution_registry.sql","utf8"));
  await admin.query(readFileSync("tests/fixtures/m03-normative-registry-v1.sql","utf8"));
  f.oid=(await admin.query<{oid:string}>("SELECT oid::text AS oid FROM pg_database WHERE datname=current_database()")).rows[0]!.oid;
  f.namespace=await reserveExperimentalNamespace(admin,scope,{installer,runtime},credentials.publicKey,authority);
  return f;
}
function crm(f:Lab,extra?: "website"|"phone"|"notes"):SchemaManifest{
  const defs:ResourceDefinition[]=[
    {...f.scope,id:"customers",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"name",type:"text",required:true},...(extra?[{id:extra,type:"text" as const,required:false}]:[])]},
    {...f.scope,id:"deals",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"customer",type:"relation",required:true,targetResource:"customers"},{id:"stage",type:"enum",required:true,values:["open","won"]}]},
    {...f.scope,id:"activities",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"deal",type:"relation",required:false,targetResource:"deals"},{id:"done",type:"boolean",required:true}]},
  ];
  return createSchemaManifest(compileResourceSchema(defs,f.scope));
}
function renamedCrm(f:Lab,requiredTitle=false):SchemaManifest{
  const defs:ResourceDefinition[]=[
    {...f.scope,id:"customers",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"title",type:"text",required:requiredTitle}]},
    {...f.scope,id:"deals",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"customer",type:"relation",required:true,targetResource:"customers"},{id:"stage",type:"enum",required:true,values:["open","won"]}]},
    {...f.scope,id:"activities",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"deal",type:"relation",required:false,targetResource:"deals"},{id:"done",type:"boolean",required:true}]},
  ];
  return createSchemaManifest(compileResourceSchema(defs,f.scope));
}
function approval(f:Lab,before:SchemaManifest|null,next:SchemaManifest,overrides:Partial<ProvisioningApproval>={}){
  const plan=compileProvisioningTransition(before,next,f.scope),state=f.authority.authenticatedSnapshot();
  const e:ProvisioningApproval={version:1,profile:provisioningProfileFor(next),applicationId:f.scope.applicationId,installationId:f.scope.installationId,databaseName:f.name,databaseOid:f.oid,epoch:state.epoch,ledgerId:state.ledgerId,authorityHead:state.head,authoritySequence:state.sequence,parent:before?.digest??null,manifestDigest:next.digest,physicalDigest:plan.physical.digest,planDigest:plan.digest,operationId:randomUUID(),approvalId:randomUUID(),...overrides};
  const message=provisioningApprovalMessage(e);
  return {e,message,signature:sign(null,Buffer.from(message),credentials.privateKey).toString("base64url")};
}
const transition=(f:Lab,m:SchemaManifest,a:ReturnType<typeof approval>,expectedState:LifecycleState|null,nextState:LifecycleState,actor="fixture-operator",epoch=a.e.epoch)=>recordExperimentalLifecycleTransition(f.admin,{installationId:f.scope.installationId,revisionDigest:m.digest,expectedState,nextState,operationId:a.e.operationId,approvalId:a.e.approvalId,epoch,head:a.e.authorityHead,sequence:a.e.authoritySequence,actor});
const prepareLifecycle=async(f:Lab,m:SchemaManifest,a:ReturnType<typeof approval>)=>{
  // Concurrent apply() calls must not interleave BEGIN/COMMIT on the shared
  // fixture client, so preparation uses its own root session.
  const c=await connect(f.name);
  try{
    const row=(await c.query<{state:LifecycleState}>("SELECT state FROM public.platform_schema_revision_states_v1 WHERE installation_id=$1 AND revision_digest=$2",[f.scope.installationId,m.digest])).rows[0];
    if(row)return;
    await c.query("BEGIN");
    try{
      let current:LifecycleState|null=null;
      for(const next of ["PROPOSED","VALIDATED","APPROVED"] as const){
        await recordExperimentalLifecycleTransition(c,{installationId:f.scope.installationId,revisionDigest:m.digest,expectedState:current,nextState:next,operationId:a.e.operationId,approvalId:a.e.approvalId,epoch:a.e.epoch,head:a.e.authorityHead,sequence:a.e.authoritySequence,actor:"fixture-operator"});
        current=next;
      }
      await c.query("COMMIT");
    }catch(error){await c.query("ROLLBACK").catch(()=>undefined);throw error;}
  }finally{await c.end();}
};
const apply=async(f:Lab,m:SchemaManifest,a:ReturnType<typeof approval>)=>{await prepareLifecycle(f,m,a);return installExperimentalRevision(dbUrl(f.name,f.installer),wire(m),a.message,a.signature,f.authority);};
const check=(f:Lab,m:SchemaManifest)=>verifyExperimentalProvisionedCatalog(dbUrl(f.name,f.installer),wire(m),f.authority);
const table=(f:Lab,m:SchemaManifest,id:string)=>qi(f.namespace)+"."+qi(m.resources.find(x=>x.id===id)!.tableName);
function scope(f:Lab,tenant:string){
  const tenantId=asTenantId(tenant),principalId=asPrincipalId("fixture-principal"),applicationId=f.scope.applicationId;
  return verifyTenantScope({applicationId,tenantId,principal:{id:principalId,kind:"staff",applicationId,tenantIds:[tenantId],roles:["staff"],permissions:[]},membership:{applicationId,tenantId,principalId,active:true,roles:["staff"],permissions:[]},authorization:{allowed:true,permissions:[],policyVersion:"fixture-v1"}});
}
beforeAll(async()=>{
  const u=new URL(url);
  // CI remains restricted to the canonical 5433 topology. Local developer runs
  // may target the separately owned 16.16 container on 5434 with identical
  // synthetic credentials; no other host, database or search options pass.
  const ports=process.env.GITHUB_ACTIONS==="true"?["5433"]:["5433","5434"];
  if(!["localhost","127.0.0.1"].includes(u.hostname)||!ports.includes(u.port)||u.pathname!=="/vibress"||u.username!=="vibress"||u.password!=="vibress"||u.search)throw Error("disposable fixture only");
  root=await connect("vibress");
  const row=(await root.query<{version:number;superuser:boolean}>("SELECT current_setting('server_version_num')::int AS version,rolsuper AS superuser FROM pg_roles WHERE rolname=current_user")).rows[0]!;
  if(!row.superuser||row.version<160000||row.version>=170000)throw Error("disposable PG16 required");
  console.info("M03_NORMATIVE_PG="+row.version);
},30000);
afterAll(async()=>{
  if(!root)return;
  for(const f of labs.reverse()){
    f.authority.close();await f.pool.end();await f.admin.end();
    await root.query("DROP DATABASE "+qi(f.name));
    for(const role of [f.runtime,f.installer,...(f.reader?[f.reader]:[])])await root.query("DROP ROLE "+qi(role));
    rmSync(f.dir,{recursive:true,force:true});
  }
  await root.end();
},30000);
describe("M03 actual isolated normative infrastructure",()=>{
  it("J01/J02: signed compiler-generated CRM, exact catalog, real scoped relations and RLS",async()=>{
    const f=await lab("crm","reference-crm"),m=crm(f),approval1=approval(f,null,m);
    const plan=compileProvisioningTransition(null,m,f.scope);
    expect(plan.statements.filter(s=>s.startsWith("CREATE TABLE"))).toHaveLength(3);
    expect(plan.statements.filter(s=>s.includes("FOREIGN KEY"))).toHaveLength(2);
    expect(compileProvisioningContract(m,f.scope).digest).toBe(plan.physical.digest);
    await expect(apply(f,m,{...approval1,signature:sign(null,Buffer.from(approval1.message),generateKeyPairSync("ed25519").privateKey).toString("base64url")})).rejects.toThrow();
    await expect(apply(f,m,approval(f,null,m,{epoch:randomUUID()}))).rejects.toThrow();
    await expect(apply(f,m,approval(f,null,m,{applicationId:"other-app"}))).rejects.toThrow();
    const physical=(await f.admin.query<{system_identifier:string;timeline:number}>("SELECT system_identifier,timeline FROM public.platform_schema_installation_trust_v1")).rows[0]!;
    await f.admin.query("UPDATE public.platform_schema_installation_trust_v1 SET system_identifier='0'");
    try{await expect(apply(f,m,approval1)).rejects.toThrow("PHYSICAL_IDENTITY");}
    finally{await f.admin.query("UPDATE public.platform_schema_installation_trust_v1 SET system_identifier=$1",[physical.system_identifier]);}
    await f.admin.query("UPDATE public.platform_schema_installation_trust_v1 SET timeline=timeline+1");
    try{await expect(apply(f,m,approval1)).rejects.toThrow("PHYSICAL_IDENTITY");}
    finally{await f.admin.query("UPDATE public.platform_schema_installation_trust_v1 SET timeline=$1",[physical.timeline]);}
    expect((await f.admin.query("SELECT revision_digest FROM public.platform_schema_revisions_v1")).rows).toEqual([]);
    expect(await apply(f,m,approval1)).toMatchObject({status:"ACTIVE",revision:m.digest});
    expect(await check(f,m)).toBe(plan.physical.digest);
    await expect(apply(f,m,approval1)).rejects.toThrow();
    const c=table(f,m,"customers"),d=table(f,m,"deals"),a=table(f,m,"activities"),uow=new TenantUnitOfWork(f.pool);
    const ta=scope(f,"tenant-a"),tb=scope(f,"tenant-b"),aId=randomUUID(),bId=randomUUID(),dealId=randomUUID();
    await uow.run(ta,tx=>tx.query("INSERT INTO "+c+"(tenant_id,id,code,name) VALUES($1,$2,'same','Alice')",["tenant-a",aId]));
    await uow.run(tb,tx=>tx.query("INSERT INTO "+c+"(tenant_id,id,code,name) VALUES($1,$2,'same','Bob')",["tenant-b",bId]));
    expect((await uow.run(ta,tx=>tx.query("SELECT name FROM "+c))).rows).toEqual([{name:"Alice"}]);
    expect((await uow.run(tb,tx=>tx.query("SELECT name FROM "+c))).rows).toEqual([{name:"Bob"}]);
    await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+c+"(tenant_id,id,code,name) VALUES('tenant-b',$1,'bad','Cross')",[randomUUID()]))).rejects.toMatchObject({code:"42501"});
    await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+c+"(tenant_id,id,code,name) VALUES('tenant-a',$1,'same','Duplicate')",[randomUUID()]))).rejects.toMatchObject({code:"23505"});
    await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+d+"(tenant_id,id,code,customer,stage) VALUES('tenant-a',$1,'cross',$2,'open')",[randomUUID(),bId]))).rejects.toMatchObject({code:"23503"});
    await uow.run(ta,tx=>tx.query("INSERT INTO "+d+"(tenant_id,id,code,customer,stage) VALUES('tenant-a',$1,'deal',$2,'open')",[dealId,aId]));
    await uow.run(ta,tx=>tx.query("INSERT INTO "+a+"(tenant_id,id,code,deal,done) VALUES('tenant-a',$1,'activity',NULL,false)",[randomUUID()]));
    await expect(uow.run(ta,tx=>tx.query("UPDATE "+d+" SET stage='invalid'"))).rejects.toMatchObject({code:"23514"});
    await expect(uow.run(ta,tx=>tx.query("UPDATE "+d+" SET customer=$1",[bId]))).rejects.toMatchObject({code:"23503"});
    await expect(uow.run(ta,tx=>tx.query("DELETE FROM "+c+" WHERE id=$1",[aId]))).rejects.toMatchObject({code:"23503"});
    expect((await uow.run(ta,tx=>tx.query("UPDATE "+c+" SET name='attack' WHERE id=$1",[bId]))).rowCount).toBe(0);
    expect((await uow.run(ta,tx=>tx.query("DELETE FROM "+c+" WHERE id=$1",[bId]))).rowCount).toBe(0);
    await expect(uow.run(ta,tx=>tx.query("UPDATE "+c+" SET tenant_id='tenant-b' WHERE id=$1",[aId]))).rejects.toMatchObject({code:"42501"});
    expect((await f.pool.query("SELECT * FROM "+c)).rows).toEqual([]);
    const p=await f.pool.connect();try{await p.query("BEGIN");await p.query("SELECT set_config('vibress.tenant_id','!invalid',true)");expect((await p.query("SELECT * FROM "+c)).rows).toEqual([]);await p.query("ROLLBACK");}finally{p.release();}
    await expect(uow.run(ta,()=>uow.run(tb,async()=>1))).rejects.toThrow();
    await expect(uow.run(ta,async tx=>{await tx.query("UPDATE "+c+" SET name='undo'");throw Error("rollback");})).rejects.toThrow();
    const concurrent=await Promise.all([uow.run(ta,tx=>tx.query("SELECT name FROM "+c)),uow.run(tb,tx=>tx.query("SELECT name FROM "+c))]);expect(concurrent.map(x=>x.rows)).toEqual([[{name:"Alice"}],[{name:"Bob"}]]);
    for(const command of ["ALTER TABLE "+c+" ADD COLUMN forbidden text","DROP TABLE "+c,"TRUNCATE "+c,"CREATE TABLE "+qi(f.namespace)+".bad(id int)","SELECT * FROM public.platform_schema_registry","SELECT * FROM public.platform_schema_installation_trust_v1","SELECT * FROM public.platform_schema_revisions_v1"])await expect(f.pool.query(command)).rejects.toMatchObject({code:"42501"});
    expect((await f.pool.query("SELECT has_table_privilege(current_user,$1,'REFERENCES') AS allowed",[c])).rows).toEqual([{allowed:false}]);
    await f.admin.query("CREATE POLICY unexpected ON "+c+" USING(true) WITH CHECK(true)");
    try{
      expect((await uow.run(ta,tx=>tx.query("SELECT name FROM "+c))).rows).toEqual([{name:"Alice"}]);
      await expect(check(f,m)).rejects.toThrow();
    }finally{await f.admin.query("DROP POLICY unexpected ON "+c);}
    expect(await check(f,m)).toBe(plan.physical.digest);
    console.info("M03_J01_J02_CRM_RLS_RELATIONS=PASS");
  },60000);
  it("A02/J02: actual scoped leaf-resource version CAS, soft deletion and stable keyset pagination",async()=>{
    const f=await lab("versioned","reference-inventory-versioned");
    const m=createSchemaManifest(compileResourceSchema([{...f.scope,id:"items",ownership:"tenant",fields:[
      {id:"code",type:"text",required:true},{id:"name",type:"text",required:true},
      {id:"version_token",type:"text",required:true},{id:"deleted_on",type:"datetime",required:false}
    ]}],f.scope));
    await apply(f,m,approval(f,null,m));
    expect(await check(f,m)).toBe(compileProvisioningContract(m,f.scope).digest);
    const uow=new TenantUnitOfWork(f.pool),permissions=["resource.items.create","resource.items.update","resource.items.delete","resource.items.read"];
    const scoped=(tenant:string,grants:string[]=permissions)=>{
      const tenantId=asTenantId(tenant),principalId=asPrincipalId("fixture-principal"),applicationId=f.scope.applicationId;
      return verifyTenantScope({applicationId,tenantId,principal:{id:principalId,kind:"staff",applicationId,tenantIds:[tenantId],roles:["staff"],permissions:grants},membership:{applicationId,tenantId,principalId,active:true,roles:["staff"],permissions:grants},authorization:{allowed:true,permissions:grants,policyVersion:"fixture-versioned-v1"}});
    };
    const ta=scoped("tenant-a"),tb=scoped("tenant-b");
    const a=await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).create("stock-1","First"));
    const b=await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).create("stock-2","Second"));
    const c=await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).create("stock-3","Third"));
    const other=await uow.run(tb,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).create("stock-1","Other tenant"));
    await expect(uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).create("stock-1","Duplicate"))).rejects.toMatchObject({code:"23505"});
    const updates=await Promise.all(["Concurrent A","Concurrent B"].map(name=>uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).update(a.id,a.version_token,name))));
    expect(updates.filter(Boolean)).toHaveLength(1);
    const winner=updates.find(row=>row!==null)!;
    expect(winner.version_token).not.toBe(a.version_token);
    expect(await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).update(a.id,a.version_token,"Stale"))).toBeNull();
    expect(await uow.run(tb,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).update(a.id,winner.version_token,"Wrong tenant"))).toBeNull();
    expect(await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).remove(a.id,a.version_token))).toBe(false);
    const first=await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).list(2));
    expect(first.records.map(row=>row.id)).toEqual([a.id,b.id,c.id].sort().slice(0,2));
    expect(first.nextCursor).not.toBeNull();
    const second=await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).list(2,first.nextCursor));
    expect([...first.records,...second.records].map(row=>row.id)).toEqual([a.id,b.id,c.id].sort());
    expect(second.nextCursor).toBeNull();
    expect(first.nextCursor).toMatch(/^v1\./);
    // Cursors are bound to the manifest revision and the ordering they were issued for.
    const ordered=await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).list(1,null,null,"code"));
    expect(ordered.records.map(row=>row.code)).toEqual(["stock-1"]);
    expect((await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).list(1,ordered.nextCursor,null,"code"))).records.map(row=>row.code)).toEqual(["stock-2"]);
    const forged="v1."+Buffer.from(JSON.stringify(["f".repeat(64),"code",["stock-1",a.id]])).toString("base64url");
    await expect(uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).list(1,forged,null,"code"))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    await expect(uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).list(1,ordered.nextCursor,null,"id"))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    await expect(uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).list(1,a.id))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    expect((await uow.run(tb,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).list(100))).records.map(row=>row.id)).toEqual([other.id]);
    expect(await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).remove(a.id,winner.version_token))).toBe(true);
    expect(await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).update(a.id,winner.version_token,"Deleted"))).toBeNull();
    expect((await uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).list(10,null,"stock-1"))).records).toEqual([]);
    await expect(uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).create("stock-1","Cannot reuse tombstone"))).rejects.toMatchObject({code:"23505"});
    await expect(uow.run(ta,async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).list(101))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    await expect(uow.run(scoped("tenant-a",["resource.items.read"]),async tx=>(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)).create("stock-4","Not authorized"))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    const tombstone=(await f.admin.query<{deleted:boolean}>("SELECT deleted_on IS NOT NULL AS deleted FROM "+table(f,m,"items")+" WHERE tenant_id=$1 AND id=$2",["tenant-a",a.id])).rows;
    expect(tombstone).toEqual([{deleted:true}]);
    expect(await check(f,m)).toBe(compileProvisioningContract(m,f.scope).digest);
    console.info("M03_A02_VERSION_CAS_SOFT_DELETE_KEYSET=PASS");
  },60000);
  it("A02: general optional scalar fields persist with validation, partial update and tenant scoping",async()=>{
    const f=await lab("scalars","reference-inventory-scalars");
    const m=createSchemaManifest(compileResourceSchema([{...f.scope,id:"items",ownership:"tenant",fields:[
      {id:"code",type:"text",required:true},{id:"name",type:"text",required:true},
      {id:"version_token",type:"text",required:true},{id:"deleted_on",type:"datetime",required:false},
      {id:"active",type:"boolean",required:false},{id:"label",type:"text",required:false,maxLength:12},
      {id:"due_at",type:"datetime",required:false}
    ]}],f.scope));
    await apply(f,m,approval(f,null,m));
    const uow=new TenantUnitOfWork(f.pool),permissions=["resource.items.create","resource.items.update","resource.items.delete","resource.items.read"];
    const scoped=(tenant:string)=>{
      const tenantId=asTenantId(tenant),principalId=asPrincipalId("fixture-principal"),applicationId=f.scope.applicationId;
      return verifyTenantScope({applicationId,tenantId,principal:{id:principalId,kind:"staff",applicationId,tenantIds:[tenantId],roles:["staff"],permissions},membership:{applicationId,tenantId,principalId,active:true,roles:["staff"],permissions},authorization:{allowed:true,permissions,policyVersion:"fixture-scalars-v1"}});
    };
    const ta=scoped("tenant-a"),tb=scoped("tenant-b");
    type Resource=NonNullable<Awaited<ReturnType<typeof openExperimentalVersionedResource>>>;
    const open=<T>(scopeArg:ReturnType<typeof scoped>,action:(resource:Resource)=>Promise<T>)=>uow.run(scopeArg,async tx=>action(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)));
    const created=await open(ta,resource=>resource.create("item-1","First",{active:true,label:"Alpha",due_at:"2026-01-02T03:04:05.000Z"})) as {id:string;version_token:string;code:string;name:string;active:boolean;label:string;due_at:Date};
    expect(created).toMatchObject({code:"item-1",name:"First",active:true,label:"Alpha"});
    expect(created.due_at).toBeInstanceOf(Date);
    expect(created.due_at.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    const listed=(await open(ta,resource=>resource.list(10)) as {records:typeof created[]}).records;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({id:created.id,active:true,label:"Alpha"});
    // Unknown fields, wrong value types, over-long text and non-ISO dates are
    // refused before SQL; the declared maxLength CHECK still exists in PostgreSQL.
    for(const values of [{color:"red"},{active:"yes"},{label:"1234567890123"},{due_at:"tomorrow"},{label:"bad\u0000value"}]){
      await expect(open(ta,resource=>resource.create("item-2","Second",values))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    }
    // Partial update: omitted columns keep their values, provided null clears.
    const updated=await open(ta,resource=>resource.update(created.id,created.version_token,"First revised",{label:"Beta"})) as typeof created;
    expect(updated).toMatchObject({name:"First revised",label:"Beta",active:true});
    const cleared=await open(ta,resource=>resource.update(created.id,updated.version_token,"First revised",{label:null})) as typeof created;
    expect(cleared).toMatchObject({label:null,active:true});
    // Wrong tenant cannot see or mutate the row; stale versions are refused.
    expect((await open(tb,resource=>resource.list(10)) as {records:unknown[]}).records).toEqual([]);
    expect(await open(tb,resource=>resource.update(created.id,cleared.version_token,"Wrong tenant",{label:"Nope"}))).toBeNull();
    expect(await open(ta,resource=>resource.update(created.id,created.version_token,"Stale",{label:"Nope"}))).toBeNull();
    console.info("M03_A02_SCALAR_FIELDS=PASS");
  },60000);
  it("A02: required and optional relations persist with tenant-scoped foreign keys",async()=>{
    const f=await lab("relations","reference-relations");
    const m=createSchemaManifest(compileResourceSchema([
      {...f.scope,id:"customers",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"name",type:"text",required:true}]},
      {...f.scope,id:"items",ownership:"tenant",fields:[
        {id:"code",type:"text",required:true},{id:"name",type:"text",required:true},
        {id:"version_token",type:"text",required:true},{id:"deleted_on",type:"datetime",required:false},
        {id:"customer",type:"relation",required:true,targetResource:"customers"},
        {id:"sponsor",type:"relation",required:false,targetResource:"customers"}
      ]}
    ],f.scope));
    await apply(f,m,approval(f,null,m));
    const uow=new TenantUnitOfWork(f.pool),permissions=["resource.items.create","resource.items.update","resource.items.delete","resource.items.read"];
    const scoped=(tenant:string)=>{
      const tenantId=asTenantId(tenant),principalId=asPrincipalId("fixture-principal"),applicationId=f.scope.applicationId;
      return verifyTenantScope({applicationId,tenantId,principal:{id:principalId,kind:"staff",applicationId,tenantIds:[tenantId],roles:["staff"],permissions},membership:{applicationId,tenantId,principalId,active:true,roles:["staff"],permissions},authorization:{allowed:true,permissions,policyVersion:"fixture-relations-v1"}});
    };
    const ta=scoped("tenant-a"),tb=scoped("tenant-b");
    const customerA=randomUUID(),customerB=randomUUID(),customers=table(f,m,"customers");
    await uow.run(ta,tx=>tx.query("INSERT INTO "+customers+"(tenant_id,id,code,name) VALUES('tenant-a',$1,'cust-a','A')",[customerA]));
    await uow.run(tb,tx=>tx.query("INSERT INTO "+customers+"(tenant_id,id,code,name) VALUES('tenant-b',$1,'cust-b','B')",[customerB]));
    type Resource=NonNullable<Awaited<ReturnType<typeof openExperimentalVersionedResource>>>;
    const open=<T>(scopeArg:ReturnType<typeof scoped>,action:(resource:Resource)=>Promise<T>)=>uow.run(scopeArg,async tx=>action(await openExperimentalVersionedResource(tx,wire(m),"items",f.authority)));
    type Item={id:string;version_token:string;customer:string;sponsor:string|null};
    const a=await open(ta,resource=>resource.create("item-1","With sponsor",{customer:customerA,sponsor:customerA})) as Item;
    expect(a).toMatchObject({customer:customerA,sponsor:customerA});
    const b=await open(ta,resource=>resource.create("item-2","Optional omitted",{customer:customerA})) as Item;
    expect(b).toMatchObject({customer:customerA,sponsor:null});
    // A missing required relation, a malformed value and a cross-tenant target
    // are refused; the composite foreign key enforces the tenant boundary.
    await expect(open(ta,resource=>resource.create("item-3","Missing required"))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    await expect(open(ta,resource=>resource.create("item-3","Malformed",{customer:"not-a-uuid"}))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    await expect(open(ta,resource=>resource.create("item-3","Cross tenant",{customer:customerB}))).rejects.toMatchObject({code:"23503"});
    const cleared=await open(ta,resource=>resource.update(a.id,a.version_token,"Sponsor removed",{sponsor:null})) as Item;
    expect(cleared).toMatchObject({customer:customerA,sponsor:null});
    const repointed=await open(ta,resource=>resource.update(b.id,b.version_token,"Repointed",{sponsor:customerA})) as Item;
    expect(repointed).toMatchObject({customer:customerA,sponsor:customerA});
    await expect(open(ta,resource=>resource.update(b.id,repointed.version_token,"Clear required",{customer:null}))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    await expect(open(ta,resource=>resource.update(b.id,repointed.version_token,"Cross tenant",{customer:customerB}))).rejects.toMatchObject({code:"23503"});
    expect((await open(tb,resource=>resource.list(10)) as {records:unknown[]}).records).toEqual([]);
    expect(await open(tb,resource=>resource.update(a.id,cleared.version_token,"Wrong tenant",{sponsor:null}))).toBeNull();
    console.info("M03_A02_RELATIONS=PASS");
  },60000);
  it("A02: declared scoped uniques, compound index ordering and query-bound cursors",async()=>{
    const f=await lab("declared","reference-declared-constraints");
    const m=createSchemaManifest(compileResourceSchema([{...f.scope,id:"catalog",ownership:"tenant",
      uniques:[["category","slug"]],
      indexes:[["category","priority"]],
      fields:[
        {id:"code",type:"text",required:true},{id:"name",type:"text",required:true},
        {id:"version_token",type:"text",required:true},{id:"deleted_on",type:"datetime",required:false},
        {id:"category",type:"text",required:false},{id:"slug",type:"text",required:false},
        {id:"priority",type:"integer",required:false}
      ]}],f.scope));
    expect(provisioningProfileFor(m)).toBe(PROVISIONING_PROFILE_V2);
    await apply(f,m,approval(f,null,m));
    expect(await check(f,m)).toBe(compileProvisioningContract(m,f.scope).digest);
    const catalogTable=table(f,m,"catalog");
    const uniqueName=provisioningConstraintName(m.resources[0]!.tableName,"uq","tenant_id_category_slug");
    const indexPath=provisioningConstraintName(m.resources[0]!.tableName,"ix","tenant_id_category_priority");
    expect((await f.admin.query<{n:number}>("SELECT (SELECT count(*) FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2)::int AS n",[catalogTable,uniqueName])).rows).toEqual([{n:1}]);
    expect((await f.admin.query<{n:number}>("SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname=$1 AND indexname=$2",[f.namespace,indexPath])).rows).toEqual([{n:1}]);
    const uow=new TenantUnitOfWork(f.pool),permissions=["resource.catalog.create","resource.catalog.update","resource.catalog.delete","resource.catalog.read"];
    const scoped=(tenant:string)=>{
      const tenantId=asTenantId(tenant),principalId=asPrincipalId("fixture-principal"),applicationId=f.scope.applicationId;
      return verifyTenantScope({applicationId,tenantId,principal:{id:principalId,kind:"staff",applicationId,tenantIds:[tenantId],roles:["staff"],permissions},membership:{applicationId,tenantId,principalId,active:true,roles:["staff"],permissions},authorization:{allowed:true,permissions,policyVersion:"fixture-declared-v1"}});
    };
    const ta=scoped("tenant-a"),tb=scoped("tenant-b");
    type Item={id:string;code:string;version_token:string;category:string|null;slug:string|null;priority:number|null};
    type Resource=NonNullable<Awaited<ReturnType<typeof openExperimentalVersionedResource>>>;
    const open=<T>(scopeArg:ReturnType<typeof scoped>,action:(resource:Resource)=>Promise<T>)=>uow.run(scopeArg,async tx=>action(await openExperimentalVersionedResource(tx,wire(m),"catalog",f.authority)));
    const one=await open(ta,resource=>resource.create("cat-1","One",{category:"a",slug:"s1",priority:2})) as Item;
    const two=await open(ta,resource=>resource.create("cat-2","Two",{category:"a",slug:"s2"})) as Item;
    const three=await open(ta,resource=>resource.create("cat-3","Three",{category:"a",slug:"s3",priority:1})) as Item;
    const four=await open(ta,resource=>resource.create("cat-4","Four",{category:"b",slug:"s1",priority:5})) as Item;
    const five=await open(ta,resource=>resource.create("cat-5","Five",{category:"b",slug:"s2",priority:1})) as Item;
    expect(two.priority).toBeNull();
    expect(five.priority).toBe(1);
    // The declared scoped unique is enforced by PostgreSQL itself.
    await expect(open(ta,resource=>resource.create("cat-6","Duplicate",{category:"a",slug:"s1"}))).rejects.toMatchObject({code:"23505"});
    await expect(open(tb,resource=>resource.create("cat-6","Other tenant",{category:"a",slug:"s1"}))).resolves.toMatchObject({code:"cat-6"});
    // Compound ordering follows the declared index signature, NULLs last, id tiebreaker.
    const expected=["cat-3","cat-1","cat-2","cat-5","cat-4"];
    const seen:string[]=[];
    let cursor:string|null=null,firstCursor:string|null=null,pages=0;
    do{
      const page=await open(ta,resource=>resource.list(2,cursor,null,["category","priority"]));
      if(firstCursor===null)firstCursor=page.nextCursor;
      seen.push(...page.records.map(row=>row.code));cursor=page.nextCursor;pages++;
    }while(cursor!==null&&pages<10);
    expect(seen).toEqual(expected);
    expect(firstCursor).toMatch(/^v2\./);
    // Equality filters cover declared scalars and bind the cursor to the filter.
    const filtered=await open(ta,resource=>resource.list(10,null,null,["category","priority"],{category:"a"}));
    expect(filtered.records.map(row=>row.code)).toEqual(["cat-3","cat-1","cat-2"]);
    expect(filtered.records.map(row=>row.id)).toEqual([three.id,one.id,two.id]);
    expect(filtered.nextCursor).toBeNull();
    await expect(open(ta,resource=>resource.list(2,firstCursor,null,["category","priority"],{category:"a"}))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    await expect(open(ta,resource=>resource.list(2,firstCursor,null,["category","slug"]))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    // Undeclared order signatures, unknown/mistyped/null filters are refused.
    await expect(open(ta,resource=>resource.list(10,null,null,["category"]))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    await expect(open(ta,resource=>resource.list(10,null,null,["slug","category"]))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    await expect(open(ta,resource=>resource.list(10,null,null,"id",{missing:"x"}))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    await expect(open(ta,resource=>resource.list(10,null,null,"id",{priority:"high"}))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    await expect(open(ta,resource=>resource.list(10,null,null,"id",{category:null}))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    // A v2 cursor tampered to carry another filter is refused.
    const tampered="v2."+Buffer.from(JSON.stringify([...JSON.parse(Buffer.from(firstCursor!.slice(3),"base64url").toString("utf8")).slice(0,2),[],["x"]])).toString("base64url");
    await expect(open(ta,resource=>resource.list(2,tampered,null,["category","priority"]))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    // Scalar orders still page with the original v1 cursor binding.
    const byId=await open(ta,resource=>resource.list(2));
    expect(byId.nextCursor).toMatch(/^v1\./);
    expect((await open(ta,resource=>resource.list(10,byId.nextCursor))).records).toHaveLength(3);
    // Filters also apply to scalar orders and exclude soft-deleted rows.
    await expect(open(ta,resource=>resource.remove(four.id,four.version_token))).resolves.toBe(true);
    const tenantBOnly=await open(tb,resource=>resource.list(10,null,null,"id",{category:"a"}));
    expect(tenantBOnly.records.map(row=>row.code)).toEqual(["cat-6"]);
    // Concurrent writers cannot both claim the declared scoped tuple.
    const raced=await Promise.allSettled([
      open(ta,resource=>resource.create("race-1","Race one",{category:"c",slug:"same"})),
      open(ta,resource=>resource.create("race-2","Race two",{category:"c",slug:"same"})),
    ]);
    expect(raced.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(raced.find(result=>result.status==="rejected")).toMatchObject({status:"rejected",reason:{code:"23505"}});
    expect(await check(f,m)).toBe(compileProvisioningContract(m,f.scope).digest);
    console.info("M03_A02_DECLARED_UNIQUES_INDEX_PAGINATION=PASS");
  },60000);
  it("A02: relation-aware writes and explicit parent/child soft deletion",async()=>{
    const f=await lab("hierarchy","reference-parent-child");
    const m=createSchemaManifest(compileResourceSchema([
      {...f.scope,id:"parents",ownership:"tenant",fields:[
        {id:"code",type:"text",required:true},{id:"name",type:"text",required:true},
        {id:"version_token",type:"text",required:true},{id:"deleted_on",type:"datetime",required:false}
      ]},
      {...f.scope,id:"children",ownership:"tenant",fields:[
        {id:"code",type:"text",required:true},{id:"name",type:"text",required:true},
        {id:"version_token",type:"text",required:true},{id:"deleted_on",type:"datetime",required:false},
        {id:"parent",type:"relation",required:false,targetResource:"parents"}
      ]}
    ],f.scope));
    await apply(f,m,approval(f,null,m));
    const uow=new TenantUnitOfWork(f.pool),permissions=["resource.parents.create","resource.parents.update","resource.parents.delete","resource.parents.read","resource.children.create","resource.children.update","resource.children.delete","resource.children.read"];
    const scoped=(tenant:string)=>{
      const tenantId=asTenantId(tenant),principalId=asPrincipalId("fixture-principal"),applicationId=f.scope.applicationId;
      return verifyTenantScope({applicationId,tenantId,principal:{id:principalId,kind:"staff",applicationId,tenantIds:[tenantId],roles:["staff"],permissions},membership:{applicationId,tenantId,principalId,active:true,roles:["staff"],permissions},authorization:{allowed:true,permissions,policyVersion:"fixture-hierarchy-v1"}});
    };
    const ta=scoped("tenant-a"),tb=scoped("tenant-b");
    type Resource=NonNullable<Awaited<ReturnType<typeof openExperimentalVersionedResource>>>;
    type Node={id:string;code:string;version_token:string;parent?:string|null};
    const openParents=<T>(scopeArg:ReturnType<typeof scoped>,action:(resource:Resource)=>Promise<T>)=>uow.run(scopeArg,async tx=>action(await openExperimentalVersionedResource(tx,wire(m),"parents",f.authority)));
    const openChildren=<T>(scopeArg:ReturnType<typeof scoped>,action:(resource:Resource)=>Promise<T>)=>uow.run(scopeArg,async tx=>action(await openExperimentalVersionedResource(tx,wire(m),"children",f.authority)));
    const p1=await openParents(ta,resource=>resource.create("parent-1","Parent one")) as Node;
    const p2=await openParents(ta,resource=>resource.create("parent-2","Parent two")) as Node;
    const c1=await openChildren(ta,resource=>resource.create("child-1","Child one",{parent:p1.id})) as Node;
    expect(c1.parent).toBe(p1.id);
    // Stale-version removal keeps CAS semantics; the live child blocks the commit.
    expect(await openParents(ta,resource=>resource.remove(p1.id,"00000000-0000-4000-8000-000000000000"))).toBe(false);
    await expect(openParents(ta,resource=>resource.remove(p1.id,p1.version_token))).rejects.toThrow("M03_VERSIONED_RESOURCE_CHILDREN");
    expect((await openParents(ta,resource=>resource.list(10))).records.map(row=>row.code)).toEqual(["parent-1","parent-2"]);
    const parentRow=(await f.admin.query<{deleted:boolean}>("SELECT deleted_on IS NOT NULL AS deleted FROM "+table(f,m,"parents")+" WHERE id=$1",[p1.id])).rows;
    expect(parentRow).toEqual([{deleted:false}]);
    // Removing the child allows the parent removal; the child's FK row remains.
    expect(await openChildren(ta,resource=>resource.remove(c1.id,c1.version_token))).toBe(true);
    expect(await openParents(ta,resource=>resource.remove(p1.id,p1.version_token))).toBe(true);
    // The FK would still accept a tombstoned parent; the adapter refuses it.
    await expect(openChildren(ta,resource=>resource.create("child-2","Tombstoned parent",{parent:p1.id}))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    expect((await f.admin.query<{deleted:boolean}>("SELECT deleted_on IS NOT NULL AS deleted FROM "+table(f,m,"parents")+" WHERE id=$1",[p1.id])).rows).toEqual([{deleted:true}]);
    // Updates re-verify the relation target and keep untouched columns intact.
    const c3=await openChildren(ta,resource=>resource.create("child-3","Child three",{parent:p2.id})) as Node;
    await expect(openChildren(ta,resource=>resource.update(c3.id,c3.version_token,"Retarget",{parent:p1.id}))).rejects.toThrow("M03_VERSIONED_RESOURCE_REFUSED");
    const renamed=await openChildren(ta,resource=>resource.update(c3.id,c3.version_token,"Renamed")) as Node;
    expect(renamed).toMatchObject({name:"Renamed",parent:p2.id});
    // Other tenants never observe or mutate the hierarchy.
    expect((await openParents(tb,resource=>resource.list(10))).records).toEqual([]);
    expect(await openParents(tb,resource=>resource.remove(p2.id,p2.version_token))).toBe(false);
    expect(await openChildren(ta,resource=>resource.remove(c3.id,renamed.version_token))).toBe(true);
    expect(await openParents(ta,resource=>resource.remove(p2.id,p2.version_token))).toBe(true);
    expect(await check(f,m)).toBe(compileProvisioningContract(m,f.scope).digest);
    console.info("M03_A02_RELATION_AWARE_PARENT_CHILD_SOFT_DELETE=PASS");
  },60000);
  it("A01: typed leaf resources enforce money and bounded JSON on create, partial update, CAS and signed backfill",async()=>{
    const f=await lab("a01","reference-typed-guards");
    const m=createSchemaManifest(compileResourceSchema([
      {...f.scope,id:"customers",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"name",type:"text",required:true}]},
      {...f.scope,id:"deals",ownership:"tenant",fields:[
        {id:"code",type:"text",required:true},{id:"name",type:"text",required:true},
        {id:"version_token",type:"text",required:true},{id:"deleted_on",type:"datetime",required:false},
        {id:"quantity",type:"integer",required:false},
        {id:"due_on",type:"date",required:false},
        {id:"ratio",type:"decimal",required:false,precision:6,scale:2},
        {id:"value",type:"money",required:false,precision:12,scale:2},
        {id:"metadata",type:"json",required:false,maxBytes:512,maxDepth:3,maxKeys:12},
        {id:"attachment",type:"media",required:false,maxBytes:512,maxDepth:3,maxKeys:12},
        {id:"headline",type:"localized",required:false,maxBytes:512,maxDepth:3,maxKeys:12},
        {id:"body",type:"studio",required:false,maxBytes:8192,maxDepth:32,maxKeys:1000},
        {id:"stage",type:"enum",required:false,values:["draft","live"]},
        {id:"customer",type:"relation",required:false,targetResource:"customers"}
      ]}
    ],f.scope));
    await apply(f,m,approval(f,null,m));
    const uow=new TenantUnitOfWork(f.pool),permissions=["resource.deals.create","resource.deals.update","resource.deals.delete","resource.deals.read"];
    const scoped=(tenant:string)=>{
      const tenantId=asTenantId(tenant),principalId=asPrincipalId("fixture-principal"),applicationId=f.scope.applicationId;
      return verifyTenantScope({applicationId,tenantId,principal:{id:principalId,kind:"staff",applicationId,tenantIds:[tenantId],roles:["staff"],permissions},membership:{applicationId,tenantId,principalId,active:true,roles:["staff"],permissions},authorization:{allowed:true,permissions,policyVersion:"fixture-a01-v1"}});
    };
    const ta=scoped("tenant-a"),tb=scoped("tenant-b");
    type Deal={id:string;version_token:string;code:string;name:string;quantity:number|null;due_on:Date|null;ratio:string|null;value:{amount:string|null;currency:string|null};metadata:unknown;attachment:unknown;headline:unknown;body:unknown;stage:string|null;customer:string|null};
    type Resource=NonNullable<Awaited<ReturnType<typeof openExperimentalVersionedResource>>>;
    // Media references carry a publication-scoped asset identity. The fixture
    // persists assets in real PostgreSQL and the host resolves every written id
    // through its own publication-scoped lookup (never the resource role).
    await f.admin.query("CREATE TABLE public.fixture_media_assets(id text PRIMARY KEY, publication_id text NOT NULL)");
    await f.admin.query("INSERT INTO public.fixture_media_assets VALUES('med_cover_a','pub-a'),('med_cover_b','pub-b')");
    const media={publicationId:"pub-a",findById:async(id:string,publicationId?:string)=>publicationId?((await f.admin.query<{id:string}>("SELECT id FROM public.fixture_media_assets WHERE id=$1 AND publication_id=$2",[id,publicationId])).rows[0]??null):null};
    const studio=createDefaultStudioDocument("Hello studio");
    const open=<T>(scopeArg:ReturnType<typeof scoped>,action:(resource:Resource)=>Promise<T>)=>uow.run(scopeArg,async tx=>action(await openExperimentalVersionedResource(tx,wire(m),"deals",f.authority,media)));
    const customerId=randomUUID();
    await uow.run(ta,tx=>tx.query("INSERT INTO "+table(f,m,"customers")+"(tenant_id,id,code,name) VALUES('tenant-a',$1,'cust','C')",[customerId]));
    const created=await open(ta,resource=>resource.create("deal-1","First",{
      quantity:7,due_on:"2026-05-06",ratio:"12.34",
      value:{amount:"19.99",currency:"USD"},
      metadata:{a:[1,true]},
      attachment:{id:"med_cover_a",alt:"a"},
      headline:{en:"Hi",ar:"مرحبا"},
      body:studio,
      stage:"live",customer:customerId,
    })) as Deal;
    expect(created).toMatchObject({code:"deal-1",name:"First",quantity:7,ratio:"12.34",value:{amount:"19.99",currency:"USD"},metadata:{a:[1,true]},attachment:{id:"med_cover_a",alt:"a"},headline:{en:"Hi",ar:"مرحبا"},stage:"live",customer:customerId});
    expect(created.body).toMatchObject({schema:"vibress-studio",version:1});
    // Localized values resolve through the existing i18n fallback chain.
    const chain=getFallbackChain("ar-EG"),localized=created.headline as Record<string,string>;
    expect(chain).toEqual(["ar-EG","ar","en"]);
    expect(chain.map(locale=>localized[locale]).find(text=>text!==undefined)).toBe("مرحبا");
    expect(created).not.toHaveProperty("value_currency");
    const due=created.due_on!;
    expect([due.getFullYear(),due.getMonth()+1,due.getDate()]).toEqual([2026,5,6]);
    // Application-level refusals happen before SQL; PostgreSQL still owns the
    // numeric type, the jsonb byte bound and the currency syntax CHECK.
    for(const [values,code] of [
      [{quantity:1.5},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{quantity:2**31},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{due_on:"2026-02-31"},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{ratio:"1.234"},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{ratio:"12345.6"},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{value:{amount:"10.00"}},"MONEY_REFUSED:PAIR"],
      [{value:{amount:"10.00",currency:"AAA"}},"MONEY_REFUSED:CURRENCY"],
      [{value:{amount:"10.001",currency:"USD"}},"MONEY_REFUSED:SCALE"],
      [{value:{amount:"10.00",currency:"USD",extra:1}},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{metadata:{a:{b:{c:{d:1}}}}},"JSON_BOUND_REFUSED:DEPTH"],
      [{metadata:{a:undefined}},"JSON_BOUND_REFUSED:VALUE"],
      [{attachment:{alt:"no url"}},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{attachment:{id:"med_cover_b"}},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{attachment:{id:"https://cdn.test/a.png"}},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{headline:"plain text"},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{headline:{"EN":"Hi"}},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{headline:{en:7}},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{body:{schema:"other-format",version:1,root:{type:"root",children:[]}}},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{body:{...studio,version:2}},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{body:{schema:"vibress-studio",version:1,root:{type:"root",children:[{type:"text",text:"misplaced"}]}}},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{stage:"archived"},"M03_VERSIONED_RESOURCE_REFUSED"],
      [{color:"red"},"M03_VERSIONED_RESOURCE_REFUSED"],
    ] as const){
      await expect(open(ta,resource=>resource.create("deal-bad","Bad",values))).rejects.toThrow(code);
    }
    const deals=table(f,m,"deals");
    // Partial update keeps omitted money/json values and clears on explicit null.
    const updated=await open(ta,resource=>resource.update(created.id,created.version_token,"First revised",{value:{amount:"20.5",currency:"EUR"},metadata:null})) as Deal;
    expect(updated).toMatchObject({name:"First revised",quantity:7,ratio:"12.34",value:{amount:"20.50",currency:"EUR"},metadata:null,attachment:{id:"med_cover_a",alt:"a"},headline:{en:"Hi",ar:"مرحبا"}});
    expect(updated.body).toMatchObject({schema:"vibress-studio",version:1});
    const revisedStudio=await open(ta,resource=>resource.update(created.id,updated.version_token,"Studio revised",{body:createDefaultStudioDocument("Revised body")})) as Deal;
    expect(revisedStudio.body).toEqual(createDefaultStudioDocument("Revised body"));
    const cleared=await open(ta,resource=>resource.update(created.id,revisedStudio.version_token,"First revised",{value:null})) as Deal;
    expect(cleared).toMatchObject({value:{amount:null,currency:null},metadata:null});
    // Version-checked mutation and tenant isolation still hold.
    expect(await open(ta,resource=>resource.update(created.id,created.version_token,"Stale",{value:{amount:"1.00",currency:"USD"}}))).toBeNull();
    expect(await open(tb,resource=>resource.update(created.id,cleared.version_token,"Cross tenant",{value:null}))).toBeNull();
    expect((await open(tb,resource=>resource.list(10)) as {records:unknown[]}).records).toEqual([]);
    // The database enforces the three-letter currency shape and jsonb bytes but
    // has no predicate for ISO membership or JSON depth/keys.
    await expect(f.admin.query("INSERT INTO "+deals+"(tenant_id,id,code,name,version_token,value,value_currency) VALUES('tenant-b',$1,'db-lower','DB',$2,'1.00','usd')",[randomUUID(),randomUUID()])).rejects.toMatchObject({code:"23514"});
    await f.admin.query("INSERT INTO "+deals+"(tenant_id,id,code,name,version_token,metadata,headline,body) VALUES('tenant-b',$1,'db-deep','DB',$2,$3::jsonb,$4::jsonb,$5::jsonb)",[randomUUID(),randomUUID(),JSON.stringify({a:{b:{c:{d:1}}}}),JSON.stringify({en:"Deep"}),JSON.stringify(studio)]);
    // PostgreSQL independently enforces the Studio document identity, so a
    // foreign schema/version can never be persisted even outside the adapter.
    await expect(f.admin.query("INSERT INTO "+deals+"(tenant_id,id,code,name,version_token,body) VALUES('tenant-b',$1,'db-studio','DB',$2,$3::jsonb)",[randomUUID(),randomUUID(),JSON.stringify({schema:"vibress-studio",version:2,root:{type:"root",children:[]}})])).rejects.toMatchObject({code:"23514"});
    await expect(f.admin.query("INSERT INTO "+deals+"(tenant_id,id,code,name,version_token,attachment) VALUES('tenant-b',$1,'db-media','DB',$2,$3::jsonb)",[randomUUID(),randomUUID(),JSON.stringify({url:"https://cdn.test/a.png"})])).rejects.toMatchObject({code:"23514"});
    // Signed backfill supports bounded text and the validated JSON families,
    // refuses money (no pair representation) and media (unprovable ownership),
    // and applies the same guards before writing.
    const backfilled=randomUUID(),bfHeadline=randomUUID(),bfBody=randomUUID();
    const seedHeadline=JSON.stringify({en:"Seed"}),seedBody=JSON.stringify(createDefaultStudioDocument("Seed body")),seedMetadata=JSON.stringify({seed:true});
    await f.admin.query("INSERT INTO "+deals+"(tenant_id,id,code,name,version_token,headline,body) VALUES('tenant-b',$1,'bf-1','BF',$2,$3::jsonb,$4::jsonb)",[backfilled,randomUUID(),seedHeadline,seedBody]);
    await f.admin.query("INSERT INTO "+deals+"(tenant_id,id,code,name,version_token,body,metadata) VALUES('tenant-b',$1,'bf-2','BF',$2,$3::jsonb,$4::jsonb)",[bfHeadline,randomUUID(),seedBody,seedMetadata]);
    await f.admin.query("INSERT INTO "+deals+"(tenant_id,id,code,name,version_token,headline,metadata) VALUES('tenant-b',$1,'bf-3','BF',$2,$3::jsonb,$4::jsonb)",[bfBody,randomUUID(),seedHeadline,seedMetadata]);
    const physicalDigest=compileProvisioningContract(m,f.scope).digest;
    const chunk=(tenantId:string,column:string,value:string,limit=1)=>{
      const s=f.authority.authenticatedSnapshot();
      const e:ExperimentalBackfillApproval={version:1,installationId:f.scope.installationId,applicationId:f.scope.applicationId,databaseName:f.name,databaseOid:f.oid,epoch:s.epoch,ledgerId:s.ledgerId,authorityHead:s.head,authoritySequence:s.sequence,revision:m.digest,physicalDigest,operationId:randomUUID(),tenantId,resourceId:"deals",column,value,limit};
      const message=experimentalBackfillMessage(e);
      return runExperimentalBackfillChunk(dbUrl(f.name,f.installer),message,sign(null,Buffer.from(message),credentials.privateKey).toString("base64url"),f.authority);
    };
    await expect(chunk("tenant-a","metadata",JSON.stringify({a:{b:{c:{d:1}}}}))).rejects.toThrow("JSON_BOUND_REFUSED:DEPTH");
    await expect(chunk("tenant-a","value","1.00")).rejects.toThrow("M03_PROVISIONING_REFUSED");
    await expect(chunk("tenant-b","attachment",JSON.stringify({id:"med_cover_a"}))).rejects.toThrow("M03_BACKFILL_REFUSED:MEDIA_OWNERSHIP");
    await expect(chunk("tenant-b","headline",JSON.stringify({EN:"Hi"}))).rejects.toThrow("M03_BACKFILL_REFUSED:VALUE");
    await expect(chunk("tenant-b","body",JSON.stringify({...studio,version:2}))).rejects.toThrow("M03_BACKFILL_REFUSED:VALUE");
    expect(await chunk("tenant-b","metadata",JSON.stringify({note:"seeded"}))).toMatchObject({status:"COMMITTED",affected:1,complete:false});
    expect(await chunk("tenant-b","metadata",JSON.stringify({note:"seeded"}))).toMatchObject({status:"COMMITTED",affected:0,complete:true});
    expect(await chunk("tenant-b","headline",JSON.stringify({en:"Backfill",ar:"تعبئة"}))).toMatchObject({status:"COMMITTED",affected:1});
    expect(await chunk("tenant-b","body",JSON.stringify(studio))).toMatchObject({status:"COMMITTED",affected:1});
    expect((await f.admin.query("SELECT metadata FROM "+deals+" WHERE id=$1",[backfilled])).rows).toEqual([{metadata:{note:"seeded"}}]);
    expect((await f.admin.query("SELECT headline FROM "+deals+" WHERE id=$1",[bfHeadline])).rows).toEqual([{headline:{en:"Backfill",ar:"تعبئة"}}]);
    expect((await f.admin.query("SELECT body FROM "+deals+" WHERE id=$1",[bfBody])).rows).toEqual([{body:studio}]);
    console.info("M03_A01_MONEY_JSON_TYPED_WRITES=PASS");
  },60000);
  it("B01: persistent lifecycle CAS, immutable history, installer refusal, DB_COMMITTED vs ACTIVE, concurrency and supersession",async()=>{
    const f=await lab("lifecycle","reference-lifecycle"),m=crm(f),a=approval(f,null,m);
    const life=(digest:string)=>f.admin.query<{state:LifecycleState;state_version:number}>("SELECT state,state_version FROM public.platform_schema_revision_states_v1 WHERE installation_id=$1 AND revision_digest=$2",[f.scope.installationId,digest]).then(r=>r.rows[0]);
    const history=(digest:string)=>f.admin.query<{from_state:LifecycleState|null;to_state:LifecycleState;state_version:number}>("SELECT from_state,to_state,state_version FROM public.platform_schema_state_transitions_v1 WHERE installation_id=$1 AND revision_digest=$2 ORDER BY id",[f.scope.installationId,digest]).then(r=>r.rows);
    await f.admin.query("BEGIN");
    try{
      expect(await transition(f,m,a,null,"PROPOSED")).toEqual({state:"PROPOSED",version:1});
      await expect(transition(f,m,a,"PROPOSED","ACTIVE")).rejects.toThrow("M03_LIFECYCLE_REFUSED:ILLEGAL_TRANSITION");
      await expect(transition(f,m,a,null,"PROPOSED")).rejects.toThrow("M03_LIFECYCLE_REFUSED:EXISTS");
      await expect(transition(f,m,a,"PROPOSED","VALIDATED",undefined,randomUUID())).rejects.toThrow();
    }finally{await f.admin.query("ROLLBACK");}
    expect(await life(m.digest)).toBeUndefined();
    await f.admin.query("BEGIN");
    await transition(f,m,a,null,"PROPOSED");await f.admin.query("COMMIT");
    await f.admin.query("BEGIN");
    await transition(f,m,a,"PROPOSED","VALIDATED");
    await transition(f,m,a,"VALIDATED","APPROVED");await f.admin.query("COMMIT");
    expect(await life(m.digest)).toEqual({state:"APPROVED",state_version:3});
    await expect(apply(f,m,a)).resolves.toMatchObject({status:"ACTIVE",revision:m.digest});
    // The installer itself refuses a revision that was never operator-approved.
    const unapproved=crm(f,"phone"),b=approval(f,m,unapproved);
    await expect(installExperimentalRevision(dbUrl(f.name,f.installer),wire(unapproved),b.message,b.signature,f.authority)).rejects.toThrow("M03_LIFECYCLE_REFUSED");
    expect(await life(m.digest)).toEqual({state:"ACTIVE",state_version:6});
    expect((await history(m.digest)).map(x=>[x.from_state,x.to_state])).toEqual([[null,"PROPOSED"],["PROPOSED","VALIDATED"],["VALIDATED","APPROVED"],["APPROVED","PROVISIONING"],["PROVISIONING","DB_COMMITTED"],["DB_COMMITTED","ACTIVE"]]);
    await expect(transition(f,m,a,"APPROVED","PROVISIONING")).rejects.toThrow("M03_LIFECYCLE_REFUSED:STALE");
    // One concurrent CAS winner from the same predecessor state.
    const race=crm(f,"notes"),r=approval(f,m,race);
    await prepareLifecycle(f,race,r);
    const other=await connect(f.name);
    try{
      const run=async(c:Client)=>{await c.query("BEGIN");try{const result=await recordExperimentalLifecycleTransition(c,{installationId:f.scope.installationId,revisionDigest:race.digest,expectedState:"APPROVED",nextState:"PROVISIONING",operationId:r.e.operationId,approvalId:r.e.approvalId,epoch:r.e.epoch,head:r.e.authorityHead,sequence:r.e.authoritySequence,actor:"race"});await c.query("COMMIT");return result;}catch(error){await c.query("ROLLBACK").catch(()=>undefined);throw error;}};
      const results=await Promise.allSettled([run(f.admin),run(other)]);
      expect(results.filter(x=>x.status==="fulfilled").length,JSON.stringify(results.map(x=>x.status==="fulfilled"?"ok":String((x as PromiseRejectedResult).reason?.message)))).toBe(1);
      expect(results.find(x=>x.status==="rejected")).toMatchObject({reason:{message:"M03_LIFECYCLE_REFUSED:STALE"}});
    }finally{await other.end();}
    // A forged or orphan ACTIVE row breaks revision/lifecycle reconciliation.
    const next=crm(f,"website"),n=approval(f,m,next);
    await f.admin.query("UPDATE public.platform_schema_revision_states_v1 SET state='ACTIVE' WHERE installation_id=$1 AND revision_digest=$2",[f.scope.installationId,race.digest]);
    await expect(apply(f,next,n)).rejects.toThrow("M03_PROVISIONING_REFUSED:LIFECYCLE");
    await f.admin.query("UPDATE public.platform_schema_revision_states_v1 SET state='PROVISIONING' WHERE installation_id=$1 AND revision_digest=$2",[f.scope.installationId,race.digest]);
    // Real upgrade: new ACTIVE, parent superseded, history retained.
    await apply(f,next,n);
    expect(await life(m.digest)).toEqual({state:"SUPERSEDED",state_version:7});
    expect(await life(next.digest)).toEqual({state:"ACTIVE",state_version:6});
    expect((await history(m.digest)).at(-1)).toMatchObject({from_state:"ACTIVE",to_state:"SUPERSEDED",state_version:7});
    // Operator revocation is authenticated, append-only and terminal.
    await f.admin.query("BEGIN");
    await transition(f,next,n,"ACTIVE","REVOKED","fixture-security");
    await f.admin.query("COMMIT");
    await expect(transition(f,next,n,"REVOKED","ACTIVE")).rejects.toThrow("M03_LIFECYCLE_REFUSED:ILLEGAL_TRANSITION");
    expect(await life(next.digest)).toEqual({state:"REVOKED",state_version:7});
    await expect(f.admin.query("UPDATE public.platform_schema_state_transitions_v1 SET to_state='ACTIVE'")).rejects.toThrow("M03_LIFECYCLE_HISTORY_IMMUTABLE");
    await expect(f.admin.query("DELETE FROM public.platform_schema_state_transitions_v1")).rejects.toThrow("M03_LIFECYCLE_HISTORY_IMMUTABLE");
    // Runtime role cannot read or mutate lifecycle state.
    await expect(f.pool.query("SELECT * FROM public.platform_schema_revision_states_v1")).rejects.toMatchObject({code:"42501"});
    await expect(f.pool.query("SELECT * FROM public.platform_schema_state_transitions_v1")).rejects.toMatchObject({code:"42501"});
    console.info("M03_B01_LIFECYCLE_CAS_HISTORY_SUPERSESSION=PASS");
  },60000);
  it("B02: successive recovery epochs reattest the ACTIVE revision atomically with combined append-only history",async()=>{
    const f=await lab("recovery","reference-recovery"),m=crm(f),a=approval(f,null,m);
    await apply(f,m,a);
    const rev=(epoch:string,head:string,sequence:number,operationId=randomUUID())=>({installationId:f.scope.installationId,revisionDigest:m.digest,operationId,approvalId:randomUUID(),authorityEpoch:epoch,authorityHead:head,authoritySequence:sequence,actor:"fixture-recovery"});
    const state=()=>f.admin.query<{state:LifecycleState;state_version:number;authority_epoch:string;authority_sequence:string}>("SELECT state,state_version,authority_epoch::text AS authority_epoch,authority_sequence::text AS authority_sequence FROM public.platform_schema_revision_states_v1 WHERE installation_id=$1 AND revision_digest=$2",[f.scope.installationId,m.digest]).then(r=>r.rows[0]);
    const history=()=>f.admin.query<{from_state:LifecycleState|null;to_state:LifecycleState;authority_epoch:string}>("SELECT from_state,to_state,authority_epoch::text AS authority_epoch FROM public.platform_schema_state_transitions_v1 WHERE installation_id=$1 AND revision_digest=$2 ORDER BY id",[f.scope.installationId,m.digest]).then(r=>r.rows);
    const initial=await history(),stored=await state();
    expect(initial).toHaveLength(6);
    // Unknown revision and the already-current epoch are refused without touching state.
    const unknown={...rev(randomUUID(),createHash("sha256").update("x").digest("hex"),1),revisionDigest:createHash("sha256").update("missing").digest("hex")};
    await expect(reattestExperimentalLifecycleAfterRecovery(f.admin,unknown)).rejects.toThrow("M03_LIFECYCLE_REFUSED:RECOVERY_STATE");
    await expect(reattestExperimentalLifecycleAfterRecovery(f.admin,rev(stored!.authority_epoch,stored!.authority_epoch,Number(stored!.authority_sequence)+1))).rejects.toThrow("M03_LIFECYCLE_REFUSED:EPOCH_REPLAY");
    expect(await state()).toMatchObject({state:"ACTIVE",state_version:6});
    // First recovery epoch: RECOVERY_PENDING keeps the prior epoch, reattestation binds the new one.
    const e1=randomUUID(),head1=createHash("sha256").update("recovery-e1").digest("hex");
    await expect(reattestExperimentalLifecycleAfterRecovery(f.admin,rev(e1,head1,1_000_001))).resolves.toEqual({state:"ACTIVE",version:9,epoch:e1});
    expect(await state()).toMatchObject({state:"ACTIVE",state_version:9,authority_epoch:e1});
    // Replaying an epoch that already appears in history is refused and stays atomic.
    await expect(reattestExperimentalLifecycleAfterRecovery(f.admin,rev(stored!.authority_epoch,head1,1_000_002))).rejects.toThrow("M03_LIFECYCLE_REFUSED:EPOCH_REPLAY");
    // Second successive recovery epoch, sequence regression refused before any transition.
    const e2=randomUUID(),head2=createHash("sha256").update("recovery-e2").digest("hex");
    await expect(reattestExperimentalLifecycleAfterRecovery(f.admin,rev(e2,head2,500))).rejects.toThrow("M03_LIFECYCLE_REFUSED:SEQUENCE");
    expect(await state()).toMatchObject({state:"ACTIVE",state_version:9});
    await expect(reattestExperimentalLifecycleAfterRecovery(f.admin,rev(e2,head2,1_000_002))).resolves.toEqual({state:"ACTIVE",version:12,epoch:e2});
    const all=await history();
    expect(all.slice(0,6)).toEqual(initial);
    expect(all.slice(6).map(x=>[x.from_state,x.to_state])).toEqual([["ACTIVE","RECOVERY_PENDING"],["RECOVERY_PENDING","REATTESTED"],["REATTESTED","ACTIVE"],["ACTIVE","RECOVERY_PENDING"],["RECOVERY_PENDING","REATTESTED"],["REATTESTED","ACTIVE"]]);
    expect(all.slice(6).map(x=>x.authority_epoch)).toEqual([stored!.authority_epoch,e1,e1,e1,e2,e2]);
    // The runtime role cannot reattest.
    const runtime=await connect(f.name,f.runtime);
    try{await expect(reattestExperimentalLifecycleAfterRecovery(runtime,rev(randomUUID(),head2,1_000_003))).rejects.toMatchObject({code:"42501"});}finally{await runtime.end();}
    console.info("M03_B02_RECOVERY_EPOCH_REATTESTATION=PASS");
  },60000);
  it("B04: durable backfill target admission, chunk progress, conflict refusal, completion and replay",async()=>{
    const f=await lab("backfill","reference-backfill"),old=crm(f),m=crm(f,"website");
    await apply(f,old,approval(f,null,old));await apply(f,m,approval(f,old,m));
    const customers=table(f,m,"customers"),id=()=>randomUUID();
    const rows=[{tenant:"tenant-a",ids:[id(),id()]},{tenant:"tenant-b",ids:[id()]},{tenant:"tenant-c",ids:[id(),id()]}];
    for(const r of rows)for(const x of r.ids)await f.admin.query("INSERT INTO "+customers+"(tenant_id,id,code,name) VALUES($1,$2,$3,'N')",[r.tenant,x,x]);
    const physicalDigest=compileProvisioningContract(m,f.scope).digest;
    const mk=(tenantId:string,value:string,limit=1,operationId=randomUUID())=>{
      const s=f.authority.authenticatedSnapshot();
      const e:ExperimentalBackfillApproval={version:1,installationId:f.scope.installationId,applicationId:f.scope.applicationId,databaseName:f.name,databaseOid:f.oid,epoch:s.epoch,ledgerId:s.ledgerId,authorityHead:s.head,authoritySequence:s.sequence,revision:m.digest,physicalDigest,operationId,tenantId,resourceId:"customers",column:"website",value,limit};
      const message=experimentalBackfillMessage(e);
      return {e,message,signature:sign(null,Buffer.from(message),credentials.privateKey).toString("base64url")};
    };
    const chunk=(x:ReturnType<typeof mk>)=>runExperimentalBackfillChunk(dbUrl(f.name,f.installer),x.message,x.signature,f.authority);
    const target=(tenant:string)=>f.admin.query<{value:string;chunks:number;affected_total:string;complete:boolean}>("SELECT value,chunks,affected_total::text AS affected_total,complete FROM public.platform_schema_backfill_targets_v1 WHERE installation_id=$1 AND revision_digest=$2 AND tenant_id=$3 AND resource_id='customers' AND column_name='website'",[f.scope.installationId,m.digest,tenant]).then(r=>r.rows[0]);
    const a1=mk("tenant-a","first");
    expect(await chunk(a1)).toMatchObject({status:"COMMITTED",affected:1,complete:false});
    expect(await target("tenant-a")).toMatchObject({value:"first",chunks:1,affected_total:"1",complete:false});
    // Replaying a committed chunk must not double progress.
    expect(await chunk(a1)).toMatchObject({status:"ALREADY_COMMITTED",affected:1});
    expect(await target("tenant-a")).toMatchObject({chunks:1,affected_total:"1"});
    expect(await chunk(mk("tenant-a","first"))).toMatchObject({status:"COMMITTED",affected:1,complete:false});
    expect(await chunk(mk("tenant-a","first"))).toMatchObject({status:"COMMITTED",affected:0,complete:true});
    expect(await target("tenant-a")).toMatchObject({chunks:3,affected_total:"2",complete:true});
    // A completed target cannot be reopened, even with the identical value.
    await expect(chunk(mk("tenant-a","first"))).rejects.toThrow("M03_BACKFILL_REFUSED:COMPLETE");
    await expect(chunk(mk("tenant-a","other"))).rejects.toThrow("M03_BACKFILL_REFUSED:COMPLETE");
    // One target admits exactly one value; a conflicting concurrent value refuses.
    const results=await Promise.allSettled([chunk(mk("tenant-c","left")),chunk(mk("tenant-c","right"))]);
    expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    const winner=results[0]?.status==="fulfilled"?"left":"right";
    expect(results.find(x=>x.status==="rejected")).toMatchObject({reason:{message:"M03_BACKFILL_REFUSED:CONFLICT"}});
    expect(await target("tenant-c")).toMatchObject({value:winner,chunks:1});
    const values=(await f.admin.query<{value:string|null}>(`SELECT DISTINCT website AS value FROM ${customers} WHERE tenant_id='tenant-c'`)).rows.map(x=>x.value).filter(x=>x!==null);
    expect(values).toEqual([winner]);
    // Target rows are durable evidence, never clearable or rewritable in place.
    await expect(f.admin.query("UPDATE public.platform_schema_backfill_targets_v1 SET value='rewritten'")).rejects.toThrow("M03_BACKFILL_TARGET_IMMUTABLE");
    await expect(f.admin.query("DELETE FROM public.platform_schema_backfill_targets_v1")).rejects.toThrow("M03_BACKFILL_TARGET_IMMUTABLE");
    await expect(f.admin.query("UPDATE public.platform_schema_backfill_targets_v1 SET complete=false WHERE complete")).rejects.toThrow("M03_BACKFILL_TARGET_IMMUTABLE");
    const runtime=await connect(f.name,f.runtime);
    try{await expect(runtime.query("INSERT INTO public.platform_schema_backfill_targets_v1 SELECT * FROM public.platform_schema_backfill_targets_v1")).rejects.toMatchObject({code:"42501"});}finally{await runtime.end();}
    const chunks=(await f.admin.query<{n:number}>("SELECT count(*)::int AS n FROM public.platform_schema_backfill_chunks_v1")).rows[0]!.n;
    expect(chunks).toBe(4);
    console.info("M03_B04_DURABLE_BACKFILL_ADMISSION_PROGRESS=PASS");
  },60000);
  it("B03: idempotent cross-domain settlement reconciles provisioning, backfill and business evidence",async()=>{
    const f=await lab("settle","reference-settle"),m=crm(f,"website");
    await apply(f,m,approval(f,null,m));
    const customers=table(f,m,"customers"),rowId=randomUUID();
    await f.admin.query("INSERT INTO "+customers+"(tenant_id,id,code,name) VALUES('tenant-a',$1,'customer','Customer')",[rowId]);
    const physicalDigest=compileProvisioningContract(m,f.scope).digest,state=f.authority.authenticatedSnapshot();
    const backfill=(operationId=randomUUID())=>{
      const e:ExperimentalBackfillApproval={version:1,installationId:f.scope.installationId,applicationId:f.scope.applicationId,databaseName:f.name,databaseOid:f.oid,epoch:state.epoch,ledgerId:state.ledgerId,authorityHead:state.head,authoritySequence:state.sequence,revision:m.digest,physicalDigest,operationId,tenantId:"tenant-a",resourceId:"customers",column:"website",value:"settled",limit:5};
      const message=experimentalBackfillMessage(e);
      return {e,message,signature:sign(null,Buffer.from(message),credentials.privateKey).toString("base64url")};
    };
    const b=backfill();
    await runExperimentalBackfillChunk(dbUrl(f.name,f.installer),b.message,b.signature,f.authority);
    const sc=scope(f,"tenant-a"),uow=new TenantUnitOfWork(f.pool);
    const business=()=>{
      const s=f.authority.authenticatedSnapshot();
      const e:BusinessApproval={version:1,operationId:randomUUID(),applicationId:f.scope.applicationId,installationId:f.scope.installationId,databaseName:f.name,databaseOid:f.oid,epoch:s.epoch,ledgerId:s.ledgerId,authorityHead:s.head,authoritySequence:s.sequence,revision:m.digest,physicalDigest,tenantId:"tenant-a",principalId:"fixture-principal",rowId:randomUUID(),code:"settled",name:"Settled customer"};
      const message=experimentalBusinessMessage(e);return {e,message,signature:sign(null,Buffer.from(message),credentials.privateKey).toString("base64url")};
    };
    const x=business();
    expect(await f.authority.runExperimentalProvisionedBusiness(uow,sc,wire(m),x.message,x.signature)).toMatchObject({status:"COMMITTED"});
    const first=await settleExperimentalDomains(f.admin,f.authority);
    expect(first).toMatchObject({head:m.digest,active:m.digest,revisions:1,backfill:{chunks:1,targets:1,affected:1},business:{witnesses:1,settled:1}});
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    // Idempotent: settlement is read-only and returns the identical digest.
    expect((await settleExperimentalDomains(f.admin,f.authority)).digest).toBe(first.digest);
    // Provisioning disagreement between the registry head and the ACTIVE lifecycle revision is refused.
    await f.admin.query("UPDATE public.platform_schema_registry SET manifest_digest=$2 WHERE installation_id=$1",[f.scope.installationId,"f".repeat(64)]);
    await expect(settleExperimentalDomains(f.admin,f.authority)).rejects.toThrow("M03_SETTLEMENT_REFUSED:PROVISIONING");
    await f.admin.query("UPDATE public.platform_schema_registry SET manifest_digest=$2 WHERE installation_id=$1",[f.scope.installationId,m.digest]);
    // Extra chunk rows that the target ledger never admitted are refused.
    const forged=backfill();
    await f.admin.query("INSERT INTO public.platform_schema_backfill_chunks_v1(installation_id,revision_digest,operation_id,tenant_id,resource_id,column_name,evidence,signature,affected,ids) VALUES($1,$2,$3,'tenant-a','customers','website',$4,$5,0,'{}')",[f.scope.installationId,m.digest,forged.e.operationId,forged.message,forged.signature]);
    await expect(settleExperimentalDomains(f.admin,f.authority)).rejects.toThrow("M03_SETTLEMENT_REFUSED:BACKFILL_PROGRESS");
    await f.admin.query("DELETE FROM public.platform_schema_backfill_chunks_v1 WHERE operation_id=$1",[forged.e.operationId]);
    // A witness that the authority never admitted is refused.
    await f.admin.query("INSERT INTO public.platform_schema_business_witnesses_v1(operation_id,xid,evidence,signature) VALUES(gen_random_uuid(),'1'::xid8,'forged',$1)",["A".repeat(86)]);
    await expect(settleExperimentalDomains(f.admin,f.authority)).rejects.toThrow("M03_SETTLEMENT_REFUSED:BUSINESS");
    const runtime=await connect(f.name,f.runtime);
    try{await expect(settleExperimentalDomains(runtime,f.authority)).rejects.toMatchObject({code:"42501"});}finally{await runtime.end();}
    console.info("M03_B03_CROSS_DOMAIN_SETTLEMENT=PASS");
  },60000);
  it("C05/J03: portable content and migration identity across actual dedicated installs and additive upgrades",async()=>{
    const a=await lab("portablea","reference-portable-a"),b=await lab("portableb","reference-portable-b");
    const a1=crm(a),b1=crm(b),a2=crm(a,"website"),b2=crm(b,"website");
    const createA=compilePortableProvisioningIdentity(null,a1,a.scope),createB=compilePortableProvisioningIdentity(null,b1,b.scope);
    const upgradeA=compilePortableProvisioningIdentity(a1,a2,a.scope),upgradeB=compilePortableProvisioningIdentity(b1,b2,b.scope);
    expect(createA).toEqual(createB);expect(upgradeA).toEqual(upgradeB);
    expect(createA.authorization).toBe("NONE");expect(upgradeA.parentContentDigest).toBe(createA.contentDigest);
    expect(upgradeA.contentDigest).not.toBe(createA.contentDigest);expect(upgradeA.transitionDigest).not.toBe(createA.transitionDigest);
    expect(a1.digest).not.toBe(b1.digest);expect(a2.digest).not.toBe(b2.digest);
    expect(compileProvisioningTransition(null,a1,a.scope).digest).not.toBe(compileProvisioningTransition(null,b1,b.scope).digest);
    expect(compileProvisioningTransition(a1,a2,a.scope).digest).not.toBe(compileProvisioningTransition(b1,b2,b.scope).digest);
    expect(()=>compilePortableProvisioningIdentity(a1,b2,a.scope)).toThrow();
    expect(()=>compilePortableProvisioningIdentity(a2,a1,a.scope)).toThrow();
    expect(compilePortableProvisioningIdentity(a1,crm(a,"notes"),a.scope).transitionDigest).not.toBe(upgradeA.transitionDigest);
    for(const [f,old,next] of [[a,a1,a2],[b,b1,b2]] as const){
      await apply(f,old,approval(f,null,old));const uow=new TenantUnitOfWork(f.pool),ta=scope(f,"tenant-a"),q=table(f,old,"customers"),id=randomUUID();
      await uow.run(ta,tx=>tx.query("INSERT INTO "+q+"(tenant_id,id,code,name) VALUES($1,$2,'portable','Retained')",["tenant-a",id]));
      await apply(f,next,approval(f,old,next));
      expect(await check(f,next)).toBe(compileProvisioningContract(next,f.scope).digest);
      expect((await uow.run(ta,tx=>tx.query("SELECT id::text AS id,name,website FROM "+q+" ORDER BY id"))).rows).toEqual([{id,name:"Retained",website:null}]);
    }
    expect(a.namespace).not.toBe(b.namespace);
    // Typed V2 content stays installation-neutral and installs on both databases.
    const typed=(f:Lab,extended:boolean)=>{
      const defs:ResourceDefinition[]=[
        {...f.scope,id:"customers",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"name",type:"text",required:true},{id:"website",type:"text",required:false},...(extended?[
          {id:"due",type:"date" as const,required:false},{id:"quantity",type:"integer" as const,required:false},
          {id:"rate",type:"decimal" as const,precision:9,scale:2,required:false},
        ]:[])]},
        {...f.scope,id:"deals",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"customer",type:"relation",required:true,targetResource:"customers"},{id:"stage",type:"enum",required:true,values:["open","won"]}]},
        {...f.scope,id:"activities",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"deal",type:"relation",required:false,targetResource:"deals"},{id:"done",type:"boolean",required:true}]},
      ];
      return createSchemaManifest(compileResourceSchema(defs,f.scope));
    };
    expect(typed(a,false).digest).toBe(a2.digest);
    const typedA=typed(a,true),typedB=typed(b,true);
    expect(provisioningProfileFor(typedA)).toBe(PROVISIONING_PROFILE_V2);
    const typedAUpgrade=compilePortableProvisioningIdentity(a2,typedA,a.scope),typedBUpgrade=compilePortableProvisioningIdentity(b2,typedB,b.scope);
    expect(typedAUpgrade).toEqual(typedBUpgrade);
    expect(typedAUpgrade.parentContentDigest).toBe(upgradeA.contentDigest);
    expect(typedAUpgrade.contentDigest).not.toBe(upgradeA.contentDigest);
    for(const [f,old,next] of [[a,a2,typedA],[b,b2,typedB]] as const){
      await apply(f,next,approval(f,old,next));
      expect(await check(f,next)).toBe(compileProvisioningContract(next,f.scope).digest);
      const columns=(await f.admin.query<{name:string}>(`SELECT attname::text AS name FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass('${table(f,next,"customers")}') AND attnum>0 AND NOT attisdropped AND attname IN ('due','quantity','rate')`)).rows.map(r=>r.name).sort();
      expect(columns).toEqual(["due","quantity","rate"]);
    }
    console.info("M03_C05_PORTABLE_CONTENT_AND_MIGRATION=PASS");
  },60000);
  // These are contract regression tests, not asserted reproduction results.
  // Each installs a clean isolated CRM, applies actual drift, records the
  // verifier outcome, restores the catalog/ACL and rechecks the positive control.
  async function expectDriftRefused(f:Lab,m:SchemaManifest,label:string,drift:()=>Promise<void>,restore:()=>Promise<void>){
    const digest=compileProvisioningContract(m,f.scope).digest;
    expect(await check(f,m)).toBe(digest);
    let outcome:string;
    try{
      await drift();
      try{await check(f,m);outcome="ACCEPTED";}
      catch(error){outcome=error instanceof Error?error.message:"UNKNOWN_ERROR";}
      console.info("M03_DRIFT_OBSERVATION "+label+" "+outcome);
    }finally{
      await restore();
      expect(await check(f,m)).toBe(digest);
      console.info("M03_DRIFT_RESTORED "+label);
    }
    expect(outcome).toMatch(/^M03_PROVISIONING_REFUSED:/);
  }
  it("B06: deterministic module namespace reservation is atomic, scoped and immutable",async()=>{
    const f=await lab("modules","reference-modules");
    const namespace=moduleNamespaceName({...f.scope,moduleId:"analytics"});
    expect(namespace).toBe(moduleNamespaceName({...f.scope,moduleId:"analytics"}));
    expect(namespace).toMatch(/^v3_mod_[a-f0-9]{24}$/);
    expect(namespace).not.toBe(provisioningNamespace(f.scope));
    expect(moduleNamespaceName({...f.scope,moduleId:"reporting"})).not.toBe(namespace);
    for(const moduleId of ["public","pg_catalog","information_schema","pg_temp","v3_core","platform_core","vibress_auth","Bad-Name","a"]){
      expect(()=>moduleNamespaceName({...f.scope,moduleId})).toThrow("M03_MODULE_NAMESPACE_REFUSED");
    }
    await expect(reserveExperimentalModuleNamespace(f.admin,{scope:{...f.scope,applicationId:asApplicationId("other-app")},moduleId:"analytics"})).rejects.toThrow("M03_MODULE_NAMESPACE_REFUSED");
    const first=await reserveExperimentalModuleNamespace(f.admin,{scope:f.scope,moduleId:"analytics"});
    expect(first).toEqual({status:"RESERVED",profile:"M03_MODULE_NAMESPACE_V1",moduleId:"analytics",namespace});
    const rows=(await f.admin.query<{installation_id:string;application_id:string;module_id:string;namespace:string;installer_role:string;runtime_role:string}>("SELECT installation_id,application_id,module_id,namespace,installer_role,runtime_role FROM public.platform_module_namespaces_v1")).rows;
    expect(rows).toEqual([{installation_id:f.scope.installationId,application_id:f.scope.applicationId,module_id:"analytics",namespace,installer_role:f.installer,runtime_role:f.runtime}]);
    // The schema is installer-owned; the runtime receives USAGE only, and the
    // reservation replay verifies the catalog instead of duplicating the row.
    const schema=(await f.admin.query<{owner:string;acl:string[]}>("SELECT pg_get_userbyid(nspowner) AS owner,ARRAY(SELECT (CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)||':'||pg_get_userbyid(a.grantor)||':'||a.privilege_type FROM aclexplode(coalesce(nspacl,acldefault('n',nspowner))) a ORDER BY 1) AS acl FROM pg_namespace WHERE nspname=$1",[namespace])).rows[0];
    expect(schema?.owner).toBe(f.installer);
    expect(schema?.acl.slice().sort()).toEqual([f.installer+":"+f.installer+":CREATE",f.installer+":"+f.installer+":USAGE",f.runtime+":"+f.installer+":USAGE"].sort());
    expect(await reserveExperimentalModuleNamespace(f.admin,{scope:f.scope,moduleId:"analytics"})).toEqual({status:"ALREADY_RESERVED",profile:"M03_MODULE_NAMESPACE_V1",moduleId:"analytics",namespace});
    expect(await verifyExperimentalModuleNamespace(f.admin,{scope:f.scope,moduleId:"analytics"})).toBe(namespace);
    await expect(f.admin.query("UPDATE public.platform_module_namespaces_v1 SET namespace=namespace")).rejects.toThrow("M03_MODULE_NAMESPACE_IMMUTABLE");
    await expect(f.pool.query("SELECT * FROM public.platform_module_namespaces_v1")).rejects.toMatchObject({code:"42501"});
    await expect(f.pool.query("CREATE TABLE "+qi(namespace)+".intruder(id int)")).rejects.toMatchObject({code:"42501"});
    // A different module cannot claim an already-derived namespace.
    const reports=moduleNamespaceName({...f.scope,moduleId:"reports"});
    await f.admin.query("INSERT INTO public.platform_module_namespaces_v1(installation_id,application_id,module_id,namespace,installer_role,runtime_role,binding_digest) VALUES($1,$2,'rogue',$3,$4,$5,$6)",[f.scope.installationId,f.scope.applicationId,reports,f.installer,f.runtime,"1".repeat(64)]);
    await expect(reserveExperimentalModuleNamespace(f.admin,{scope:f.scope,moduleId:"reports"})).rejects.toThrow("M03_MODULE_NAMESPACE_REFUSED:COLLISION");
    expect((await f.admin.query("SELECT count(*)::int AS n FROM public.platform_module_namespaces_v1 WHERE module_id='reports'")).rows[0]).toEqual({n:0});
    // A forged row for the requested module is refused, never silently adopted.
    const orders=moduleNamespaceName({...f.scope,moduleId:"orders"});
    await f.admin.query("INSERT INTO public.platform_module_namespaces_v1(installation_id,application_id,module_id,namespace,installer_role,runtime_role,binding_digest) VALUES($1,'other-app','orders',$2,$3,$4,$5)",[f.scope.installationId,orders,f.installer,f.runtime,"2".repeat(64)]);
    await expect(reserveExperimentalModuleNamespace(f.admin,{scope:f.scope,moduleId:"orders"})).rejects.toThrow("M03_MODULE_NAMESPACE_REFUSED:MISMATCH");
    // A pre-existing foreign schema makes the atomic reservation fail: no row
    // survives the rolled-back transaction.
    const holdings=moduleNamespaceName({...f.scope,moduleId:"holdings"});
    await f.admin.query("CREATE SCHEMA "+qi(holdings));
    await expect(reserveExperimentalModuleNamespace(f.admin,{scope:f.scope,moduleId:"holdings"})).rejects.toThrow();
    expect((await f.admin.query("SELECT count(*)::int AS n FROM public.platform_module_namespaces_v1 WHERE module_id='holdings'")).rows[0]).toEqual({n:0});
    await f.admin.query("DROP SCHEMA "+qi(holdings));
    expect((await reserveExperimentalModuleNamespace(f.admin,{scope:f.scope,moduleId:"holdings"})).status).toBe("RESERVED");
    console.info("M03_B06_MODULE_NAMESPACE=PASS");
  },60000);
  it("B05: reviewed rename expansion, signed bounded copy backfill and validation never drop the source column",async()=>{
    const f=await lab("rename","reference-rename"),current=crm(f),target=renamedCrm(f);
    await apply(f,current,approval(f,null,current));
    const customers=table(f,current,"customers"),rowId=()=>randomUUID();
    const intent={version:1 as const,resourceId:"customers",from:"name",to:"title",rationale:"Rename display name to title"};
    const plan=compileRenameIntent(JSON.parse(wire(current)),JSON.parse(wire(target)),intent,f.scope);
    expect(plan).toMatchObject({profile:"M03_RENAME_INTENT_V1",authorization:"NONE",compatibility:"EXPAND_AND_BACKFILL",destructive:false,resource:{id:"customers",table:current.resources.find(x=>x.id==="customers")!.tableName},from:{column:"name",type:"text"},to:{column:"title",type:"text"}});
    expect(plan.phases.expand.execution).toBe("INSTALLER_REVIEW_REQUIRED");
    expect(plan.phases.expand.statements).toHaveLength(1);
    expect(plan.phases.expand.statements[0]).toContain(" ADD COLUMN ");
    expect(plan.phases.expand.statements[0]).not.toMatch(/DROP|ALTER COLUMN|SET NOT NULL/i);
    expect(plan.phases.backfill).toMatchObject({sourceColumn:"name",targetColumn:"title",execution:"SIGNED_BOUNDED_BACKFILL_REQUIRED"});
    expect(plan.phases.validate.predicates).toEqual(['count(*) FILTER (WHERE "title" IS NULL) = 0']);
    expect(plan.phases.contract.executable).toBe(false);
    expect(plan.digest).toMatch(/^[a-f0-9]{64}$/);
    // A rename is refused by the ordinary evolution compiler and inference to a
    // required destination is refused by the intent compiler.
    expect(()=>compileProvisioningTransition(current,target,f.scope)).toThrow("PROVISIONING_DESTRUCTIVE_REFUSED");
    expect(()=>compileRenameIntent(JSON.parse(wire(current)),JSON.parse(wire(renamedCrm(f,true))),intent,f.scope)).toThrow("RENAME_INTENT_REFUSED");
    const ids={ "tenant-a":[rowId(),rowId()], "tenant-b":[rowId()] };
    for(const [tenant,rows] of Object.entries(ids))for(const id of rows)await f.admin.query("INSERT INTO "+customers+"(tenant_id,id,code,name) VALUES($1,$2,$3,'N')",[tenant,id,id]);
    const approve=(phase:"EXPAND"|"BACKFILL"|"VALIDATE",tenantId:string,overrides:Partial<ExperimentalRenameApproval>={})=>{
      const s=f.authority.authenticatedSnapshot();
      const e:ExperimentalRenameApproval={version:1,installationId:f.scope.installationId,applicationId:f.scope.applicationId,databaseName:f.name,databaseOid:f.oid,epoch:s.epoch,ledgerId:s.ledgerId,authorityHead:s.head,authoritySequence:s.sequence,revision:current.digest,targetRevision:target.digest,planDigest:plan.digest,operationId:randomUUID(),resourceId:"customers",from:"name",to:"title",phase,tenantId,limit:phase==="BACKFILL"?1:0,rationale:"Rename display name to title",...overrides};
      const message=experimentalRenameMessage(e);
      return {e,message,signature:sign(null,Buffer.from(message),credentials.privateKey).toString("base64url")};
    };
    const run=(x:ReturnType<typeof approve>,wireTarget=wire(target),signature=x.signature)=>runExperimentalRename(dbUrl(f.name,f.installer),x.message,signature,f.authority,wireTarget);
    const columns=async()=>(await f.admin.query<{column:string;type:string;nullable:boolean;default:string|null}>("SELECT a.attname AS column,format_type(a.atttypid,a.atttypmod) AS type,NOT a.attnotnull AS nullable,pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",[customers])).rows;
    const before=await columns();
    // Nothing runs without the exact signed plan binding, and a phase for an
    // unreviewed expand is refused.
    await expect(run(approve("EXPAND",""),wire(target),"A".repeat(86))).rejects.toThrow();
    await expect(run(approve("EXPAND","",{planDigest:"f".repeat(64)}))).rejects.toThrow("M03_RENAME_REFUSED");
    await expect(run(approve("EXPAND","",{targetRevision:"f".repeat(64)}))).rejects.toThrow("M03_RENAME_REFUSED");
    await expect(run(approve("EXPAND",""),wire(renamedCrm(f,true)))).rejects.toThrow("M03_RENAME_REFUSED");
    await expect(run(approve("BACKFILL","tenant-a"))).rejects.toThrow("M03_RENAME_REFUSED:NOT_EXPANDED");
    await expect(run(approve("VALIDATE","tenant-a"))).rejects.toThrow("M03_RENAME_REFUSED:NOT_EXPANDED");
    const runtimeApproval=approve("EXPAND","");
    await expect(runExperimentalRename(dbUrl(f.name,f.runtime),runtimeApproval.message,runtimeApproval.signature,f.authority,wire(target))).rejects.toMatchObject({code:"42501"});
    expect(await columns()).toEqual(before);
    // EXPAND applies the reviewed statement once; the source column and its
    // data survive and the strict catalog gate flags the uninstalled drift.
    const expand=approve("EXPAND","");
    expect(await run(expand)).toEqual({status:"APPLIED",phase:"EXPAND",column:"title"});
    const expanded=await columns();
    expect(expanded).toHaveLength(before.length+1);
    expect(expanded.slice(0,before.length)).toEqual(before);
    expect(expanded.at(-1)).toEqual({column:"title",type:"text",nullable:true,default:null});
    expect((await f.admin.query("SELECT name FROM "+customers+" ORDER BY id")).rows.map(x=>x.name)).toEqual(["N","N","N"]);
    expect(await run(expand)).toEqual({status:"ALREADY_APPLIED",phase:"EXPAND",column:"title"});
    expect(await run(expand)).toEqual({status:"ALREADY_APPLIED",phase:"EXPAND",column:"title"});
    await expect(run(approve("EXPAND",""))).rejects.toThrow("M03_RENAME_REFUSED:EXISTS");
    expect(await columns()).toEqual(expanded);
    await expect(check(f,current)).rejects.toThrow("M03_PROVISIONING_REFUSED");
    // Validation is honest before and during the copy.
    expect(await run(approve("VALIDATE","tenant-a"))).toMatchObject({status:"INCOMPLETE",rows:2,missing:2,divergent:0});
    const first=approve("BACKFILL","tenant-a");
    expect(await run(first)).toMatchObject({status:"COMMITTED",affected:1,complete:false});
    expect(await run(first)).toMatchObject({status:"ALREADY_COMMITTED",affected:1});
    expect(await run(approve("BACKFILL","tenant-a"))).toMatchObject({status:"COMMITTED",affected:1,complete:false});
    expect(await run(approve("BACKFILL","tenant-a"))).toMatchObject({status:"COMMITTED",affected:0,complete:true});
    await expect(run(approve("BACKFILL","tenant-a"))).rejects.toThrow("M03_RENAME_REFUSED:COMPLETE");
    expect(await run(approve("VALIDATE","tenant-a"))).toEqual({status:"VALIDATED",rows:2,missing:0,divergent:0});
    expect(await run(approve("VALIDATE","tenant-b"))).toMatchObject({status:"INCOMPLETE",rows:1,missing:1});
    expect(await run(approve("BACKFILL","tenant-b"))).toMatchObject({status:"COMMITTED",affected:1,complete:false});
    expect(await run(approve("BACKFILL","tenant-b"))).toMatchObject({status:"COMMITTED",affected:0,complete:true});
    expect(await run(approve("VALIDATE","tenant-b"))).toEqual({status:"VALIDATED",rows:1,missing:0,divergent:0});
    expect((await f.admin.query("SELECT tenant_id,title,name FROM "+customers+" ORDER BY tenant_id,id")).rows).toEqual([
      {tenant_id:"tenant-a",title:"N",name:"N"},{tenant_id:"tenant-a",title:"N",name:"N"},{tenant_id:"tenant-b",title:"N",name:"N"},
    ]);
    const progress=await f.admin.query<{chunks:number;affected_total:string;complete:boolean}>("SELECT chunks,affected_total::text AS affected_total,complete FROM public.platform_schema_rename_progress_v1 ORDER BY tenant_id").then(r=>r.rows);
    expect(progress).toEqual([{chunks:3,affected_total:"2",complete:true},{chunks:2,affected_total:"1",complete:true}]);
    // Durable rename evidence is append-only and never rewritable.
    await expect(f.admin.query("UPDATE public.platform_schema_rename_chunks_v1 SET affected=0")).rejects.toThrow("M03_RENAME_EVIDENCE_IMMUTABLE");
    await expect(f.admin.query("DELETE FROM public.platform_schema_rename_phases_v1")).rejects.toThrow("M03_RENAME_EVIDENCE_IMMUTABLE");
    await expect(f.admin.query("UPDATE public.platform_schema_rename_progress_v1 SET complete=false")).rejects.toThrow("M03_RENAME_PROGRESS_IMMUTABLE");
    const runtime=await connect(f.name,f.runtime);
    try{
      for(const t of ["platform_schema_rename_phases_v1","platform_schema_rename_chunks_v1","platform_schema_rename_progress_v1"])await expect(runtime.query("SELECT * FROM public."+t)).rejects.toMatchObject({code:"42501"});
    }finally{await runtime.end();}
    // The destructive contract phase remains unexecutable: the source column
    // and its data are still present after every non-destructive phase.
    expect((await columns()).some(x=>x.column==="name")).toBe(true);
    expect((await f.admin.query("SELECT name FROM "+customers+" ORDER BY id")).rows.map(x=>x.name)).toEqual(["N","N","N"]);
    console.info("M03_B05_NON_DESTRUCTIVE_RENAME=PASS");
  },60000);
  it("B03: authenticated continuation settles an interrupted operation idempotently across restart",async()=>{
    const f=await lab("continuation","reference-continuation"),m=createSchemaManifest(compileResourceSchema([{...f.scope,id:"assets",ownership:"application",fields:[{id:"code",type:"text",required:true}]}],f.scope)),a=approval(f,null,m);
    const proxy=await startTransactionAckFaultProxy("COMMIT","DROP");void proxy.serverCommitObserved.catch(()=>undefined);
    await prepareLifecycle(f,m,a);
    try{
      const target=new URL(dbUrl(f.name,f.installer));target.port=String(proxy.port);
      const pending=installExperimentalRevision(target.toString(),wire(m),a.message,a.signature,f.authority,proxy.port);
      const failed=pending.then(()=>false,()=>true);
      await Promise.race([proxy.serverCommitObserved,pending.then(()=>{throw Error("fault target unexpectedly succeeded");},error=>{if(!(error instanceof Error)||error.message!=="M03_INSTALLER_COMMIT_UNKNOWN_NO_RETRY")throw error;return proxy.serverCommitObserved;})]);
      expect(await failed).toBe(true);
    }finally{await proxy.close();}
    // Inspection is read-only and reports the interrupted operation with its
    // durable provenance; the install committed but activation never ran.
    const interrupted=inspectExperimentalOperations(f.authority);
    expect(interrupted.pending).toBe(true);
    expect(interrupted.operations).toContainEqual({kind:"PROVISIONING",operationId:a.e.operationId,outcome:"UNCERTAIN",provenance:{installationId:f.scope.installationId,databaseName:f.name,epoch:a.e.epoch,revision:m.digest}});
    expect((await f.admin.query("SELECT state FROM public.platform_schema_revision_states_v1 WHERE installation_id=$1 AND revision_digest=$2",[f.scope.installationId,m.digest])).rows).toEqual([{state:"DB_COMMITTED"}]);
    // Definitive commit evidence requires a quiescent database, exactly as the
    // physical reconciliation contract demands; it is not inferred from absence.
    await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS false");
    try{
      const evidence=await collectExperimentalProvisioningCommit(f.admin,f.authority.authenticatedSnapshot().provisioningOperations!,a.e.operationId);
      const wireEvidence=JSON.stringify(evidence);
      const authorize=(value:string)=>sign(null,recoveryAdministrationMessage(f.authority.snapshot(),"PROVISIONING_OBSERVED_COMMIT_V1",value),adminKeys.privateKey).toString("base64url");
      // Unknown, in-flight-only, forged and unsigned requests are refused.
      await expect(continueExperimentalOperation(f.admin,f.authority,{kind:"PROVISIONING",operationId:randomUUID()},wireEvidence,authorize(wireEvidence))).rejects.toThrow("M03_CONTINUATION_REFUSED");
      await expect(continueExperimentalOperation(f.admin,f.authority,{kind:"BUSINESS",operationId:a.e.operationId},wireEvidence,authorize(wireEvidence))).rejects.toThrow("M03_CONTINUATION_REFUSED");
      await expect(continueExperimentalOperation(f.admin,f.authority,{kind:"PROVISIONING",operationId:a.e.operationId},wireEvidence,"A".repeat(86))).rejects.toThrow();
      const tampered=JSON.stringify({...evidence,operationId:randomUUID()});
      await expect(continueExperimentalOperation(f.admin,f.authority,{kind:"PROVISIONING",operationId:a.e.operationId},tampered,authorize(tampered))).rejects.toThrow();
      const settled=await continueExperimentalOperation(f.admin,f.authority,{kind:"PROVISIONING",operationId:a.e.operationId},wireEvidence,authorize(wireEvidence));
      expect(settled).toMatchObject({status:"SETTLED",kind:"PROVISIONING",operationId:a.e.operationId,outcome:"COMMITTED"});
      expect(f.authority.authenticatedSnapshot().provisioningOperations?.filter(o=>o.operationId===a.e.operationId)).toHaveLength(1);
      // Repeating the continuation is a read-only no-op, not a second settlement.
      expect(await continueExperimentalOperation(f.admin,f.authority,{kind:"PROVISIONING",operationId:a.e.operationId},wireEvidence,"A".repeat(86))).toMatchObject({status:"ALREADY_SETTLED",outcome:"COMMITTED"});
      // Restart continuity: the reopened durable authority still classifies the
      // operation as settled and never re-observes or reappends it.
      f.authority.close();
      f.authority=DisposableDurableRecoveryAuthority.open(f.dir,epochKeys.privateKey,f.anchor,adminKeys.publicKey);
      expect(inspectExperimentalOperations(f.authority).operations.find(o=>o.operationId===a.e.operationId)).toMatchObject({kind:"PROVISIONING",outcome:"COMMITTED",provenance:{installationId:f.scope.installationId,databaseName:f.name,epoch:a.e.epoch,revision:m.digest}});
      expect(await continueExperimentalOperation(f.admin,f.authority,{kind:"PROVISIONING",operationId:a.e.operationId},wireEvidence,"A".repeat(86))).toMatchObject({status:"ALREADY_SETTLED",outcome:"COMMITTED"});
    }finally{await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS true");}
    // Continuation resolves durable evidence only; activation remains an
    // explicit operator step and is not performed as an administrative bypass.
    expect((await f.admin.query("SELECT state FROM public.platform_schema_revision_states_v1 WHERE installation_id=$1 AND revision_digest=$2",[f.scope.installationId,m.digest])).rows).toEqual([{state:"DB_COMMITTED"}]);
    console.info("M03_B03_CONTINUATION=PASS");
  },60000);
  it("FUNC-01: protected revision manifest column UPDATE drift must be refused",async()=>{
    const f=await lab("funcacl","reference-func-acl"),m=crm(f);
    await apply(f,m,approval(f,null,m));
    const target="public.platform_schema_revisions_v1",role=qi(f.runtime);
    const privilege=async()=>(await f.admin.query<{allowed:boolean}>("SELECT has_column_privilege($1,$2,'manifest','UPDATE') AS allowed",[f.runtime,target])).rows[0]!.allowed;
    const revisions=async()=>(await f.admin.query("SELECT revision_digest,manifest FROM "+target+" ORDER BY revision_digest")).rows;
    const original=await revisions();
    expect(await privilege()).toBe(false);
    await expectDriftRefused(f,m,"FUNC-01-column-update",async()=>{
      await f.admin.query("GRANT UPDATE(manifest) ON "+target+" TO "+role);
      expect(await privilege()).toBe(true);
      expect(await revisions()).toEqual(original);
    },async()=>{
      await f.admin.query("REVOKE UPDATE(manifest) ON "+target+" FROM "+role);
      expect(await privilege()).toBe(false);
      expect(await revisions()).toEqual(original);
    });
  },60000);
  async function relationIndex(f:Lab,m:SchemaManifest){
    const relation=table(f,m,"deals");
    const indexes=(await f.admin.query<{name:string;opclass:string;collation:string}>("SELECT i.relname AS name,o.opcname AS opclass,co.collname AS collation FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_opclass o ON o.oid=x.indclass[0] JOIN pg_collation co ON co.oid=x.indcollation[0] WHERE x.indrelid=$1::regclass AND NOT x.indisunique",[relation])).rows;
    expect(indexes).toHaveLength(1);
    return indexes[0]!;
  }
  it("FUNC-02: same-name relation index with text_pattern_ops must be refused",async()=>{
    const f=await lab("funcix","reference-func-ix"),m=crm(f);
    await apply(f,m,approval(f,null,m));
    const original=await relationIndex(f,m);
    expect(original.opclass).toBe("text_ops");
    const target=table(f,m,"deals"),index=qi(f.namespace)+"."+qi(original.name);
    const replace=async(opclass:string)=>{
      await f.admin.query("DROP INDEX "+index+"; CREATE INDEX "+qi(original.name)+" ON "+target+" (tenant_id "+opclass+", customer)");
    };
    await expectDriftRefused(f,m,"FUNC-02-index-opclass",async()=>{
      await replace("pg_catalog.text_pattern_ops");
      expect(await relationIndex(f,m)).toEqual({...original,opclass:"text_pattern_ops"});
    },async()=>{
      await replace("pg_catalog.text_ops");
      expect(await relationIndex(f,m)).toEqual(original);
    });
  },60000);
  it("FUNC-02: same-name relation index with changed collation must be refused",async()=>{
    const f=await lab("funccol","reference-func-col"),m=crm(f);
    await apply(f,m,approval(f,null,m));
    const original=await relationIndex(f,m);
    expect(original.collation).toBe("default");
    const target=table(f,m,"deals"),index=qi(f.namespace)+"."+qi(original.name);
    const replace=async(collation:string)=>{
      await f.admin.query("DROP INDEX "+index+"; CREATE INDEX "+qi(original.name)+" ON "+target+" (tenant_id COLLATE "+collation+", customer)");
    };
    await expectDriftRefused(f,m,"FUNC-02-index-collation",async()=>{
      await replace('pg_catalog."C"');
      expect(await relationIndex(f,m)).toEqual({...original,collation:"C"});
    },async()=>{
      await replace('pg_catalog."default"');
      expect(await relationIndex(f,m)).toEqual(original);
    });
  },60000);
  it("FUNC-02: external inherited child of generated table must be refused",async()=>{
    const f=await lab("funcinh","reference-func-inh"),m=crm(f);
    await apply(f,m,approval(f,null,m));
    const target=table(f,m,"customers"),child="public.m03_func_inherited_child";
    const children=async()=>(await f.admin.query<{n:number}>("SELECT count(*)::int AS n FROM pg_inherits WHERE inhparent=$1::regclass",[target])).rows[0]!.n;
    expect(await children()).toBe(0);
    await expectDriftRefused(f,m,"FUNC-02-inheritance",async()=>{
      await f.admin.query("CREATE TABLE "+child+" () INHERITS ("+target+")");
      expect(await children()).toBe(1);
    },async()=>{
      await f.admin.query("DROP TABLE IF EXISTS "+child);
      expect(await children()).toBe(0);
    });
  },60000);
  it("FUNC-01: protected ACL matrix and restoration",async()=>{
    const f=await lab("funcmatrix","reference-func-matrix"),m=crm(f);
    await apply(f,m,approval(f,null,m));
    const rt=qi(f.runtime),inst=qi(f.installer),rev="public.platform_schema_revisions_v1",witness="public.platform_schema_business_witnesses_v1",history="public.platform_schema_recovery_reattestations_v1";
    f.reader="v3_extra_"+suffix;
    await createFixtureRole(f.reader);
    const extra=qi(f.reader);
    const rootRole=(await f.admin.query<{name:string}>("SELECT current_user AS name")).rows[0]!.name;
    const cases:[string,string,string][]=[
      ["table-update","GRANT UPDATE ON "+rev+" TO "+rt,"REVOKE UPDATE ON "+rev+" FROM "+rt],
      ["history-select","GRANT SELECT ON "+history+" TO "+rt,"REVOKE SELECT ON "+history+" FROM "+rt],
      ["delete","GRANT DELETE ON "+rev+" TO "+rt,"REVOKE DELETE ON "+rev+" FROM "+rt],
      ["truncate","GRANT TRUNCATE ON "+rev+" TO "+rt,"REVOKE TRUNCATE ON "+rev+" FROM "+rt],
      ["witness-xid","GRANT INSERT(xid) ON "+witness+" TO "+rt,"REVOKE INSERT(xid) ON "+witness+" FROM "+rt],
      ["routine-grant-option","GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO "+rt+" WITH GRANT OPTION","REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM "+rt],
      ["table-grant-option","GRANT SELECT ON "+rev+" TO "+inst+" WITH GRANT OPTION","REVOKE GRANT OPTION FOR SELECT ON "+rev+" FROM "+inst],
      ["column-grant-option","GRANT INSERT(signature) ON "+witness+" TO "+rt+" WITH GRANT OPTION","REVOKE GRANT OPTION FOR INSERT(signature) ON "+witness+" FROM "+rt],
      ["unexpected-principal","GRANT SELECT ON "+history+" TO "+extra,"REVOKE SELECT ON "+history+" FROM "+extra],
      ["public-grant","GRANT SELECT ON "+history+" TO PUBLIC","REVOKE SELECT ON "+history+" FROM PUBLIC"],
      ["ownership","ALTER TABLE "+history+" OWNER TO "+rt,"ALTER TABLE "+history+" OWNER TO "+qi(rootRole)],
      ["incoming-membership","GRANT "+rt+" TO "+extra,"REVOKE "+rt+" FROM "+extra],
      ["outgoing-membership","GRANT "+extra+" TO "+rt,"REVOKE "+extra+" FROM "+rt],
      ["default-acl","ALTER DEFAULT PRIVILEGES FOR ROLE "+inst+" GRANT SELECT ON TABLES TO "+rt,"ALTER DEFAULT PRIVILEGES FOR ROLE "+inst+" REVOKE SELECT ON TABLES FROM "+rt],
      ["cross-namespace","CREATE SCHEMA m03_forbidden; GRANT USAGE,CREATE ON SCHEMA m03_forbidden TO "+rt,"DROP SCHEMA m03_forbidden"],
      ["missing-grant","REVOKE INSERT(signature) ON "+witness+" FROM "+rt,"GRANT INSERT(signature) ON "+witness+" TO "+rt],
      ["installer-history-write","GRANT UPDATE ON "+rev+" TO "+inst,"REVOKE UPDATE ON "+rev+" FROM "+inst],
    ];
    for(const [label,drift,restore] of cases)await expectDriftRefused(f,m,"FUNC-01-"+label,async()=>{await f.admin.query(drift);},async()=>{await f.admin.query(restore);});
    const indirect="v3_indirect_"+suffix;
    await createFixtureRole(indirect);
    try{
      await expectDriftRefused(f,m,"FUNC-01-transitive-membership",async()=>{await root.query("GRANT "+qi(indirect)+" TO "+extra+"; GRANT "+extra+" TO "+rt);},async()=>{await root.query("REVOKE "+extra+" FROM "+rt+"; REVOKE "+qi(indirect)+" FROM "+extra);});
    }finally{await root.query("DROP ROLE "+qi(indirect));}
  },120000);
  it("FUNC-02: exact additional SQL semantic drift and restoration",async()=>{
    const f=await lab("funcsem","reference-func-sem"),m=crm(f);
    await apply(f,m,approval(f,null,m));
    const customers=table(f,m,"customers"),deals=table(f,m,"deals"),ix=await relationIndex(f,m),index=qi(f.namespace)+"."+qi(ix.name),canonical="DROP INDEX "+index+"; CREATE INDEX "+qi(ix.name)+" ON "+deals+" (tenant_id, customer)";
    const fk=(await f.admin.query<{name:string}>("SELECT conname AS name FROM pg_constraint WHERE conrelid=$1::regclass AND contype='f'",[deals])).rows[0]!.name;
    const restoreFk="ALTER TABLE "+deals+" DROP CONSTRAINT "+qi(fk)+"; ALTER TABLE "+deals+" ADD CONSTRAINT "+qi(fk)+" FOREIGN KEY (tenant_id,customer) REFERENCES "+customers+" (tenant_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT";
    const cases:[string,string,string][]=[
      ["column-collation","ALTER TABLE "+customers+' ALTER COLUMN code TYPE text COLLATE pg_catalog."C"',"ALTER TABLE "+customers+' ALTER COLUMN code TYPE text COLLATE pg_catalog."default"'],
      ["partial-index","DROP INDEX "+index+"; CREATE INDEX "+qi(ix.name)+" ON "+deals+" (tenant_id,customer) WHERE customer IS NOT NULL",canonical],
      ["expression-index","DROP INDEX "+index+"; CREATE INDEX "+qi(ix.name)+" ON "+deals+" (lower(tenant_id),customer)",canonical],
      ["included-column","DROP INDEX "+index+"; CREATE INDEX "+qi(ix.name)+" ON "+deals+" (tenant_id,customer) INCLUDE(code)",canonical],
      ["null-order","DROP INDEX "+index+"; CREATE INDEX "+qi(ix.name)+" ON "+deals+" (tenant_id NULLS FIRST,customer)",canonical],
      ["fk-action","ALTER TABLE "+deals+" DROP CONSTRAINT "+qi(fk)+"; ALTER TABLE "+deals+" ADD CONSTRAINT "+qi(fk)+" FOREIGN KEY (tenant_id,customer) REFERENCES "+customers+" (tenant_id,id) ON UPDATE CASCADE ON DELETE RESTRICT",restoreFk],
      ["invalid-constraint","ALTER TABLE "+customers+" ADD CONSTRAINT m03_unexpected CHECK (code <> '') NOT VALID","ALTER TABLE "+customers+" DROP CONSTRAINT m03_unexpected"],
      ["unexpected-rule","CREATE RULE m03_unexpected AS ON DELETE TO "+customers+" DO INSTEAD NOTHING","DROP RULE m03_unexpected ON "+customers],
      ["unexpected-user-trigger","CREATE FUNCTION public.m03_unexpected_trigger() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'; REVOKE EXECUTE ON FUNCTION public.m03_unexpected_trigger() FROM PUBLIC; CREATE TRIGGER m03_unexpected BEFORE INSERT ON "+customers+" FOR EACH ROW EXECUTE FUNCTION public.m03_unexpected_trigger()","DROP TRIGGER m03_unexpected ON "+customers+"; DROP FUNCTION public.m03_unexpected_trigger()"],
      ["unexpected-policy","CREATE POLICY m03_unexpected ON "+customers+" USING(true)","DROP POLICY m03_unexpected ON "+customers],
    ];
    for(const [label,drift,restore] of cases)await expectDriftRefused(f,m,"FUNC-02-"+label,async()=>{await f.admin.query(drift);},async()=>{await f.admin.query(restore);});
  },120000);
  it("M03 authorized metadata projection hides fields, resources and relationships",async()=>{
    const f=await lab("introspection","reference-introspection"),m=crm(f);
    await apply(f,m,approval(f,null,m));
    f.reader="v3_intro_"+suffix;await createFixtureRole(f.reader);
    await root.query("GRANT CONNECT ON DATABASE "+qi(f.name)+" TO "+qi(f.reader));
    await f.admin.query("CREATE TABLE public.platform_memberships(application_id text NOT NULL,tenant_id text NOT NULL,principal_id text NOT NULL,active boolean NOT NULL,roles text[] NOT NULL,permissions text[] NOT NULL,PRIMARY KEY(application_id,tenant_id,principal_id))");
    const permissions=["schema.customers.read","schema.customers.name","schema.deals.read","schema.deals.stage","schema.deals.customer","schema.activities.deal"];
    await f.admin.query("INSERT INTO public.platform_memberships VALUES($1,'tenant-a','intro-principal',true,ARRAY['staff'],$2)",[f.scope.applicationId,permissions]);
    await f.admin.query("GRANT SELECT ON public.platform_memberships TO "+qi(f.reader));
    const reader=new Pool({connectionString:dbUrl(f.name,f.reader),max:1});
    const policy=new PolicyEngine(permissions.map(action=>({id:action,action,effect:"allow" as const})));
    const tenantId=asTenantId("tenant-a"),principal={id:asPrincipalId("intro-principal"),kind:"staff" as const,applicationId:f.scope.applicationId,tenantIds:[tenantId],roles:["staff"],permissions};
    const args={...f.scope,authority:f.authority,runner:new TenantUnitOfWork(f.pool),resolver:new PlatformMembershipResolver(reader),policy,policyVersion:"introspection-v1",tenantId,principal,manifestWire:wire(m),
      visibility:{customers:{permission:"schema.customers.read",fields:{name:"schema.customers.name",code:"schema.customers.code"}},deals:{permission:"schema.deals.read",fields:{stage:"schema.deals.stage",customer:"schema.deals.customer"}},activities:{permission:"schema.activities.read",fields:{deal:"schema.activities.deal"}}}};
    try{
      const view=await projectExperimentalResources(args);
      expect(view).toEqual({version:1,resources:[{id:"customers",ownership:"tenant",fields:[{id:"name",type:"text",required:true}]},{id:"deals",ownership:"tenant",fields:[{id:"customer",type:"relation",required:true,targetResource:"customers"},{id:"stage",type:"enum",required:true}]}]});
      const hideTarget=new PolicyEngine([...permissions.map(action=>({id:action,action,effect:"allow" as const})),{id:"deny-customer-resource",action:"schema.customers.read",effect:"deny" as const}]);
      expect(await projectExperimentalResources({...args,policy:hideTarget})).toEqual({version:1,resources:[{id:"deals",ownership:"tenant",fields:[{id:"stage",type:"enum",required:true}]}]});
      await expect(projectExperimentalResources({...args,tenantId:asTenantId("tenant-b")})).rejects.toThrow();
      await expect(projectExperimentalResources({...args,installationId:asInstallationId("wrong-installation")})).rejects.toThrow();
      await expect(projectExperimentalResources({...args,manifestWire:wire(crm(f,"website"))})).rejects.toThrow();
      await f.admin.query("UPDATE public.platform_memberships SET active=false");
      await expect(projectExperimentalResources(args)).rejects.toThrow();
      await f.admin.query("UPDATE public.platform_memberships SET active=true");
      f.authority.beginRecovery();
      await expect(projectExperimentalResources(args)).rejects.toThrow();
      console.info("M03_INTROSPECTION_AUTHORIZED_SCOPED_PROJECTION=PASS");
    }finally{await reader.end();}
  },60000);
  it("J03: independent non-CMS installation and mutual credential isolation",async()=>{
    const f=await lab("inventory","reference-inventory"),m=createSchemaManifest(compileResourceSchema([{...f.scope,id:"assets",ownership:"application",fields:[{id:"code",type:"text",required:true},{id:"label",type:"text",required:true}]}],f.scope));
    await apply(f,m,approval(f,null,m));await check(f,m);
    const other=labs.find(x=>x.scope.applicationId==="reference-crm")!;
    for(const [target,role] of [[f.name,other.runtime],[other.name,f.runtime],[other.name,f.installer],[f.name,other.installer]]){
      const c=new Client({connectionString:dbUrl(target!,role),connectionTimeoutMillis:4000});try{await expect(c.connect()).rejects.toThrow();}finally{await c.end().catch(()=>undefined);}
    }
    for(const [target,role,wrong] of [[f.name,f.runtime,other.runtime],[other.name,other.runtime,f.runtime],[f.name,f.installer,other.installer],[other.name,other.installer,f.installer]]){
      expect(rolePassword(role!)).not.toBe(rolePassword(wrong!));
      const u=new URL(dbUrl(target!,role));u.password=rolePassword(wrong!);
      const c=new Client({connectionString:u.toString(),connectionTimeoutMillis:4000});
      try{await expect(c.connect()).rejects.toMatchObject({code:"28P01"});}finally{await c.end().catch(()=>undefined);}
    }
    const a=table(f,m,"assets");await f.pool.query("INSERT INTO "+a+"(id,code,label) VALUES($1,'asset','Independent')",[randomUUID()]);
    expect((await f.pool.query("SELECT label FROM "+a)).rows).toEqual([{label:"Independent"}]);
    expect(f.namespace).not.toBe(other.namespace);
    console.info("M03_J03_SECOND_APPLICATION=PASS");
  },60000);
  it("J04/J05 subset: actual expansion, competing CAS, catalog drift, lock refusal and immutable history",async()=>{
    const f=labs.find(x=>x.scope.applicationId==="reference-crm")!,old=crm(f),next=crm(f,"website"),alternate=crm(f,"phone"),c=table(f,old,"customers");
    const uow=new TenantUnitOfWork(f.pool),ta=scope(f,"tenant-a");
    await expect(uow.run(ta,tx=>tx.query("SELECT website FROM "+c))).rejects.toMatchObject({code:"42703"});
    const a=approval(f,old,next),b=approval(f,old,alternate);
    await f.admin.query("ALTER TABLE "+c+" ADD COLUMN surprise text");
    try{await expect(apply(f,next,a)).rejects.toThrow();}finally{await f.admin.query("ALTER TABLE "+c+" DROP COLUMN surprise");}
    await f.admin.query("BEGIN");await f.admin.query("SELECT pg_advisory_xact_lock(118033,301)");
    try{await expect(apply(f,next,a)).rejects.toMatchObject({code:"55P03"});}finally{await f.admin.query("ROLLBACK");}
    expect((await f.admin.query("SELECT manifest_digest FROM public.platform_schema_registry")).rows).toEqual([{manifest_digest:old.digest}]);
    await f.admin.query("BEGIN");await f.admin.query("SELECT pg_advisory_xact_lock(118033,301)");
    const race=Promise.allSettled([apply(f,next,a),apply(f,alternate,b)]);
    try{
      let count=0;
      for(let i=0;i<100;i++){
        count=(await root.query<{n:number}>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND wait_event_type='Lock'",[f.name,f.installer])).rows[0]!.n;
        if(count===2)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(count).toBe(2);
    }finally{await f.admin.query("COMMIT");}
    const results=await race;expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    const winner=results[0]?.status==="fulfilled"?next:alternate,field=winner===next?"website":"phone";
    expect((await uow.run(ta,tx=>tx.query("SELECT name FROM "+c))).rows).toEqual([{name:"Alice"}]);
    expect((await uow.run(ta,tx=>tx.query("SELECT "+qi(field)+" AS value FROM "+c))).rows).toEqual([{value:null}]);
    const state=f.authority.authenticatedSnapshot();
    const backfill:ExperimentalBackfillApproval={version:1,installationId:f.scope.installationId,applicationId:f.scope.applicationId,databaseName:f.name,databaseOid:f.oid,epoch:state.epoch,ledgerId:state.ledgerId,authorityHead:state.head,authoritySequence:state.sequence,revision:winner.digest,physicalDigest:compileProvisioningContract(winner,f.scope).digest,operationId:randomUUID(),tenantId:"tenant-a",resourceId:"customers",column:field,value:"backfilled",limit:1};
    const chunk=(e:ExperimentalBackfillApproval)=>{const message=experimentalBackfillMessage(e);return runExperimentalBackfillChunk(dbUrl(f.name,f.installer),message,sign(null,Buffer.from(message),credentials.privateKey).toString("base64url"),f.authority);};
    await expect(chunk({...backfill,column:"name"})).rejects.toThrow();
    expect(await chunk(backfill)).toMatchObject({status:"COMMITTED",affected:1});
    expect(await chunk(backfill)).toMatchObject({status:"ALREADY_COMMITTED",affected:1});
    expect(await chunk({...backfill,operationId:randomUUID()})).toMatchObject({status:"COMMITTED",affected:0});
    expect((await uow.run(ta,tx=>tx.query("SELECT "+qi(field)+" AS value FROM "+c))).rows).toEqual([{value:"backfilled"}]);
    expect((await uow.run(scope(f,"tenant-b"),tx=>tx.query("SELECT "+qi(field)+" AS value FROM "+c))).rows).toEqual([{value:null}]);
    await check(f,winner);
    const history=(await f.admin.query("SELECT revision_digest,parent_digest,authority_epoch FROM public.platform_schema_revisions_v1 ORDER BY applied_at")).rows;
    expect(history).toEqual([{revision_digest:old.digest,parent_digest:null,authority_epoch:f.authority.authenticatedSnapshot().epoch},{revision_digest:winner.digest,parent_digest:old.digest,authority_epoch:f.authority.authenticatedSnapshot().epoch}]);
    const inst=await connect(f.name,f.installer);try{await expect(inst.query("DELETE FROM public.platform_schema_revisions_v1")).rejects.toMatchObject({code:"42501"});}finally{await inst.end();}
    expect(()=>compileProvisioningTransition(winner,old,f.scope)).toThrow();
    console.info("M03_J04_CAS_EXPANSION_AND_DRIFT=PASS");
  },60000);
});


it("J05: actual installer COMMIT acknowledgment loss, durable unknown, authenticated exact committed evidence",async()=>{
  const f=await lab("fault","reference-fault"),m=createSchemaManifest(compileResourceSchema([{...f.scope,id:"assets",ownership:"application",fields:[{id:"code",type:"text",required:true}]}],f.scope)),a=approval(f,null,m);
  const proxy=await startTransactionAckFaultProxy("COMMIT","DROP");void proxy.serverCommitObserved.catch(()=>undefined);
  await prepareLifecycle(f,m,a);
  // The owned lab's proxy listens on an ephemeral loopback port. The installer
  // normally requires 5433, so this is explicitly enabled only in test fixture.
  try{
    const target=new URL(dbUrl(f.name,f.installer));target.port=String(proxy.port);
    const pending=installExperimentalRevision(target.toString(),wire(m),a.message,a.signature,f.authority,proxy.port);
    const failed=pending.then(()=>false,()=>true);
    await Promise.race([proxy.serverCommitObserved,pending.then(()=>{throw Error('fault target unexpectedly succeeded');},error=>{if(!(error instanceof Error)||error.message!=="M03_INSTALLER_COMMIT_UNKNOWN_NO_RETRY")throw error;return proxy.serverCommitObserved;})]);expect(await failed).toBe(true);
    expect(f.authority.authenticatedSnapshot()).toMatchObject({pending:true,provisioningOperations:[{operationId:a.e.operationId,outcome:"UNCERTAIN"}]});
    expect((await f.admin.query("SELECT revision_digest FROM public.platform_schema_revisions_v1")).rows).toEqual([{revision_digest:m.digest}]);
    // The install transaction committed the revision and its DB_COMMITTED
    // lifecycle state, but the activation transaction never ran.
    expect((await f.admin.query("SELECT state,state_version FROM public.platform_schema_revision_states_v1 WHERE installation_id=$1 AND revision_digest=$2",[f.scope.installationId,m.digest])).rows).toEqual([{state:"DB_COMMITTED",state_version:5}]);
    await expect(apply(f,m,a)).rejects.toThrow();
    await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS false");
    try{
      const evidence=await collectExperimentalProvisioningCommit(f.admin,f.authority.authenticatedSnapshot().provisioningOperations!,a.e.operationId);
      const wireEvidence=JSON.stringify(evidence),signature=sign(null,recoveryAdministrationMessage(f.authority.snapshot(),"PROVISIONING_OBSERVED_COMMIT_V1",wireEvidence),adminKeys.privateKey).toString("base64url");
      await expect(f.authority.resolveExperimentalProvisioningCommit(f.admin,wireEvidence,"A".repeat(86))).rejects.toThrow();
      const wrong=JSON.stringify({...evidence,operationId:randomUUID()});
      await expect(f.authority.resolveExperimentalProvisioningCommit(f.admin,wrong,sign(null,recoveryAdministrationMessage(f.authority.snapshot(),"PROVISIONING_OBSERVED_COMMIT_V1",wrong),adminKeys.privateKey).toString("base64url"))).rejects.toThrow();
      await f.authority.resolveExperimentalProvisioningCommit(f.admin,wireEvidence,signature);
      expect(f.authority.authenticatedSnapshot()).toMatchObject({pending:true,provisioningOperations:[{operationId:a.e.operationId,outcome:"COMMITTED"}]});
      await expect(f.authority.resolveExperimentalProvisioningCommit(f.admin,wireEvidence,signature)).rejects.toThrow();
    }finally{await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS true");}
    console.info("M03_J05_AUTHENTICATED_COMMIT_RECONCILIATION=PASS");
  }finally{await proxy.close();}
},60000);


it("J08 subset: genuinely different API/worker artifacts consume expanded CRM and old queued jobs",async()=>{
  const f=await lab("versions","reference-crm"),old=crm(f),next=crm(f,"website");
  await apply(f,old,approval(f,null,old));
  const customer=table(f,old,"customers"),activity=table(f,old,"activities"),uow=new TenantUnitOfWork(f.pool),ta=scope(f,"tenant-a"),customerId=randomUUID();
  await uow.run(ta,tx=>tx.query("INSERT INTO "+customer+"(tenant_id,id,code,name) VALUES('tenant-a',$1,'existing','Existing')",[customerId]));
  f.reader="v3_read_"+suffix;
  await createFixtureRole(f.reader);
  await root.query("GRANT CONNECT ON DATABASE "+qi(f.name)+" TO "+qi(f.reader));
  await f.admin.query("CREATE TABLE public.platform_memberships(application_id text NOT NULL,tenant_id text NOT NULL,principal_id text NOT NULL,active boolean NOT NULL,roles text[] NOT NULL,permissions text[] NOT NULL,PRIMARY KEY(application_id,tenant_id,principal_id))");
  const perms=["crm.customers.read","crm.customers.create"];
  await f.admin.query("INSERT INTO public.platform_memberships VALUES($1,'tenant-a','api-principal',true,ARRAY['staff'],$2)",[f.scope.applicationId,perms]);
  await f.admin.query("INSERT INTO public.platform_memberships VALUES($1,'tenant-a',$2,true,ARRAY['worker'],ARRAY[$3]::text[])",[f.scope.applicationId,referenceProducer,referenceAction]);
  const producerKeys=generateKeyPairSync("ed25519");
  await f.admin.query("GRANT SELECT ON public.platform_memberships TO "+qi(f.reader));
  const token=randomBytes(24).toString("hex"),apiDir=mkdtempSync(path.resolve("apps/platform-reference/.m03-reference-")),workerDir=mkdtempSync(path.resolve("apps/worker/.m03-reference-"));
  const processes:ChildProcess[]=[];
  const queueName="m03-reference-"+suffix,queuePrefix="m03-"+suffix,{queue,events}=referenceQueue(queueName,queuePrefix);
  const env={...process.env,NODE_ENV:"test",M03_NORMATIVE_REFERENCE:"1",M03_APP:f.scope.applicationId,M03_INSTALLATION:f.scope.installationId,
    M03_DATABASE:f.name,M03_OID:f.oid,M03_RUNTIME_ROLE:f.runtime,M03_RUNTIME_URL:dbUrl(f.name,f.runtime),M03_MEMBERSHIP_URL:dbUrl(f.name,f.reader),
    M03_NAMESPACE:f.namespace,M03_CUSTOMERS:old.resources.find(x=>x.id==="customers")!.tableName,M03_ACTIVITIES:old.resources.find(x=>x.id==="activities")!.tableName,
    M03_QUEUE:queueName,M03_QUEUE_PREFIX:queuePrefix,M03_JOB_PRODUCER_KEY:producerKeys.publicKey.export({format:"der",type:"spki"}).toString("base64"),M03_TOKENS:JSON.stringify({[token]:{id:"api-principal",kind:"staff",tenantIds:["tenant-a"],roles:["staff"],permissions:perms}})};
  const artifacts:Record<string,string>={};
  const artifact=async(kind:"api"|"worker",version:1|2)=>{
    const file=path.join(kind==="api"?apiDir:workerDir,kind+"-"+version+".cjs"),entry=kind==="api"?"apps/platform-reference/test-fixtures/m03-normative-api.ts":"apps/worker/test-fixtures/m03-normative-worker.ts";
    await build({entryPoints:[entry],outfile:file,bundle:true,platform:"node",format:"cjs",target:"node24",external:["pg","fastify","bullmq"],define:{M03_SCHEMA_VERSION:String(version)},logLevel:"silent"});
    artifacts[kind+version]=createHash("sha256").update(readFileSync(file)).digest("hex");return file;
  };
  const start=async(file:string)=>{
    const child=fork(file,[],{env,stdio:["ignore","ignore","ignore","ipc"]});processes.push(child);
    const result=await new Promise<{kind:string;version:number;port?:number}>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error("reference ready timeout")),15000);
      child.once("message",value=>{clearTimeout(timeout);resolve(value as {kind:string;version:number;port?:number});});
      child.once("exit",code=>{clearTimeout(timeout);reject(Error("reference exited before readiness "+code));});
    });
    return {child,...result};
  };
  const stop=async(child:ChildProcess)=>{if(child.exitCode!==null||child.signalCode!==null)return;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{child.kill("SIGKILL");reject(Error("reference shutdown timeout"));},10000);child.once("exit",()=>{clearTimeout(timer);resolve();});child.kill("SIGTERM");});};
  const headers={authorization:"Bearer "+token,"x-tenant-id":"tenant-a","content-type":"application/json"};
  const list=async(port:number,tenant="tenant-a")=>fetch("http://127.0.0.1:"+port+"/crm/customers",{headers:{...headers,"x-tenant-id":tenant}});
  const signed=(job:Omit<ReferenceJob,"signature">,key=producerKeys.privateKey):ReferenceJob=>({...job,signature:sign(null,Buffer.from(referenceJobMessage(job)),key).toString("base64url")});
  const jobData=(version:1|2,nonce:string,overrides:Partial<ReferenceWork>={})=>{
    const work:ReferenceWork={version,applicationId:f.scope.applicationId,installationId:f.scope.installationId,tenantId:"tenant-a",producer:referenceProducer,action:referenceAction,nonce,customerId,website:version===2?"https://example.invalid":null,...overrides};
    return signed({...work,operationId:referenceOperationId(work),expiresAt:Date.now()+120000});
  };
  try{
    await events.waitUntilReady();
    const a1=await artifact("api",1),a2=await artifact("api",2),w1=await artifact("worker",1),w2=await artifact("worker",2);
    expect(artifacts.api1).not.toBe(artifacts.api2);expect(artifacts.worker1).not.toBe(artifacts.worker2);
    const oldApi=await start(a1);expect(oldApi.kind).toBe("ready");
    const oldWorker=await start(w1);expect(oldWorker.kind).toBe("ready");
    expect(await (await list(oldApi.port!)).json()).toMatchObject({version:1,customers:[{name:"Existing"}]});
    expect((await list(oldApi.port!,"tenant-b")).status).toBe(403);
    expect((await start(a2)).kind).toBe("refused");expect((await start(w2)).kind).toBe("refused");
    const firstId=randomUUID(),first=await queue.add("activity",jobData(1,firstId),{attempts:2});
    expect(await first.waitUntilFinished(events,15000)).toEqual({version:1,effect:"APPLIED"});
    await stop(oldWorker.child);
    const queued=await queue.add("activity",jobData(1,randomUUID()),{attempts:2});
    await apply(f,next,approval(f,old,next));
    expect(await (await list(oldApi.port!)).json()).toMatchObject({version:1,customers:[{name:"Existing"}]});
    const newApi=await start(a2),newWorker=await start(w2);expect(newApi.kind).toBe("ready");expect(newWorker.kind).toBe("ready");
    expect(await queued.waitUntilFinished(events,15000)).toEqual({version:2,effect:"APPLIED"});
    expect(await (await list(newApi.port!)).json()).toMatchObject({version:2,customers:[{name:"Existing",website:null}]});
    const effect=randomUUID(),job=await queue.add("activity",jobData(2,effect),{attempts:2});
    expect(await job.waitUntilFinished(events,15000)).toEqual({version:2,effect:"APPLIED"});
    const duplicate=await queue.add("activity",jobData(2,effect));
    expect(await duplicate.waitUntilFinished(events,15000)).toEqual({version:2,effect:"ALREADY_APPLIED"});
    const original=jobData(2,effect),changed=signed({...original,website:"https://changed.invalid"}),forged={...original,tenantId:"tenant-b"},wrongKey=signed(original,generateKeyPairSync("ed25519").privateKey);
    const refused=[changed,forged,wrongKey,jobData(2,randomUUID(),{tenantId:"tenant-b"}),signed({...original,expiresAt:Date.now()-1})];
    for(const payload of refused){
      const bad=await queue.add("activity",payload);
      await expect(bad.waitUntilFinished(events,15000)).rejects.toThrow();
    }
    await f.admin.query("UPDATE public.platform_memberships SET active=false WHERE principal_id=$1",[referenceProducer]);
    try{
      const revoked=await queue.add("activity",jobData(2,randomUUID()));
      await expect(revoked.waitUntilFinished(events,15000)).rejects.toThrow();
    }finally{await f.admin.query("UPDATE public.platform_memberships SET active=true WHERE principal_id=$1",[referenceProducer]);}
    console.info("M03_JOB_SIGNED_AUTHORIZATION_AND_PAYLOAD_BINDING=PASS");
    expect((await uow.run(ta,tx=>tx.query("SELECT count(*)::int AS n FROM "+activity))).rows).toEqual([{n:3}]);
    expect(await (await list(newApi.port!)).json()).toMatchObject({customers:[{website:"https://example.invalid"}]});
    const created=await fetch("http://127.0.0.1:"+oldApi.port+"/crm/customers",{method:"POST",headers,body:JSON.stringify({code:"legacy-write",name:"Old version"})});expect(created.status).toBe(200);
    const created2=await fetch("http://127.0.0.1:"+newApi.port+"/crm/customers",{method:"POST",headers,body:JSON.stringify({code:"new-write",name:"New version",website:"https://new.invalid"})});expect(created2.status).toBe(200);
    await stop(newWorker.child);
    const restarted=await start(w1);expect(restarted.kind).toBe("ready");
    const unsupported=await queue.add("activity",jobData(2,randomUUID()));
    await expect(unsupported.waitUntilFinished(events,15000)).rejects.toThrow();
    await stop(restarted.child);await stop(oldApi.child);await stop(newApi.child);
    console.info("M03_J08_REFERENCE_ARTIFACTS "+JSON.stringify({sha:process.env.GITHUB_SHA??"local",artifacts,oldContract:compileProvisioningContract(old,f.scope).digest,newContract:compileProvisioningContract(next,f.scope).digest,jobVersions:[1,2]}));
  }finally{
    for(const child of processes)await stop(child).catch(()=>undefined);
    await queue.obliterate({force:true});await events.close();await queue.close();
    rmSync(apiDir,{recursive:true,force:true});rmSync(workerDir,{recursive:true,force:true});
  }
},120000);

// Reuses the actual PG16 basebackup/archived WAL/restore harness; never runs
// in the ordinary disposable job or any non-owned environment.
describe.skipIf(process.env.M03_NORMATIVE_PHYSICAL!=="1")("M03 normative physical reattestation",()=>{
  it("NORM-PHY: historical signed revisions and data survive physical restore or rewind fails closed",async()=>{
    if(process.env.GITHUB_ACTIONS!=="true"||process.env.M03_PHYSICAL_CONTAINER!=="vibress-m03-physical-ci"||process.env.M03_PHYSICAL_COMPONENT!=="1")throw Error("owned CI physical cluster required");
    const rewind=process.env.M03_NORMATIVE_REWIND==="1";
    const physical=(...args:string[])=>{const x=spawnSync("bash",["tests/fixtures/m03-actual-physical-cluster.sh",...args],{encoding:"utf8",timeout:120000});if(x.status!==0)throw Error("physical helper failed: "+args[0]);console.info(x.stdout.trim());};
    const f=await lab("physical","reference-crm"),old=crm(f),next=crm(f,"website");
    const first=approval(f,null,old);await apply(f,old,first);
    const c=table(f,old,"customers"),uow=new TenantUnitOfWork(f.pool),id=randomUUID();
    await uow.run(scope(f,"tenant-a"),tx=>tx.query("INSERT INTO "+c+"(tenant_id,id,code,name) VALUES('tenant-a',$1,'old','Original')",[id]));
    physical("backup");
    await root.query("SELECT pg_create_restore_point('vibress_component_padding')");await root.query("SELECT pg_switch_wal()");
    const target=async()=>(await root.query<{segment:string}>("SELECT pg_walfile_name(pg_create_restore_point('vibress_component_target')) AS segment")).rows[0]!.segment;
    let segment=rewind?await target():"";
    const second=approval(f,old,next);await apply(f,next,second);
    await uow.run(scope(f,"tenant-a"),tx=>tx.query("UPDATE "+c+" SET website='preserved' WHERE id=$1",[id]));
    const history=(await f.admin.query("SELECT revision_digest,operation_id,authority_epoch FROM public.platform_schema_revisions_v1 ORDER BY applied_at")).rows;
    // Quiescent before signed observation. Root connects to the maintenance DB.
    await f.pool.end();await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS false");
    f.authority.beginRecovery();
    const checkpoint=await collectExperimentalProvisioningCheckpoint(f.admin,f.authority.authenticatedSnapshot().provisioningOperations!,second.e.operationId);
    const checkpointWire=JSON.stringify(checkpoint);
    const authorize=(action:string,message:string)=>sign(null,recoveryAdministrationMessage(f.authority.snapshot(),action,message),adminKeys.privateKey).toString("base64url");
    await f.authority.recordExperimentalProvisioningCheckpoint(f.admin,checkpointWire,authorize("PROVISIONING_CHECKPOINT_V1",checkpointWire));
    if(!rewind)segment=await target();
    await root.query("SELECT pg_switch_wal()");physical("archive",segment);
    const prior=f.authority.authenticatedSnapshot();
    f.authority.close();await f.admin.end();await root.end();
    physical("restore","");
    root=await connect("vibress");
    await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS true");
    f.admin=await connect(f.name);f.pool=new Pool({connectionString:dbUrl(f.name,f.runtime),max:1});
    await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS false");
    f.authority=DisposableDurableRecoveryAuthority.open(f.dir,epochKeys.privateKey,f.anchor,adminKeys.publicKey);
    expect(f.authority.authenticatedSnapshot()).toEqual(prior);
    if(rewind){
      expect((await f.admin.query("SELECT count(*)::int AS n FROM public.platform_schema_revisions_v1")).rows).toEqual([{n:1}]);
      await expect(collectExperimentalProvisioningCheckpoint(f.admin,prior.provisioningOperations!,second.e.operationId,true)).rejects.toThrow();
      expect(f.authority.authenticatedSnapshot().pending).toBe(true);
      console.info("M03_J06_PHYSICAL_REWIND_REFUSED=PASS");return;
    }
    const observed=await collectExperimentalProvisioningCheckpoint(f.admin,prior.provisioningOperations!,second.e.operationId,true);
    expect(observed.timeline).toBeGreaterThan(checkpoint.timeline);
    const newEpoch=randomUUID(),approvalId=randomUUID(),good=JSON.stringify({version:1,newEpoch,approvalId,intent:prior.intent,previous:checkpoint,observed});
    await expect(f.authority.reattestExperimentalProvisioningRecovery(f.admin,good,"A".repeat(86))).rejects.toThrow();
    const wrong=JSON.stringify({version:1,newEpoch,approvalId,intent:prior.intent,previous:checkpoint,observed:{...observed,databaseOid:"1"}});
    await expect(f.authority.reattestExperimentalProvisioningRecovery(f.admin,wrong,authorize("PROVISIONING_REATTEST_V1",wrong))).rejects.toThrow();
    await f.authority.reattestExperimentalProvisioningRecovery(f.admin,good,authorize("PROVISIONING_REATTEST_V1",good));
    expect(f.authority.authenticatedSnapshot()).toMatchObject({pending:true,epoch:newEpoch,provisioningOperations:prior.provisioningOperations});
    expect((await f.admin.query("SELECT revision_digest,operation_id,authority_epoch FROM public.platform_schema_revisions_v1 ORDER BY applied_at")).rows).toEqual(history);
    expect((await f.admin.query("SELECT original_epoch,new_epoch,original_operation_id FROM public.platform_schema_recovery_reattestations_v1")).rows).toEqual([{original_epoch:checkpoint.epoch,new_epoch:newEpoch,original_operation_id:second.e.operationId}]);
    await expect(f.authority.reattestExperimentalProvisioningRecovery(f.admin,good,authorize("PROVISIONING_REATTEST_V1",good))).rejects.toThrow();
    const after=f.authority.authenticatedSnapshot();f.authority.close();f.authority=DisposableDurableRecoveryAuthority.open(f.dir,epochKeys.privateKey,f.anchor,adminKeys.publicKey);expect(f.authority.authenticatedSnapshot()).toEqual(after);
    console.info("M03_J06_PHYSICAL_REATTESTATION=PASS");
  },300000);
});


it("J07: bounded signed business outcome, real commit/rollback and lost acknowledgements",async()=>{
  for(const lost of ["COMMIT","ROLLBACK"] as const){
    const f=await lab("business_"+lost.toLowerCase(),"reference-crm"),m=crm(f);
    await apply(f,m,approval(f,null,m));
    const sc=scope(f,"tenant-a"),uow=new TenantUnitOfWork(f.pool),c=table(f,m,"customers");
    const signed=(code:string,rowId=randomUUID())=>{
      const state=f.authority.authenticatedSnapshot();
      const e:BusinessApproval={version:1,operationId:randomUUID(),applicationId:f.scope.applicationId,installationId:f.scope.installationId,databaseName:f.name,databaseOid:f.oid,epoch:state.epoch,ledgerId:state.ledgerId,authorityHead:state.head,authoritySequence:state.sequence,revision:m.digest,physicalDigest:compileProvisioningContract(m,f.scope).digest,tenantId:"tenant-a",principalId:"fixture-principal",rowId,code,name:"Business customer"};
      const message=experimentalBusinessMessage(e);return {e,message,signature:sign(null,Buffer.from(message),credentials.privateKey).toString("base64url")};
    };
    const run=(a:ReturnType<typeof signed>,runner=uow)=>f.authority.runExperimentalProvisionedBusiness(runner,sc,wire(m),a.message,a.signature);
    // The runtime can insert a signed witness but cannot read, change or choose its xid.
    for(const statement of [
      "SELECT * FROM public.platform_schema_business_witnesses_v1",
      "UPDATE public.platform_schema_business_witnesses_v1 SET evidence='forged'",
      "DELETE FROM public.platform_schema_business_witnesses_v1",
      "INSERT INTO public.platform_schema_business_witnesses_v1(operation_id,xid,evidence,signature) VALUES(gen_random_uuid(),'1'::xid8,'forged','forged')",
    ])await expect(f.pool.query(statement)).rejects.toMatchObject({code:"42501"});
    const beforeDrift=f.authority.authenticatedSnapshot();
    await f.admin.query("GRANT UPDATE(manifest) ON public.platform_schema_revisions_v1 TO "+qi(f.runtime));
    try{
      await expect(run(signed("acl-drift"))).rejects.toThrow("PROTECTED_ACL_V1");
      expect(f.authority.authenticatedSnapshot()).toEqual(beforeDrift);
    }finally{await f.admin.query("REVOKE UPDATE(manifest) ON public.platform_schema_revisions_v1 FROM "+qi(f.runtime));}
    expect(await check(f,m)).toBe(compileProvisioningContract(m,f.scope).digest);
    console.info("M03_BUSINESS_PROTECTED_ACL_ADMISSION=PASS");
    const normal=signed("known");
    await expect(run({...normal,signature:"A".repeat(86)})).rejects.toThrow();
    expect(await run(normal)).toMatchObject({status:"COMMITTED"});
    await expect(run(normal)).rejects.toThrow();
    const duplicate=signed("known");
    await expect(run(duplicate)).rejects.toThrow();
    expect(f.authority.authenticatedSnapshot().provisionedBusinessOperations?.map(x=>x.outcome)).toEqual(["COMMITTED","ROLLED_BACK"]);
    const a=signed(lost==="ROLLBACK"?"known":"lost");
    const proxy=await startStatementAckFaultProxy(lost,"DROP");void proxy.serverCommitObserved.catch(()=>undefined);
    const target=new URL(dbUrl(f.name,f.runtime));target.port=String(proxy.port);
    const pool=new Pool({connectionString:target.toString(),max:1,connectionTimeoutMillis:4000,query_timeout:15000});
    const transportErrors:string[]=[];
    let signalTransport!:()=>void;
    const transportObserved=new Promise<void>(resolve=>{signalTransport=resolve;});
    const observeTransport=(error:Error)=>{transportErrors.push(error.message);signalTransport();};
    pool.on("connect",client=>client.on("error",observeTransport));
    pool.on("error",observeTransport);
    try{
      const task=run(a,new TenantUnitOfWork(pool));
      await Promise.all([expect(task).rejects.toThrow(),proxy.serverCommitObserved]);
      await transportObserved;
      expect(transportErrors.length).toBeGreaterThan(0);
      expect(transportErrors.every(message=>/connection terminated|socket|ECONNRESET/i.test(message))).toBe(true);
    }finally{await pool.end();await proxy.close();}
    expect(f.authority.authenticatedSnapshot()).toMatchObject({pending:true,businessLease:a.e.operationId});
    const retained=f.authority.authenticatedSnapshot();
    f.authority.close();f.authority=DisposableDurableRecoveryAuthority.open(f.dir,epochKeys.privateKey,f.anchor,adminKeys.publicKey);
    expect(f.authority.authenticatedSnapshot()).toEqual(retained);
    await expect(run(signed("late"))).rejects.toThrow();
    await f.pool.end();f.pool=new Pool({connectionString:dbUrl(f.name,f.runtime),max:1});
    await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS false");
    try{
      const p=f.authority.authenticatedSnapshot().provisionedBusinessOperations!.at(-1)!;
      const observed=await collectExperimentalBusinessOutcome(f.admin,p,epochKeys.publicKey),message=JSON.stringify(observed);
      expect(observed.outcome).toBe(lost==="COMMIT"?"COMMITTED":"ROLLED_BACK");
      const authorize=(value:string)=>sign(null,recoveryAdministrationMessage(f.authority.snapshot(),"PROVISIONED_BUSINESS_OBSERVED_V1",value),adminKeys.privateKey).toString("base64url");
      await expect(f.authority.resolveExperimentalProvisionedBusiness(f.admin,message,"A".repeat(86))).rejects.toThrow();
      const wrong=JSON.stringify({...observed,operationId:randomUUID()});
      await expect(f.authority.resolveExperimentalProvisionedBusiness(f.admin,wrong,authorize(wrong))).rejects.toThrow();
      await f.authority.resolveExperimentalProvisionedBusiness(f.admin,message,authorize(message));
      expect(f.authority.authenticatedSnapshot().businessLease).toBeUndefined();
      expect(f.authority.authenticatedSnapshot().pending).toBe(true);
      await expect(f.authority.resolveExperimentalProvisionedBusiness(f.admin,message,authorize(message))).rejects.toThrow();
      const count=(await f.admin.query<{n:number}>("SELECT count(*)::int AS n FROM "+c+" WHERE id=$1",[a.e.rowId])).rows[0]!.n;
      expect(count).toBe(lost==="COMMIT"?1:0);
    }finally{await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS true");}
    console.info("M03_J07_BUSINESS_"+lost+"_ACK_RECONCILIATION=PASS");
  }
},120000);

it("A01/J02: exact typed columns, bounded CHECKs, value refusal and additive evolution on real PostgreSQL",async()=>{
  const f=await lab("typed","reference-typed-types");
  const fields:readonly FieldDefinition[]=[
    {id:"code",type:"text",required:true},
    {id:"quantity",type:"integer",required:true},
    {id:"rate",type:"decimal",precision:9,scale:2,required:false},
    {id:"total",type:"money",required:true},
    {id:"attributes",type:"json",maxBytes:512,required:false},
    {id:"reference",type:"text",maxLength:12,required:false},
    {id:"due",type:"date",required:false},
    {id:"cover",type:"media",maxBytes:4096,maxDepth:8,maxKeys:1000,required:false},
    {id:"summary",type:"localized",maxBytes:2048,maxDepth:8,maxKeys:1000,required:true},
  ];
  const invoices=(extension:readonly FieldDefinition[]=[])=>createSchemaManifest(compileResourceSchema([
    {...f.scope,id:"invoices",ownership:"tenant",fields:[...fields,...extension]},
  ],f.scope));
  const m=invoices(),plan=compileProvisioningTransition(null,m,f.scope),t=table(f,m,"invoices");
  expect(provisioningProfileFor(m)).toBe(PROVISIONING_PROFILE_V2);
  expect(provisioningProfileFor(crm(f))).toBe(PROVISIONING_PROFILE);
  await expect(apply(f,m,approval(f,null,m,{profile:PROVISIONING_PROFILE}))).rejects.toThrow();
  await apply(f,m,approval(f,null,m));
  expect(await check(f,m)).toBe(plan.physical.digest);
  const columns=(await f.admin.query<{column_name:string;type:string;required:boolean}>("SELECT a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required FROM pg_attribute a WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",[t])).rows;
  expect(columns).toEqual(expect.arrayContaining([
    {column_name:"quantity",type:"integer",required:true},
    {column_name:"rate",type:"numeric(9,2)",required:false},
    {column_name:"total",type:"numeric(19,2)",required:true},
    {column_name:"total_currency",type:"text",required:true},
    {column_name:"attributes",type:"jsonb",required:false},
    {column_name:"reference",type:"text",required:false},
    {column_name:"due",type:"date",required:false},
    {column_name:"cover",type:"jsonb",required:false},
    {column_name:"summary",type:"jsonb",required:true},
  ]));
  const constraints=(await f.admin.query<{conname:string;def:string}>("SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c' ORDER BY conname",[t])).rows;
  const definitions=constraints.map(row=>row.def).join("\n");
  expect(definitions).toContain("total_currency ~ '^[A-Z]{3}$'::text");
  expect(definitions).toContain("pg_column_size(attributes) <= 512");
  expect(definitions).toContain("char_length(reference) <= 12");
  expect(definitions).toContain("COALESCE((cover ->> 'id'::text), ''::text) ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'::text");
  expect(definitions).toContain("jsonb_typeof(summary) = 'object'::text");
  expect(constraints).toHaveLength(5);
  const uow=new TenantUnitOfWork(f.pool),ta=scope(f,"tenant-a"),tb=scope(f,"tenant-b"),id=randomUUID();
  await uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,rate,total,total_currency,attributes,reference,due,cover,summary) VALUES($1,$2,'inv',7,12.34,120.50,'USD','{\"a\":1}'::jsonb,'REF-1','2028-02-29','{\"id\":\"med_a\",\"alt\":\"A\"}'::jsonb,'{\"en\":\"Hello\",\"ar\":\"مرحبا\"}'::jsonb)",["tenant-a",id]));
  expect((await uow.run(ta,tx=>tx.query("SELECT quantity,rate::text AS rate,total::text AS total,total_currency,attributes,reference,due::text AS due,cover,summary FROM "+t+" WHERE id=$1",[id]))).rows).toEqual([{quantity:7,rate:"12.34",total:"120.50",total_currency:"USD",attributes:{a:1},reference:"REF-1",due:"2028-02-29",cover:{id:"med_a",alt:"A"},summary:{en:"Hello",ar:"مرحبا"}}]);
  expect((await uow.run(tb,tx=>tx.query("SELECT count(*)::int AS n FROM "+t))).rows).toEqual([{n:0}]);
  await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,total,total_currency) VALUES('tenant-b',$1,'cross',1,1,'USD')",[randomUUID()]))).rejects.toMatchObject({code:"42501"});
  await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,total,total_currency,summary) VALUES('tenant-a',$1,'bad',1,1,'usd','{}')",[randomUUID()]))).rejects.toMatchObject({code:"23514"});
  await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,total,total_currency,summary) VALUES('tenant-a',$1,'bad',2147483648,1,'USD','{}')",[randomUUID()]))).rejects.toMatchObject({code:"22003"});
  await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,total,total_currency,summary) VALUES('tenant-a',$1,'bad',1,99999999999999999999.00,'USD','{}')",[randomUUID()]))).rejects.toMatchObject({code:"22003"});
  await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,total,total_currency,attributes,summary) VALUES('tenant-a',$1,'bad',1,1,'USD',$2::jsonb,'{}')",[randomUUID(),JSON.stringify({a:"x".repeat(600)})]))).rejects.toMatchObject({code:"23514"});
  await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,total,total_currency,reference,summary) VALUES('tenant-a',$1,'bad',1,1,'USD','REF-TOO-LONG!','{}')",[randomUUID()]))).rejects.toMatchObject({code:"23514"});
  await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,total,total_currency,due,summary) VALUES('tenant-a',$1,'bad',1,1,'USD','2026-02-30','{}')",[randomUUID()]))).rejects.toMatchObject({code:"22008"});
  await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,total,total_currency,summary,cover) VALUES('tenant-a',$1,'bad',1,1,'USD','{}','{\"url\":\"/media/a.png\"}')",[randomUUID()]))).rejects.toMatchObject({code:"23514"});
  await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,total,total_currency,summary,cover) VALUES('tenant-a',$1,'bad',1,1,'USD','{}','\"just-a-string\"')",[randomUUID()]))).rejects.toMatchObject({code:"23514"});
  await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,total,total_currency,summary) VALUES('tenant-a',$1,'bad',1,1,'USD','[\"en\"]')",[randomUUID()]))).rejects.toMatchObject({code:"23514"});
  await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+t+"(tenant_id,id,code,quantity,total,total_currency,summary) VALUES('tenant-a',$1,'bad',1,1,'USD',$2::jsonb)",[randomUUID(),JSON.stringify({en:"x".repeat(2100)})]))).rejects.toMatchObject({code:"23514"});
  const jsonConstraint=constraints.find(row=>row.def.includes("pg_column_size(attributes)"))!.conname;
  await f.admin.query("ALTER TABLE "+t+" DROP CONSTRAINT "+qi(jsonConstraint));
  try{await expect(check(f,m)).rejects.toThrow();}
  finally{await f.admin.query("ALTER TABLE "+t+" ADD CONSTRAINT "+qi(jsonConstraint)+" CHECK (pg_column_size(\"attributes\") <= 512)");}
  expect(await check(f,m)).toBe(plan.physical.digest);
  const next=invoices([{id:"notes",type:"text",required:false}]);
  await apply(f,next,approval(f,m,next));
  expect(await check(f,next)).toBe(compileProvisioningContract(next,f.scope).digest);
  expect((await uow.run(ta,tx=>tx.query("SELECT quantity,total::text AS total,notes FROM "+t+" WHERE id=$1",[id]))).rows).toEqual([{quantity:7,total:"120.50",notes:null}]);
  expect(()=>compileProvisioningTransition(next,invoices([{id:"bounded",type:"text",maxLength:5,required:false}]),f.scope)).toThrow();
  console.info("M03_A01_TYPED_COLUMNS_BOUNDS_EVOLUTION=PASS");
},120000);


// Physical recovery must never convert a missing business witness into rollback.
describe.skipIf(process.env.M03_NORMATIVE_BUSINESS_PHYSICAL!=="1")("M03 normative business physical outcomes",()=>{
  it("NORM-PHY: lost business COMMIT is observed only with retained signed witness after PITR",async()=>{
    if(process.env.GITHUB_ACTIONS!=="true"||process.env.M03_PHYSICAL_CONTAINER!=="vibress-m03-physical-ci"||process.env.M03_PHYSICAL_COMPONENT!=="1")throw Error("owned CI physical cluster required");
    const rewind=process.env.M03_NORMATIVE_REWIND==="1";
    const physical=(...args:string[])=>{const x=spawnSync("bash",["tests/fixtures/m03-actual-physical-cluster.sh",...args],{encoding:"utf8",timeout:120000});if(x.status!==0)throw Error("physical helper failed: "+args[0]);console.info(x.stdout.trim());};
    const f=await lab("business_physical","reference-crm"),m=crm(f);
    await apply(f,m,approval(f,null,m));
    physical("backup");
    await root.query("SELECT pg_create_restore_point('vibress_component_padding')");await root.query("SELECT pg_switch_wal()");
    const target=async()=>(await root.query<{segment:string}>("SELECT pg_walfile_name(pg_create_restore_point('vibress_component_target')) AS segment")).rows[0]!.segment;
    let segment=rewind?await target():"";
    const sc=scope(f,"tenant-a"),state=f.authority.authenticatedSnapshot();
    const e:BusinessApproval={version:1,operationId:randomUUID(),applicationId:f.scope.applicationId,installationId:f.scope.installationId,databaseName:f.name,databaseOid:f.oid,epoch:state.epoch,ledgerId:state.ledgerId,authorityHead:state.head,authoritySequence:state.sequence,revision:m.digest,physicalDigest:compileProvisioningContract(m,f.scope).digest,tenantId:"tenant-a",principalId:"fixture-principal",rowId:randomUUID(),code:"physical",name:"Physical witness"};
    const message=experimentalBusinessMessage(e),signature=sign(null,Buffer.from(message),credentials.privateKey).toString("base64url");
    const proxy=await startStatementAckFaultProxy("COMMIT","DROP");void proxy.serverCommitObserved.catch(()=>undefined);
    const u=new URL(dbUrl(f.name,f.runtime));u.port=String(proxy.port);
    const pool=new Pool({connectionString:u.toString(),max:1,connectionTimeoutMillis:4000,query_timeout:15000});
    const transportErrors:string[]=[];
    let signalTransport!:()=>void;
    const transportObserved=new Promise<void>(resolve=>{signalTransport=resolve;});
    const observeTransport=(error:Error)=>{transportErrors.push(error.message);signalTransport();};
    pool.on("connect",client=>client.on("error",observeTransport));pool.on("error",observeTransport);
    try{
      const task=f.authority.runExperimentalProvisionedBusiness(new TenantUnitOfWork(pool),sc,wire(m),message,signature);
      await Promise.all([expect(task).rejects.toThrow(),proxy.serverCommitObserved]);
      await transportObserved;
      expect(transportErrors.length).toBeGreaterThan(0);
      expect(transportErrors.every(x=>/connection terminated|socket|ECONNRESET/i.test(x))).toBe(true);
    }finally{await pool.end();await proxy.close();}
    const prior=f.authority.authenticatedSnapshot(),record=prior.provisionedBusinessOperations!.at(-1)!;
    expect(record).toMatchObject({operationId:e.operationId,outcome:"UNCERTAIN"});
    expect(prior).toMatchObject({pending:true,businessLease:e.operationId});
    expect((await f.admin.query("SELECT operation_id FROM public.platform_schema_business_witnesses_v1")).rows).toEqual([{operation_id:e.operationId}]);
    await f.pool.end();await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS false");
    if(!rewind)segment=await target();
    await root.query("SELECT pg_switch_wal()");physical("archive",segment);
    f.authority.close();await f.admin.end();await root.end();
    physical("restore","");
    root=await connect("vibress");await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS true");
    f.admin=await connect(f.name);f.pool=new Pool({connectionString:dbUrl(f.name,f.runtime),max:1});
    await root.query("ALTER DATABASE "+qi(f.name)+" ALLOW_CONNECTIONS false");
    f.authority=DisposableDurableRecoveryAuthority.open(f.dir,epochKeys.privateKey,f.anchor,adminKeys.publicKey);
    expect(f.authority.authenticatedSnapshot()).toEqual(prior);
    const count=(await f.admin.query<{n:number}>("SELECT count(*)::int AS n FROM "+table(f,m,"customers")+" WHERE id=$1",[e.rowId])).rows[0]!.n;
    expect(count).toBe(rewind?0:1);
    if(rewind){
      expect((await f.admin.query("SELECT operation_id FROM public.platform_schema_business_witnesses_v1")).rows).toEqual([]);
      await expect(collectExperimentalBusinessOutcome(f.admin,record,epochKeys.publicKey)).rejects.toThrow();
      expect(f.authority.authenticatedSnapshot()).toEqual(prior);
      console.info("M03_J07_PHYSICAL_REWIND_UNCERTAIN_REFUSED=PASS");return;
    }
    const observed=await collectExperimentalBusinessOutcome(f.admin,record,epochKeys.publicKey);
    expect(observed.outcome).toBe("COMMITTED");expect(observed.timeline).toBeGreaterThan(record.timeline);
    expect(observed.xidStatus).toBeNull();expect(observed.witnessDigest).toMatch(/^[a-f0-9]{64}$/);
    const observation=JSON.stringify(observed),authorize=()=>sign(null,recoveryAdministrationMessage(f.authority.snapshot(),"PROVISIONED_BUSINESS_OBSERVED_V1",observation),adminKeys.privateKey).toString("base64url");
    await f.authority.resolveExperimentalProvisionedBusiness(f.admin,observation,authorize());
    expect(f.authority.authenticatedSnapshot().businessLease).toBeUndefined();
    expect(f.authority.authenticatedSnapshot().pending).toBe(true);
    expect(f.authority.authenticatedSnapshot().provisionedBusinessOperations!.at(-1)!.outcome).toBe("COMMITTED");
    await expect(f.authority.resolveExperimentalProvisionedBusiness(f.admin,observation,authorize())).rejects.toThrow();
    console.info("M03_J07_PHYSICAL_COMMIT_RECONCILIATION=PASS");
  },300000);
});
