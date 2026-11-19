// @vitest-environment node
import {generateKeyPairSync,randomBytes,randomUUID,sign} from "node:crypto";
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {Client,Pool} from "pg";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {asApplicationId,asInstallationId,asPrincipalId,asTenantId} from "@vibress/platform-kernel";
import {TenantUnitOfWork,verifyTenantScope} from "@vibress/tenancy";
import {
  compileProvisioningContract,
  compileProvisioningTransition,
  compileResourceSchema,
  createSchemaManifest,
  dynamicRecordRevision,
  planSchemaChanges,
  provisioningIdentifier as qi,
  provisioningProfileFor,
  PROVISIONING_PROFILE_V3,
  type DynamicRecordProfile,
  type ResourceDefinition,
  type SchemaCompilationScope,
  type SchemaManifest,
} from "../../packages/schema-engine/src";
import {reserveExperimentalNamespace,installExperimentalRevision,verifyExperimentalProvisionedCatalog,provisioningApprovalMessage,type ProvisioningApproval} from "../../packages/database/src/schema-operator-experimental-installer";
import {DisposableDurableRecoveryAuthority} from "../../packages/database/src/schema-operator-experimental-durable-authority";
import {FileExperimentalRecoveryAnchor} from "../../packages/database/src/schema-operator-experimental-anchor";
import {recordExperimentalLifecycleTransition,type LifecycleState} from "../../packages/database/src/schema-operator-experimental-registry-lifecycle";
import {openExperimentalDynamicResource} from "../../packages/database/src/schema-operator-experimental-dynamic-resource";

const url=process.env.DATABASE_URL??"postgresql://vibress:vibress@127.0.0.1:5433/vibress";
const suffix=randomBytes(5).toString("hex");
const rolePasswords=new Map<string,string>();
const rolePassword=(role:string)=>{const password=rolePasswords.get(role);if(!password)throw Error("unknown fixture role");return password;};
async function createFixtureRole(role:string){const password=randomBytes(24).toString("hex");await root.query("CREATE ROLE "+qi(role)+" LOGIN PASSWORD "+root.escapeLiteral(password)+" NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");rolePasswords.set(role,password);}
let root:Client;
const labs:Lab[]=[];
const credentials=generateKeyPairSync("ed25519"),epochKeys=generateKeyPairSync("ed25519");
function dbUrl(db:string,role?:string){const u=new URL(url);u.pathname="/"+db;if(role){u.username=role;u.password=rolePassword(role);}return u.toString();}
function wire(m:SchemaManifest){return JSON.stringify(m);}
async function connect(db:string,role?:string){const c=new Client({connectionString:dbUrl(db,role),connectionTimeoutMillis:4000});await c.connect();return c;}

const profile:DynamicRecordProfile={
  fields:[
    {id:"title",type:"text",required:true,maxLength:120},
    {id:"body",type:"text",required:false},
    {id:"pinned",type:"boolean",required:false},
    {id:"weight",type:"integer",required:false},
    {id:"due",type:"datetime",required:false},
    {id:"extra",type:"json",required:false},
  ],
  maxBytes:2048,
  maxDepth:3,
  maxKeys:12,
  maxRecordsPerTenant:5,
};

