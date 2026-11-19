// @vitest-environment node
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from "node:crypto";
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fork,type ChildProcess} from "node:child_process";
import {build} from "esbuild";
import {referenceQueue} from "../../apps/worker/test-fixtures/m03-normative-queue";
import {Client,Pool} from "pg";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {asApplicationId,asInstallationId,asPrincipalId,asTenantId} from "@vibress/platform-kernel";
import {TenantUnitOfWork,verifyTenantScope} from "@vibress/tenancy";
import {compileResourceSchema,createSchemaManifest,compileProvisioningContract,compileProvisioningTransition,provisioningIdentifier as qi,PROVISIONING_PROFILE,type ResourceDefinition,type SchemaCompilationScope,type SchemaManifest} from "../../packages/schema-engine/src";
import {reserveExperimentalNamespace,installExperimentalRevision,verifyExperimentalProvisionedCatalog,provisioningApprovalMessage,collectExperimentalProvisioningCommit,type ProvisioningApproval} from "../../packages/database/src/schema-operator-experimental-installer";
import {startTransactionAckFaultProxy} from "../../scripts/platform/m03-s03-fault/pg-wire-proxy";
import {DisposableDurableRecoveryAuthority,recoveryAdministrationMessage} from "../../packages/database/src/schema-operator-experimental-durable-authority";
import {FileExperimentalRecoveryAnchor} from "../../packages/database/src/schema-operator-experimental-anchor";
const url=process.env.DATABASE_URL??"postgresql://vibress:vibress@127.0.0.1:5433/vibress";
const suffix=randomBytes(5).toString("hex"),password=randomBytes(24).toString("hex");
let root:Client;
const labs:Lab[]=[];
const credentials=generateKeyPairSync("ed25519"),adminKeys=generateKeyPairSync("ed25519"),epochKeys=generateKeyPairSync("ed25519");
function dbUrl(db:string,role?:string){const u=new URL(url);u.pathname="/"+db;if(role){u.username=role;u.password=password;}return u.toString();}
function wire(m:SchemaManifest){return JSON.stringify(m);}
async function connect(db:string,role?:string){const c=new Client({connectionString:dbUrl(db,role),connectionTimeoutMillis:4000});await c.connect();return c;}
type Lab={name:string;reader?:string;scope:SchemaCompilationScope;installer:string;runtime:string;namespace:string;oid:string;authority:DisposableDurableRecoveryAuthority;admin:Client;pool:Pool;dir:string};
async function lab(tag:string,app:string):Promise<Lab>{
  const name="vibress_s03_norm_"+tag+"_"+suffix,installer="v3_inst_"+tag+"_"+suffix,runtime="v3_run_"+tag+"_"+suffix;
  const scope={applicationId:asApplicationId(app),installationId:asInstallationId("installation-"+tag)};
  for(const role of [installer,runtime])await root.query("CREATE ROLE "+qi(role)+" LOGIN PASSWORD "+root.escapeLiteral(password)+" NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
  await root.query("CREATE DATABASE "+qi(name));
  await root.query("REVOKE ALL ON DATABASE "+qi(name)+" FROM PUBLIC");
  for(const role of [installer,runtime])await root.query("GRANT CONNECT ON DATABASE "+qi(name)+" TO "+qi(role));
  const admin=await connect(name),pool=new Pool({connectionString:dbUrl(name,runtime),max:4}),dir=mkdtempSync(path.join(tmpdir(),"m03-normative-"));
  const anchorDir=path.join(dir,"anchor");mkdirSync(anchorDir);
  const authority=DisposableDurableRecoveryAuthority.initialize(dir,epochKeys.privateKey,scope.installationId,name,randomUUID(),new FileExperimentalRecoveryAnchor(anchorDir,generateKeyPairSync("ed25519").privateKey),adminKeys.publicKey);
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
function crm(f:Lab,extra?: "website"|"phone"|"notes"):SchemaManifest{
  const defs:ResourceDefinition[]=[
    {...f.scope,id:"customers",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"name",type:"text",required:true},...(extra?[{id:extra,type:"text" as const,required:false}]:[])]},
    {...f.scope,id:"deals",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"customer",type:"relation",required:true,targetResource:"customers"},{id:"stage",type:"enum",required:true,values:["open","won"]}]},
    {...f.scope,id:"activities",ownership:"tenant",fields:[{id:"code",type:"text",required:true},{id:"deal",type:"relation",required:false,targetResource:"deals"},{id:"done",type:"boolean",required:true}]},
  ];
  return createSchemaManifest(compileResourceSchema(defs,f.scope));
}
function approval(f:Lab,before:SchemaManifest|null,next:SchemaManifest,overrides:Partial<ProvisioningApproval>={}){
  const plan=compileProvisioningTransition(before,next,f.scope),state=f.authority.authenticatedSnapshot();
  const e:ProvisioningApproval={version:1,profile:PROVISIONING_PROFILE,applicationId:f.scope.applicationId,installationId:f.scope.installationId,databaseName:f.name,databaseOid:f.oid,epoch:state.epoch,ledgerId:state.ledgerId,authorityHead:state.head,authoritySequence:state.sequence,parent:before?.digest??null,manifestDigest:next.digest,physicalDigest:plan.physical.digest,planDigest:plan.digest,operationId:randomUUID(),approvalId:randomUUID(),...overrides};
  const message=provisioningApprovalMessage(e);
  return {e,message,signature:sign(null,Buffer.from(message),credentials.privateKey).toString("base64url")};
}
const apply=(f:Lab,m:SchemaManifest,a:ReturnType<typeof approval>)=>installExperimentalRevision(dbUrl(f.name,f.installer),wire(m),a.message,a.signature,f.authority);
const check=(f:Lab,m:SchemaManifest)=>verifyExperimentalProvisionedCatalog(dbUrl(f.name,f.installer),wire(m));
const table=(f:Lab,m:SchemaManifest,id:string)=>qi(f.namespace)+"."+qi(m.resources.find(x=>x.id===id)!.tableName);
function scope(f:Lab,tenant:string){
  const tenantId=asTenantId(tenant),principalId=asPrincipalId("fixture-principal"),applicationId=f.scope.applicationId;
  return verifyTenantScope({applicationId,tenantId,principal:{id:principalId,kind:"staff",applicationId,tenantIds:[tenantId],roles:["staff"],permissions:[]},membership:{applicationId,tenantId,principalId,active:true,roles:["staff"],permissions:[]},authorization:{allowed:true,permissions:[],policyVersion:"fixture-v1"}});
}
beforeAll(async()=>{
  const u=new URL(url);
  if(!["localhost","127.0.0.1"].includes(u.hostname)||u.port!=="5433"||u.pathname!=="/vibress"||u.username!=="vibress"||u.password!=="vibress"||u.search)throw Error("disposable fixture only");
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
  it("J03: independent non-CMS installation and mutual credential isolation",async()=>{
    const f=await lab("inventory","reference-inventory"),m=createSchemaManifest(compileResourceSchema([{...f.scope,id:"assets",ownership:"application",fields:[{id:"code",type:"text",required:true},{id:"label",type:"text",required:true}]}],f.scope));
    await apply(f,m,approval(f,null,m));await check(f,m);
    const other=labs.find(x=>x.scope.applicationId==="reference-crm")!;
    for(const [target,role] of [[f.name,other.runtime],[other.name,f.runtime],[other.name,f.installer],[f.name,other.installer]]){
      const c=new Client({connectionString:dbUrl(target!,role),connectionTimeoutMillis:4000});try{await expect(c.connect()).rejects.toThrow();}finally{await c.end().catch(()=>undefined);}
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
    await uow.run(ta,tx=>tx.query("UPDATE "+c+" SET "+qi(field)+"='backfilled' WHERE "+qi(field)+" IS NULL"));
    expect((await uow.run(ta,tx=>tx.query("SELECT "+qi(field)+" AS value FROM "+c))).rows).toEqual([{value:"backfilled"}]);
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
  // The owned lab's proxy listens on an ephemeral loopback port. The installer
  // normally requires 5433, so this is explicitly enabled only in test fixture.
  try{
    const target=new URL(dbUrl(f.name,f.installer));target.port=String(proxy.port);
    const pending=installExperimentalRevision(target.toString(),wire(m),a.message,a.signature,f.authority,proxy.port);
    const failed=pending.then(()=>false,()=>true);
    await proxy.serverCommitObserved;expect(await failed).toBe(true);
    expect(f.authority.authenticatedSnapshot()).toMatchObject({pending:true,provisioningOperations:[{operationId:a.e.operationId,outcome:"UNCERTAIN"}]});
    expect((await f.admin.query("SELECT revision_digest FROM public.platform_schema_revisions_v1")).rows).toEqual([{revision_digest:m.digest}]);
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
  await root.query("CREATE ROLE "+qi(f.reader)+" LOGIN PASSWORD "+root.escapeLiteral(password)+" NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
  await root.query("GRANT CONNECT ON DATABASE "+qi(f.name)+" TO "+qi(f.reader));
  await f.admin.query("CREATE TABLE public.platform_memberships(application_id text NOT NULL,tenant_id text NOT NULL,principal_id text NOT NULL,active boolean NOT NULL,roles text[] NOT NULL,permissions text[] NOT NULL,PRIMARY KEY(application_id,tenant_id,principal_id))");
  const perms=["crm.customers.read","crm.customers.create"];
  await f.admin.query("INSERT INTO public.platform_memberships VALUES($1,'tenant-a','api-principal',true,ARRAY['staff'],$2)",[f.scope.applicationId,perms]);
  await f.admin.query("GRANT SELECT ON public.platform_memberships TO "+qi(f.reader));
  const token=randomBytes(24).toString("hex"),apiDir=mkdtempSync(path.resolve("apps/platform-reference/.m03-reference-")),workerDir=mkdtempSync(path.resolve("apps/worker/.m03-reference-"));
  const processes:ChildProcess[]=[];
  const queueName="m03-reference-"+suffix,queuePrefix="m03-"+suffix,{queue,events}=referenceQueue(queueName,queuePrefix);
  const env={...process.env,NODE_ENV:"test",M03_NORMATIVE_REFERENCE:"1",M03_APP:f.scope.applicationId,M03_INSTALLATION:f.scope.installationId,
    M03_DATABASE:f.name,M03_OID:f.oid,M03_RUNTIME_ROLE:f.runtime,M03_RUNTIME_URL:dbUrl(f.name,f.runtime),M03_MEMBERSHIP_URL:dbUrl(f.name,f.reader),
    M03_NAMESPACE:f.namespace,M03_CUSTOMERS:old.resources.find(x=>x.id==="customers")!.tableName,M03_ACTIVITIES:old.resources.find(x=>x.id==="activities")!.tableName,
    M03_QUEUE:queueName,M03_QUEUE_PREFIX:queuePrefix,M03_TOKENS:JSON.stringify({[token]:{id:"api-principal",kind:"staff",tenantIds:["tenant-a"],roles:["staff"],permissions:perms}})};
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
  const jobData=(version:1|2,operationId:string)=>({version,applicationId:f.scope.applicationId,installationId:f.scope.installationId,tenantId:"tenant-a",operationId,customerId,...(version===2?{website:"https://example.invalid"}:{})});
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
