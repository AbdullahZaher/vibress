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
import {TenantUnitOfWork,verifyTenantScope} from "@vibress/tenancy";
import {compileResourceSchema,createSchemaManifest,compileProvisioningContract,compileProvisioningTransition,provisioningIdentifier as qi,PROVISIONING_PROFILE,type ResourceDefinition,type SchemaCompilationScope,type SchemaManifest} from "../../packages/schema-engine/src";
import {reserveExperimentalNamespace,installExperimentalRevision,verifyExperimentalProvisionedCatalog,provisioningApprovalMessage,collectExperimentalProvisioningCommit,collectExperimentalProvisioningCheckpoint,runExperimentalBackfillChunk,experimentalBackfillMessage,type ProvisioningApproval,type ExperimentalBackfillApproval} from "../../packages/database/src/schema-operator-experimental-installer";
import {experimentalBusinessMessage,collectExperimentalBusinessOutcome,type BusinessApproval} from "../../packages/database/src/schema-operator-experimental-business";
import {startStatementAckFaultProxy,startTransactionAckFaultProxy} from "../../scripts/platform/m03-s03-fault/pg-wire-proxy";
import {DisposableDurableRecoveryAuthority,recoveryAdministrationMessage} from "../../packages/database/src/schema-operator-experimental-durable-authority";
import {FileExperimentalRecoveryAnchor} from "../../packages/database/src/schema-operator-experimental-anchor";
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
function approval(f:Lab,before:SchemaManifest|null,next:SchemaManifest,overrides:Partial<ProvisioningApproval>={}){
  const plan=compileProvisioningTransition(before,next,f.scope),state=f.authority.authenticatedSnapshot();
  const e:ProvisioningApproval={version:1,profile:PROVISIONING_PROFILE,applicationId:f.scope.applicationId,installationId:f.scope.installationId,databaseName:f.name,databaseOid:f.oid,epoch:state.epoch,ledgerId:state.ledgerId,authorityHead:state.head,authoritySequence:state.sequence,parent:before?.digest??null,manifestDigest:next.digest,physicalDigest:plan.physical.digest,planDigest:plan.digest,operationId:randomUUID(),approvalId:randomUUID(),...overrides};
  const message=provisioningApprovalMessage(e);
  return {e,message,signature:sign(null,Buffer.from(message),credentials.privateKey).toString("base64url")};
}
const apply=(f:Lab,m:SchemaManifest,a:ReturnType<typeof approval>)=>installExperimentalRevision(dbUrl(f.name,f.installer),wire(m),a.message,a.signature,f.authority);
const check=(f:Lab,m:SchemaManifest)=>verifyExperimentalProvisionedCatalog(dbUrl(f.name,f.installer),wire(m),f.authority);
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
  // The owned lab's proxy listens on an ephemeral loopback port. The installer
  // normally requires 5433, so this is explicitly enabled only in test fixture.
  try{
    const target=new URL(dbUrl(f.name,f.installer));target.port=String(proxy.port);
    const pending=installExperimentalRevision(target.toString(),wire(m),a.message,a.signature,f.authority,proxy.port);
    const failed=pending.then(()=>false,()=>true);
    await Promise.race([proxy.serverCommitObserved,pending.then(()=>{throw Error('fault target unexpectedly succeeded');},error=>{if(!(error instanceof Error)||error.message!=="M03_INSTALLER_COMMIT_UNKNOWN_NO_RETRY")throw error;return proxy.serverCommitObserved;})]);expect(await failed).toBe(true);
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