type Lab={name:string;scope:SchemaCompilationScope;installer:string;runtime:string;namespace:string;oid:string;authority:DisposableDurableRecoveryAuthority;admin:Client;pool:Pool;dir:string};
async function lab(tag:string,app:string):Promise<Lab>{
  const name="vibress_s03_norm_"+tag+"_"+suffix,installer="v3_inst_"+tag+"_"+suffix,runtime="v3_run_"+tag+"_"+suffix;
  const scope={applicationId:asApplicationId(app),installationId:asInstallationId("installation-"+tag)};
  for(const role of [installer,runtime])await createFixtureRole(role);
  await root.query("CREATE DATABASE "+qi(name));
  await root.query("REVOKE ALL ON DATABASE "+qi(name)+" FROM PUBLIC");
  for(const role of [installer,runtime])await root.query("GRANT CONNECT ON DATABASE "+qi(name)+" TO "+qi(role));
  const admin=await connect(name),pool=new Pool({connectionString:dbUrl(name,runtime),max:4}),dir=mkdtempSync(path.join(tmpdir(),"m03-dynamic-"));
  const anchorDir=path.join(dir,"anchor");mkdirSync(anchorDir);
  const anchor=new FileExperimentalRecoveryAnchor(anchorDir,generateKeyPairSync("ed25519").privateKey);
  const authority=DisposableDurableRecoveryAuthority.initialize(dir,epochKeys.privateKey,scope.installationId,name,randomUUID(),anchor,credentials.publicKey);
  const f:Lab={name,scope,installer,runtime,namespace:"",oid:"",admin,pool,dir,authority};labs.push(f);
  await admin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE TABLE public.platform_applications(id text PRIMARY KEY,name text NOT NULL); CREATE TABLE public.platform_installations(id text PRIMARY KEY,application_id text NOT NULL REFERENCES public.platform_applications(id),environment text NOT NULL)");
  await admin.query("INSERT INTO public.platform_applications VALUES($1,$2)",[scope.applicationId,app]);
  await admin.query("INSERT INTO public.platform_installations VALUES($1,$2,'test')",[scope.installationId,scope.applicationId]);
  await admin.query(readFileSync("packages/database/migrations/0059_platform_schema_execution_registry.sql","utf8"));
  await admin.query(readFileSync("tests/fixtures/m03-normative-registry-v1.sql","utf8"));
  f.oid=(await admin.query<{oid:string}>("SELECT oid::text AS oid FROM pg_database WHERE datname=current_database()")).rows[0]!.oid;
  f.namespace=await reserveExperimentalNamespace(admin,scope,{installer,runtime},credentials.publicKey,authority);
  return f;
}
function manifest(f:Lab,overrides:Partial<DynamicRecordProfile>={}):SchemaManifest{
  const defs:ResourceDefinition[]=[
    {...f.scope,id:"customers",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"name",type:"text",required:true}]},
    {...f.scope,id:"notes",ownership:"tenant",fields:[],dynamic:{...profile,...overrides}},
  ];
  return createSchemaManifest(compileResourceSchema(defs,f.scope));
}
function approval(f:Lab,next:SchemaManifest){
  const plan=compileProvisioningTransition(null,next,f.scope),state=f.authority.authenticatedSnapshot();
  const e:ProvisioningApproval={version:1,profile:provisioningProfileFor(next),applicationId:f.scope.applicationId,installationId:f.scope.installationId,databaseName:f.name,databaseOid:f.oid,epoch:state.epoch,ledgerId:state.ledgerId,authorityHead:state.head,authoritySequence:state.sequence,parent:null,manifestDigest:next.digest,physicalDigest:plan.physical.digest,planDigest:plan.digest,operationId:randomUUID(),approvalId:randomUUID()};
  const message=provisioningApprovalMessage(e);
  return {e,message,signature:sign(null,Buffer.from(message),credentials.privateKey).toString("base64url")};
}
const apply=async(f:Lab,m:SchemaManifest)=>{
  const a=approval(f,m),c=await connect(f.name);
  try{
    await c.query("BEGIN");
    let current:LifecycleState|null=null;
    for(const next of ["PROPOSED","VALIDATED","APPROVED"] as const){
      await recordExperimentalLifecycleTransition(c,{installationId:f.scope.installationId,revisionDigest:m.digest,expectedState:current,nextState:next,operationId:a.e.operationId,approvalId:a.e.approvalId,epoch:a.e.epoch,head:a.e.authorityHead,sequence:a.e.authoritySequence,actor:"fixture-operator"});
      current=next;
    }
    await c.query("COMMIT");
  }catch(error){await c.query("ROLLBACK").catch(()=>undefined);throw error;}finally{await c.end();}
  return installExperimentalRevision(dbUrl(f.name,f.installer),wire(m),a.message,a.signature,f.authority);
};
const check=(f:Lab,m:SchemaManifest)=>verifyExperimentalProvisionedCatalog(dbUrl(f.name,f.installer),wire(m),f.authority);
const table=(f:Lab,m:SchemaManifest,id:string)=>qi(f.namespace)+"."+qi(m.resources.find(x=>x.id===id)!.tableName);
function scoped(f:Lab,tenant:string,permissions:string[]){
  const tenantId=asTenantId(tenant),principalId=asPrincipalId("fixture-principal"),applicationId=f.scope.applicationId;
  return verifyTenantScope({applicationId,tenantId,principal:{id:principalId,kind:"staff",applicationId,tenantIds:[tenantId],roles:["staff"],permissions:[]},membership:{applicationId,tenantId,principalId,active:true,roles:["staff"],permissions:[]},authorization:{allowed:true,permissions,policyVersion:"fixture-v1"}});
}

beforeAll(async()=>{
  const u=new URL(url);
  const ports=process.env.GITHUB_ACTIONS==="true"?["5433"]:["5433","5434"];
  if(!["localhost","127.0.0.1"].includes(u.hostname)||!ports.includes(u.port)||u.pathname!=="/vibress"||u.username!=="vibress"||u.password!=="vibress"||u.search)throw Error("disposable fixture only");
  root=await connect("vibress");
  const row=(await root.query<{version:number;superuser:boolean}>("SELECT current_setting('server_version_num')::int AS version,rolsuper AS superuser FROM pg_roles WHERE rolname=current_user")).rows[0]!;
  if(!row.superuser||row.version<160000||row.version>=170000)throw Error("disposable PG16 required");
},30000);
afterAll(async()=>{
  if(!root)return;
  for(const f of labs.reverse()){
    f.authority.close();await f.pool.end();await f.admin.end();
    await root.query("DROP DATABASE "+qi(f.name));
    for(const role of [f.runtime,f.installer])await root.query("DROP ROLE "+qi(role));
    rmSync(f.dir,{recursive:true,force:true});
  }
  await root.end();
},30000);

describe("A04 bounded dynamic storage with typed resources",()=>{
  const permissions=["resource.notes.create","resource.notes.update","resource.notes.delete","resource.notes.read","resource.customers.create","resource.customers.read"];

  it("provisions typed and dynamic resources in one signed revision and enforces typed persistence",async()=>{
    const f=await lab("mix","reference-notes-dynamic"),m=manifest(f);
    expect(provisioningProfileFor(m)).toBe(PROVISIONING_PROFILE_V3);
    expect(compileProvisioningContract(m,f.scope).digest).toBe(compileProvisioningContract(m,f.scope).digest);
    await apply(f,m);
    expect(await check(f,m)).toBe(compileProvisioningContract(m,f.scope).digest);
    const uow=new TenantUnitOfWork(f.pool),ta=scoped(f,"tenant-a",permissions);
    await uow.run(ta,tx=>tx.query("INSERT INTO "+table(f,m,"customers")+"(tenant_id,id,code,name) VALUES($1,$2,'c1','Typed')",["tenant-a",randomUUID()]));
    expect((await uow.run(ta,tx=>tx.query("SELECT name FROM "+table(f,m,"customers")))).rows).toEqual([{name:"Typed"}]);
    const dynamicTable=table(f,m,"notes");
    const shape=(await f.admin.query<{columns:string[];checks:number}>("SELECT ARRAY(SELECT a.attname::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.oid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns,(SELECT count(*)::int FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c') AS checks",[dynamicTable])).rows[0]!;
    expect(shape.columns).toEqual(["tenant_id","id","revision","version_token","payload","deleted_on"]);
    expect(shape.checks).toBe(2);
    console.info("M03_A04_DYNAMIC_PROVISIONING=PASS");
  },60000);

  it("persists validated records with tenant isolation, CAS updates, soft deletion and keyset pagination",async()=>{
    const f=await lab("crud","reference-notes-crud"),m=manifest(f);
    await apply(f,m);
    const uow=new TenantUnitOfWork(f.pool),ta=scoped(f,"tenant-a",permissions),tb=scoped(f,"tenant-b",permissions);
    const open=(s:ReturnType<typeof scoped>)=>uow.run(s,tx=>openExperimentalDynamicResource(tx,wire(m),"notes",f.authority));
    const resource=await open(ta);
    expect(resource.revision).toBe(dynamicRecordRevision(profile));
    const first=await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).create({title:"First",weight:2,pinned:true,extra:{a:[1,true]}}));
    expect(first.payload).toEqual({title:"First",weight:2,pinned:true,extra:{a:[1,true]}});
    expect(first.revision).toBe(dynamicRecordRevision(profile));
    const second=await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).create({title:"Second"}));
    const third=await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).create({title:"Third",due:"2026-11-19T10:00:00Z"}));
    expect(await uow.run(tb,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).get(first.id))).toBeNull();
    expect((await uow.run(tb,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).list({limit:10}))).records).toEqual([]);
    const updated=await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).update(first.id,first.version_token,{title:"First revised",body:"body"}));
    expect(updated).toMatchObject({id:first.id,payload:{title:"First revised",body:"body"}});
    expect(await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).update(first.id,first.version_token,{title:"Stale"}))).toBeNull();
    expect(await uow.run(tb,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).update(first.id,updated!.version_token,{title:"Cross tenant"}))).toBeNull();
    const pageOne=await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).list({limit:2}));
    expect(pageOne.records.map(r=>r.id)).toHaveLength(2);
    expect(pageOne.nextCursor).not.toBeNull();
    const pageTwo=await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).list({limit:2,after:pageOne.nextCursor!}));
    expect(pageTwo.records).toHaveLength(1);
    expect([...pageOne.records,...pageTwo.records].map(r=>r.id).sort()).toEqual([first.id,second.id,third.id].sort());
    const forged="v1."+Buffer.from(JSON.stringify([m.digest,"0".repeat(64),second.id])).toString("base64url");
    await expect(uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).list({limit:2,after:forged}))).rejects.toThrow("M03_DYNAMIC_RESOURCE_REFUSED");
    expect(await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).remove(first.id,updated!.version_token))).toBe(true);
    expect(await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).get(first.id))).toBeNull();
    expect(await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).remove(first.id,updated!.version_token))).toBe(false);
    expect((await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).list({limit:10}))).records.map(r=>r.id).sort()).toEqual([second.id,third.id].sort());
    expect((await f.admin.query("SELECT payload FROM "+table(f,m,"notes")+" WHERE id=$1",[first.id])).rows).toEqual([{payload:{title:"First revised",body:"body"}}]);
    console.info("M03_A04_DYNAMIC_CRUD=PASS");
  },60000);

  it("refuses unsupported payloads, queries and per-tenant record budget overruns",async()=>{
    const f=await lab("bounds","reference-notes-bounds"),m=manifest(f);
    await apply(f,m);
    const uow=new TenantUnitOfWork(f.pool),ta=scoped(f,"tenant-a",permissions),tb=scoped(f,"tenant-b",permissions),dt=table(f,m,"notes");
    const create=(s:ReturnType<typeof scoped>,input:unknown)=>uow.run(s,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).create(input));
    for(const bad of [
      {title:"ok",undeclared:1},
      {title:"ok",weight:1.5},
      {title:"ok",weight:2**31},
      {title:"ok",pinned:"yes"},
      {title:"ok",due:"2026-13-01T00:00:00Z"},
      {title:"ok",body:"nul\u0000byte"},
      {weight:1},
      {title:"ok",extra:{a:{b:{c:{d:1}}}}},
      {title:"ok",extra:{a:1,b:2,c:3,d:4,e:5,f:6,g:7,h:8,i:9,j:10,k:11}},
      {title:"ok",extra:{a:undefined}},
      {title:"x".repeat(2048),extra:{a:"y".repeat(1024)}},
    ]) await expect(create(ta,bad)).rejects.toThrow(/DYNAMIC_RECORD_REFUSED/);
    const open=(s:ReturnType<typeof scoped>)=>uow.run(s,tx=>openExperimentalDynamicResource(tx,wire(m),"notes",f.authority));
    await expect(uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).list({limit:10,filter:{title:"x"}} as never))).rejects.toThrow("DYNAMIC_RECORD_QUERY_REFUSED");
    await expect(uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).list({limit:101}))).rejects.toThrow("DYNAMIC_RECORD_QUERY_REFUSED");
    await expect(uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).list({limit:10,order:"payload"} as never))).rejects.toThrow("DYNAMIC_RECORD_QUERY_REFUSED");
    await expect(uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(m),"notes",f.authority)).query({sql:"payload->>title"}))).rejects.toThrow("M03_DYNAMIC_QUERY_UNSUPPORTED");
    for(let index=0;index<profile.maxRecordsPerTenant;index++)await create(ta,{title:"record-"+index});
    await expect(create(ta,{title:"over budget"})).rejects.toThrow("M03_DYNAMIC_RESOURCE_REFUSED");
    await expect(create(tb,{title:"other tenant unaffected"})).resolves.toMatchObject({payload:{title:"other tenant unaffected"}});
    const resource=await open(ta);
    await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+dt+"(tenant_id,id,revision,version_token,payload) VALUES($1,$2,$3,$4,$5::jsonb)",["tenant-a",randomUUID(),resource.revision,randomUUID(),JSON.stringify({title:"x".repeat(2048)})]))).rejects.toMatchObject({code:"23514"});
    await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+dt+"(tenant_id,id,revision,version_token,payload) VALUES($1,$2,$3,$4,$5::jsonb)",["tenant-a",randomUUID(),resource.revision,randomUUID(),"[]"]))).rejects.toMatchObject({code:"23514"});
    await expect(uow.run(ta,tx=>tx.query("INSERT INTO "+dt+"(tenant_id,id,revision,version_token,payload) VALUES($1,$2,$3,$4,$5::jsonb)",["tenant-a",randomUUID(),"0".repeat(64),randomUUID(),JSON.stringify({title:"other revision"})]))).rejects.toMatchObject({code:"23514"});
    console.info("M03_A04_DYNAMIC_BOUNDS=PASS");
  },60000);

  it("binds every revision deterministically and refuses in-place profile evolution",async()=>{
    const f=await lab("revision","reference-notes-revision"),before=manifest(f),after=manifest(f,{maxBytes:4096});
    expect(before.digest).not.toBe(after.digest);
    expect(compileProvisioningContract(before,f.scope).digest).not.toBe(compileProvisioningContract(after,f.scope).digest);
    expect(dynamicRecordRevision(before.resources.find(r=>r.id==="notes")!.dynamic!))
      .not.toBe(dynamicRecordRevision(after.resources.find(r=>r.id==="notes")!.dynamic!));
    expect(()=>compileProvisioningTransition(before,after,f.scope)).toThrow("PROVISIONING_NO_CHANGES");
    const plan=planSchemaChanges(before,after.canonicalIr,{scope:f.scope,expectedCurrentDigest:before.digest});
    expect(plan.disposition).toBe("BLOCKED");
    expect(plan.operations).toContainEqual(expect.objectContaining({type:"ALTER_DYNAMIC_PROFILE",resourceId:"notes",status:"DENIED"}));
    await apply(f,before);
    const uow=new TenantUnitOfWork(f.pool),ta=scoped(f,"tenant-a",permissions);
    await uow.run(ta,async tx=>(await openExperimentalDynamicResource(tx,wire(before),"notes",f.authority)).create({title:"bound"}));
    expect(await check(f,before)).toBe(compileProvisioningContract(before,f.scope).digest);
    console.info("M03_A04_DYNAMIC_REVISION=PASS");
  },60000);
});
