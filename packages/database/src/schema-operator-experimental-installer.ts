// Experimental operator-only component. Not exported by serving database API.
// Root owns trust configuration; installer is a trusted one-shot DDL principal,
// never an arbitrary SQL service or security sandbox for its own credentials.
import {createHash,createPublicKey,verify,type KeyObject} from "node:crypto";
import {Client,type ClientBase} from "pg";
import {asApplicationId,asInstallationId} from "@vibress/platform-kernel";
import {compileProvisioningContract,compileProvisioningTransition,parseSchemaManifest,provisioningConstraintName,provisioningConstraints,provisioningIdentifier as qi,provisioningNamespace,provisioningTenantExpression,PROVISIONING_PROFILE,type ProvisioningContract} from "@vibress/schema-engine";
import type {DisposableDurableRecoveryAuthority,ExperimentalProvisioningAdmission} from "./schema-operator-experimental-durable-authority";
const fail=():never=>{throw Error("M03_PROVISIONING_REFUSED");};
const hash=(data:string|Buffer)=>createHash("sha256").update(data).digest("hex");
const sha=/^[a-f0-9]{64}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Trust={installation_id:string;application_id:string;database_name:string;database_oid:string;system_identifier:string;timeline:number;namespace:string;installer_role:string;runtime_role:string;approval_key:string;approval_key_digest:string;epoch:string;ledger_id:string;profile:string;revoked:boolean};
type Scope={applicationId:ReturnType<typeof asApplicationId>;installationId:ReturnType<typeof asInstallationId>};
const qualified=(n:string,t:string)=>qi(n)+"."+qi(t);
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=(a:readonly string[])=>[...a].sort();
const scopeOf=(t:Trust):Scope=>({applicationId:asApplicationId(t.application_id),installationId:asInstallationId(t.installation_id)});
async function identity(db:ClientBase){
  const rows=(await db.query<{name:string;oid:string;role:string;session:string;version:number;recovering:boolean;superuser:boolean}>("SELECT current_database() AS name,d.oid::text AS oid,current_user AS role,session_user AS session,current_setting('server_version_num')::int AS version,pg_is_in_recovery() AS recovering,r.rolsuper AS superuser FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_roles r WHERE d.datname=current_database() AND r.rolname=current_user")).rows;
  const row=rows[0];
  if(process.env.NODE_ENV!=="test"||rows.length!==1||!row||!/^vibress_s03_norm_[a-z0-9_]+$/.test(row.name)||row.version<160000||row.version>=170000||row.recovering||row.role!==row.session)return fail();
  return row;
}
function assertLocalUrl(url:string,faultProxyPort?:number){
  const u=new URL(url);
  if(process.env.NODE_ENV!=="test"||u.protocol!=="postgresql:"||!["127.0.0.1","localhost"].includes(u.hostname)||(u.port!=="5433"&&(faultProxyPort===undefined||!Number.isInteger(faultProxyPort)||Number(u.port)!==faultProxyPort))||!/^\/vibress_s03_norm_[a-z0-9_]+$/.test(u.pathname)||u.search||u.hash)return fail();
}
async function roleContract(db:ClientBase,installer:string,runtime:string,namespace:string){
  if(installer===runtime)return fail();
  qi(installer);qi(runtime);qi(namespace);
  const roles=(await db.query<{name:string;unsafe:boolean;dbcreate:boolean;temp:boolean;publiccreate:boolean;schemaCreate:boolean;schemaUsage:boolean}>(
    "SELECT rolname AS name,(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR NOT rolcanlogin) AS unsafe,has_database_privilege(oid,current_database(),'CREATE') AS dbcreate,has_database_privilege(oid,current_database(),'TEMP') AS temp,has_schema_privilege(oid,'public','CREATE') AS publiccreate,has_schema_privilege(oid,$2,'CREATE') AS \"schemaCreate\",has_schema_privilege(oid,$2,'USAGE') AS \"schemaUsage\" FROM pg_catalog.pg_roles WHERE rolname=ANY($1::name[]) ORDER BY rolname",
    [[installer,runtime],namespace])).rows;
  if(roles.length!==2||roles.some(x=>x.unsafe||x.dbcreate||x.temp||x.publiccreate||!x.schemaUsage||x.schemaCreate!==(x.name===installer)))return fail();
  const edges=(await db.query<{n:number}>("SELECT count(*)::int AS n FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles a ON a.oid=m.roleid JOIN pg_catalog.pg_roles b ON b.oid=m.member WHERE a.rolname=ANY($1::name[]) OR b.rolname=ANY($1::name[])",[[installer,runtime]])).rows[0];
  if(edges?.n!==0)return fail();
  const ns=(await db.query<{owner:string;acl:string[]}>("SELECT pg_get_userbyid(nspowner) AS owner,ARRAY(SELECT (CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)||':'||pg_get_userbyid(a.grantor)||':'||a.privilege_type||':'||a.is_grantable::text FROM aclexplode(coalesce(nspacl,acldefault('n',nspowner))) a ORDER BY 1) AS acl FROM pg_namespace WHERE nspname=$1",[namespace])).rows[0];
  if(!ns||ns.owner!==installer||!equal(ns.acl,sorted([installer+":"+installer+":CREATE:false",installer+":"+installer+":USAGE:false",runtime+":"+installer+":USAGE:false"])))return fail();
  const unsafe=(await db.query<{n:number}>("SELECT (SELECT count(*) FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole WHERE r.rolname=ANY($1::name[]) OR defaclnamespace=(SELECT oid FROM pg_namespace WHERE nspname=$2))+(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND (has_schema_privilege($3,n.oid,'USAGE') AND has_function_privilege($3,p.oid,'EXECUTE'))) AS n",[[installer,runtime],namespace,runtime])).rows[0];
  if(Number(unsafe?.n)!==0)return fail();
}
export async function reserveExperimentalNamespace(db:ClientBase,scope:Scope,roles:{installer:string;runtime:string},key:KeyObject,authority:DisposableDurableRecoveryAuthority){
  const keyBytes=key.export({format:"der",type:"spki"}),keyDigest=hash(keyBytes);
  if(key.type!=="public"||key.asymmetricKeyType!=="ed25519")return fail();
  const target={applicationId:asApplicationId(scope.applicationId),installationId:asInstallationId(scope.installationId)},installer=roles.installer,runtime=roles.runtime;
  qi(installer);qi(runtime);
  const state=authority.authenticatedSnapshot(),namespace=provisioningNamespace(target);
  const id=await identity(db);
  if(!id.superuser||state.pending||state.businessLease||state.readyProtocol===2||state.databaseName!==id.name||state.installationId!==target.installationId)return fail();
  await db.query("BEGIN");
  try{
    await db.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'");
    await db.query("SELECT pg_advisory_xact_lock(118033,301)");
    const install=(await db.query<{id:string;application_id:string;environment:string}>("SELECT id,application_id,environment FROM public.platform_installations")).rows;
    if(install.length!==1||install[0]?.id!==target.installationId||install[0]?.application_id!==target.applicationId||install[0]?.environment!=="test")return fail();
    if((await db.query("SELECT 1 FROM public.platform_schema_installation_trust_v1")).rowCount!==0)return fail();
    await db.query("CREATE SCHEMA "+qi(namespace)+" AUTHORIZATION "+qi(installer));
    // The administrator is explicit trusted root. No DB CREATE for installer.
    await db.query("GRANT USAGE ON SCHEMA "+qi(namespace)+" TO "+qi(runtime));
    const physical=(await db.query<{system:string;timeline:number}>("SELECT (pg_control_system()).system_identifier::text AS system,(pg_control_checkpoint()).timeline_id AS timeline")).rows[0]!;
    await db.query("INSERT INTO public.platform_schema_installation_trust_v1(installation_id,application_id,database_name,database_oid,system_identifier,timeline,namespace,installer_role,runtime_role,approval_key,approval_key_digest,epoch,ledger_id,profile) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",[target.installationId,target.applicationId,id.name,id.oid,physical.system,physical.timeline,namespace,installer,runtime,keyBytes.toString("base64"),keyDigest,state.epoch,state.ledgerId,PROVISIONING_PROFILE]);
    await db.query("GRANT SELECT ON public.platform_schema_installation_trust_v1,public.platform_schema_registry,public.platform_schema_revisions_v1 TO "+qi(installer));
    await db.query("GRANT INSERT ON public.platform_schema_registry,public.platform_schema_revisions_v1 TO "+qi(installer));
    await db.query("GRANT UPDATE(manifest,manifest_digest,updated_at) ON public.platform_schema_registry TO "+qi(installer));
    await roleContract(db,installer,runtime,namespace);
    if(!equal(state,authority.authenticatedSnapshot()))return fail();
    await db.query("COMMIT");
    return namespace;
  }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}
}
// Approval is a canonical bounded wire string, not a mutable caller object.
// Only an installation-configured key is loaded by the installer.
export interface ProvisioningApproval {version:1;profile:typeof PROVISIONING_PROFILE;applicationId:string;installationId:string;databaseName:string;databaseOid:string;epoch:string;ledgerId:string;authorityHead:string;authoritySequence:number;parent:string|null;manifestDigest:string;physicalDigest:string;planDigest:string;operationId:string;approvalId:string}
export function provisioningApprovalMessage(e:ProvisioningApproval){
  return JSON.stringify(["VIBRESS-M03-PROVISIONING-APPROVAL-V1",e.version,e.profile,e.applicationId,e.installationId,e.databaseName,e.databaseOid,e.epoch,e.ledgerId,e.authorityHead,e.authoritySequence,e.parent,e.manifestDigest,e.physicalDigest,e.planDigest,e.operationId,e.approvalId]);
}
function parseApproval(wire:string):ProvisioningApproval{
  if(typeof wire!=="string"||wire.length>4096)return fail();
  const raw:unknown=JSON.parse(wire);
  if(!Array.isArray(raw)||raw.length!==17||raw[0]!=="VIBRESS-M03-PROVISIONING-APPROVAL-V1")return fail();
  const [_,version,profile,applicationId,installationId,databaseName,databaseOid,epoch,ledgerId,authorityHead,authoritySequence,parent,manifestDigest,physicalDigest,planDigest,operationId,approvalId]=raw as unknown[];
  const s=(v:unknown,re:RegExp):v is string=>typeof v==="string"&&re.test(v);
  if(version!==1||profile!==PROVISIONING_PROFILE||!s(applicationId,/^[a-z][a-z0-9_-]{1,62}$/)||!s(installationId,/^[a-z][a-z0-9_-]{1,62}$/)||
    !s(databaseName,/^vibress_s03_norm_[a-z0-9_]+$/)||!s(databaseOid,/^\d{1,10}$/)||!s(epoch,uuid)||!s(ledgerId,uuid)||!s(authorityHead,sha)||typeof authoritySequence!=="number"||!Number.isSafeInteger(authoritySequence)||authoritySequence<1||
    !(parent===null||s(parent,sha))||!s(manifestDigest,sha)||!s(physicalDigest,sha)||!s(planDigest,sha)||!s(operationId,uuid)||!s(approvalId,uuid))return fail();
  const e={version,profile,applicationId,installationId,databaseName,databaseOid,epoch,ledgerId,authorityHead,authoritySequence,parent,manifestDigest,physicalDigest,planDigest,operationId,approvalId} as const;
  if(provisioningApprovalMessage(e)!==wire)return fail();
  return e;
}
async function loadTrust(db:ClientBase){
  const id=await identity(db),rows=(await db.query<Trust>("SELECT * FROM public.platform_schema_installation_trust_v1")).rows,t=rows[0];
  if(rows.length!==1||!t||t.revoked||t.profile!==PROVISIONING_PROFILE||t.database_name!==id.name||t.database_oid!==id.oid||t.installer_role!==id.role||id.superuser||
    t.namespace!==provisioningNamespace(scopeOf(t)))return fail();
  await roleContract(db,t.installer_role,t.runtime_role,t.namespace);
  return t;
}
async function verifyCatalog(db:ClientBase,t:Trust,expected:ProvisioningContract|null){
  const resources=expected?.resources??[],namespace=t.namespace;
  const objects=(await db.query<{name:string;kind:string;owner:string;permanent:string;rls:boolean;forced:boolean}>("SELECT c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner) AS owner,c.relpersistence AS permanent,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname",[namespace])).rows;
  const tables=objects.filter(x=>x.kind==="r"),indexes=objects.filter(x=>x.kind==="i");
  if(objects.length!==tables.length+indexes.length||!equal(tables.map(x=>x.name),sorted(resources.map(x=>x.table)))||objects.some(x=>x.owner!==t.installer_role||x.permanent!=="p"))return fail();
  const expectedIndexes:string[]=[];
  for(const resource of resources){
    const table=tables.find(x=>x.name===resource.table),tenant=resource.ownership==="tenant";
    if(!table||table.rls!==tenant||table.forced!==tenant)return fail();
    const cols=(await db.query<{name:string;type:string;required:boolean;hasdefault:boolean;identity:string;generated:string;acl:boolean}>("SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,a.atthasdef AS hasdefault,a.attidentity AS identity,a.attgenerated AS generated,a.attacl IS NOT NULL AS acl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname",[namespace,resource.table])).rows;
    const desired=resource.columns.map(c=>({name:c.name,type:c.type,required:c.required,hasdefault:false,identity:"",generated:"",acl:false})).sort((a,b)=>a.name.localeCompare(b.name,"en"));
    if(!equal(cols,desired))return fail();
    const cons=(await db.query<{name:string;kind:string;columns:string[];target:string|null;targetNamespace:string|null;targetColumns:string[];valid:boolean;defer:boolean;update:string;del:string;match:string;expression:string}>("SELECT co.conname AS name,co.contype AS kind,ARRAY(SELECT a.attname FROM unnest(co.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum ORDER BY k.ord) AS columns,f.relname AS target,fn.nspname AS \"targetNamespace\",ARRAY(SELECT a.attname FROM unnest(co.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=f.oid AND a.attnum=k.attnum ORDER BY k.ord) AS \"targetColumns\",co.convalidated AS valid,co.condeferrable OR co.condeferred AS defer,co.confupdtype AS update,co.confdeltype AS del,co.confmatchtype AS match,coalesce(pg_get_expr(co.conbin,co.conrelid),'') AS expression FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class f ON f.oid=co.confrelid LEFT JOIN pg_namespace fn ON fn.oid=f.relnamespace WHERE n.nspname=$1 AND c.relname=$2 ORDER BY co.conname",[namespace,resource.table])).rows;
    const constraints=provisioningConstraints(resource,namespace);
    const enums=resource.columns.filter(c=>c.enumValues);
    if(cons.length!==constraints.length+enums.length)return fail();
    for(const c of constraints){
      const actual=cons.find(x=>x.name===c.name);
      if(!actual||!actual.valid||actual.defer||actual.kind!==c.kind||!equal(actual.columns,c.columns)||actual.target!==c.target||!equal(actual.targetColumns,c.targetColumns))return fail();
      if(c.kind==="f"&&(actual.targetNamespace!==namespace||actual.update!=="r"||actual.del!=="r"||actual.match!=="s"))return fail();
      if(c.kind!=="f")expectedIndexes.push(c.name);
    }
    for(const e of enums){
      const actual=cons.find(x=>x.name===provisioningConstraintName(resource.table,"enum",e.name));
      const expression="("+e.name+" = ANY (ARRAY["+e.enumValues!.map(v=>"'"+v+"'::text").join(", ")+"]))";
      if(!actual||actual.kind!=="c"||!actual.valid||!equal(actual.columns,[e.name])||actual.expression!==expression)return fail();
    }
    const ix=(await db.query<{name:string;columns:string[];unique:boolean;primary:boolean;valid:boolean;method:string;plain:boolean;options:number[]}>("SELECT i.relname AS name,ARRAY(SELECT a.attname FROM unnest(x.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum ORDER BY k.ord) AS columns,x.indisunique AS \"unique\",x.indisprimary AS \"primary\",x.indisvalid AND x.indisready AND x.indislive AS valid,am.amname AS method,x.indexprs IS NULL AND x.indpred IS NULL AND x.indnatts=x.indnkeyatts AS plain,ARRAY(SELECT unnest(x.indoption)::int) AS options FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_am am ON am.oid=i.relam WHERE n.nspname=$1 AND c.relname=$2",[namespace,resource.table])).rows;
    const expectedIx=[...constraints.filter(c=>c.kind!=="f").map(c=>({name:c.name,columns:c.columns,unique:true,primary:c.kind==="p"})),...resource.relations.map(e=>({name:provisioningConstraintName(resource.table,"ix",e.column),columns:e.columns,unique:false,primary:false}))];
    for(const e of expectedIx)if(!e.unique)expectedIndexes.push(e.name);
    if(ix.length!==expectedIx.length||expectedIx.some(e=>{const a=ix.find(x=>x.name===e.name);return !a||!a.valid||!a.plain||a.method!=="btree"||a.unique!==e.unique||a.primary!==e.primary||!equal(a.columns,e.columns)||a.options.some(x=>x!==0);}))return fail();
    const policies=(await db.query<{name:string;permissive:boolean;command:string;roles:string;using:string;check:string}>("SELECT p.polname AS name,p.polpermissive AS permissive,p.polcmd AS command,p.polroles::text AS roles,pg_get_expr(p.polqual,p.polrelid) AS \"using\",pg_get_expr(p.polwithcheck,p.polrelid) AS \"check\" FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 ORDER BY p.polname",[namespace,resource.table])).rows;
    const expr="("+provisioningTenantExpression+")";
    if(!equal(policies,tenant?[{name:"v3_tenant_access",permissive:true,command:"*",roles:"{0}",using:"true",check:"true"},{name:"v3_tenant_boundary",permissive:false,command:"*",roles:"{0}",using:expr,check:expr}]:[]))return fail();
    const acl=(await db.query<{edges:string[];allowed:boolean;triggers:number;badTriggers:number}>("SELECT ARRAY(SELECT (CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)||':'||pg_get_userbyid(a.grantor)||':'||a.privilege_type||':'||a.is_grantable::text FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a ORDER BY 1) AS edges,(SELECT bool_and(has_table_privilege($3,c.oid,p)= (p IN ('SELECT','INSERT','UPDATE','DELETE')) AND NOT has_table_privilege($3,c.oid,p||' WITH GRANT OPTION')) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p) AS allowed,(SELECT count(*)::int FROM pg_trigger WHERE tgrelid=c.oid) AS triggers,(SELECT count(*)::int FROM pg_trigger WHERE tgrelid=c.oid AND (NOT tgisinternal OR tgenabled<>'O')) AS \"badTriggers\" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2",[namespace,resource.table,t.runtime_role])).rows[0];
    const edges=sorted([...["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"].map(p=>t.installer_role+":"+t.installer_role+":"+p+":false"),...["SELECT","INSERT","UPDATE","DELETE"].map(p=>t.runtime_role+":"+t.installer_role+":"+p+":false")]);
    const fkTriggers=2*(resource.relations.length+resources.reduce((n,r)=>n+r.relations.filter(e=>e.table===resource.table).length,0));
    if(!acl||!acl.allowed||!equal(acl.edges,edges)||acl.badTriggers!==0||acl.triggers!==fkTriggers)return fail();
  }
  if(!equal(indexes.map(x=>x.name),sorted(expectedIndexes)))return fail();
  const extras=(await db.query<{n:number}>("SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1)+(SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typrelid=0 AND t.typelem=0) AS n",[namespace])).rows[0];
  if(Number(extras?.n)!==0)return fail();
}
export class ExperimentalProvisioningUnknown extends Error{constructor(){super("M03_INSTALLER_COMMIT_UNKNOWN_NO_RETRY");}}
export async function installExperimentalRevision(connectionString:string,manifestWire:string,approvalWire:string,signature:string,authority:DisposableDurableRecoveryAuthority,faultProxyPort?:number){
  assertLocalUrl(connectionString,faultProxyPort);
  if(typeof manifestWire!=="string"||manifestWire.length>1024*1024||typeof signature!=="string"||!/^[A-Za-z0-9_-]{86}$/.test(signature))return fail();
  const manifest=parseSchemaManifest(JSON.parse(manifestWire)),e=parseApproval(approvalWire);
  if(JSON.stringify(manifest)!==manifestWire)return fail();
  const db=new Client({connectionString,connectionTimeoutMillis:4000,query_timeout:15000});
  // A one-shot connection's error event is handled; query errors still reject,
  // an unexpected acknowledgement is never converted into success.
  let transportFailed=false;db.on("error",()=>{transportFailed=true;});
  let began=false,commitDispatched=false,admitted=false,ended=false;
  try{
    await db.connect();await db.query("BEGIN");began=true;
    await db.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'; SET LOCAL search_path=pg_catalog");
    await db.query("SELECT pg_advisory_xact_lock(118033,301)");
    const t=await loadTrust(db),state=authority.authenticatedSnapshot(),scope=scopeOf(t);
    const keyBytes=Buffer.from(t.approval_key,"base64"),key=createPublicKey({key:keyBytes,format:"der",type:"spki"});
    if(hash(keyBytes)!==t.approval_key_digest||key.asymmetricKeyType!=="ed25519"||!verify(null,Buffer.from(approvalWire),key,Buffer.from(signature,"base64url"))||
      state.pending||state.businessLease||state.readyProtocol===2||state.epoch!==t.epoch||state.ledgerId!==t.ledger_id||state.databaseName!==t.database_name||state.installationId!==t.installation_id||
      e.applicationId!==t.application_id||e.installationId!==t.installation_id||e.databaseName!==t.database_name||e.databaseOid!==t.database_oid||e.epoch!==t.epoch||
      e.ledgerId!==state.ledgerId||e.authorityHead!==state.head||e.authoritySequence!==state.sequence||e.manifestDigest!==manifest.digest)return fail();
    const heads=(await db.query<{manifest:string;manifest_digest:string;application_id:string;installation_id:string;database_name:string;operator_role:string;runtime_role:string;environment:string}>("SELECT * FROM public.platform_schema_registry")).rows,head=heads[0];
    if(heads.length>1||head&&(head.application_id!==scope.applicationId||head.installation_id!==scope.installationId||head.database_name!==t.database_name||head.operator_role!==t.installer_role||head.runtime_role!==t.runtime_role||head.environment!=="test"))return fail();
    if((head?.manifest_digest??null)!==e.parent)return fail();
    if((await db.query("SELECT 1 FROM public.platform_schema_revisions_v1 WHERE operation_id=$1 OR approval_id=$2",[e.operationId,e.approvalId])).rowCount!==0)return fail();
    const previous=head?parseSchemaManifest(JSON.parse(head.manifest)):null;
    if(previous&&previous.digest!==head?.manifest_digest)return fail();
    if(previous&&(await db.query("SELECT 1 FROM public.platform_schema_revisions_v1 WHERE installation_id=$1 AND revision_digest=$2 AND manifest=$3",[t.installation_id,previous.digest,head?.manifest])).rowCount!==1)return fail();
    await verifyProvisioningHistory(db,t,state.provisioningOperations??[]);
    const plan=compileProvisioningTransition(previous,manifest,scope);
    if(plan.digest!==e.planDigest||plan.physical.digest!==e.physicalDigest)return fail();
    await verifyCatalog(db,t,previous?compileProvisioningContract(previous,scope):null);
    if(!equal(state,authority.authenticatedSnapshot())||transportFailed)return fail();
    const admission:ExperimentalProvisioningAdmission={operationId:e.operationId,approvalId:e.approvalId,epoch:e.epoch,applicationId:e.applicationId,installationId:e.installationId,databaseName:e.databaseName,databaseOid:e.databaseOid,approvalHead:e.authorityHead,approvalSequence:e.authoritySequence,planDigest:e.planDigest,physicalDigest:e.physicalDigest,manifestDigest:e.manifestDigest,parent:e.parent,signedDigest:hash(JSON.stringify([approvalWire,signature]))};
    authority.admitExperimentalProvisioning(admission);admitted=true;
    for(const statement of plan.statements){authority.checkExperimentalProvisioning(e.operationId);await db.query(statement);}
    for(const table of plan.physical.resources){
      if(!previous)await db.query("GRANT SELECT,INSERT,UPDATE,DELETE ON "+qualified(t.namespace,table.table)+" TO "+qi(t.runtime_role));
    }
    await verifyCatalog(db,t,plan.physical);
    if(!head)await db.query("INSERT INTO public.platform_schema_registry(installation_id,application_id,environment,database_name,operator_role,runtime_role,manifest,manifest_digest) VALUES($1,$2,'test',$3,$4,$5,$6,$7)",[t.installation_id,t.application_id,t.database_name,t.installer_role,t.runtime_role,manifestWire,manifest.digest]);
    else if((await db.query("UPDATE public.platform_schema_registry SET manifest=$1,manifest_digest=$2,updated_at=clock_timestamp() WHERE installation_id=$3 AND manifest_digest=$4",[manifestWire,manifest.digest,t.installation_id,e.parent])).rowCount!==1)return fail();
    await db.query("INSERT INTO public.platform_schema_revisions_v1(installation_id,revision_digest,parent_digest,manifest,physical_digest,plan_digest,operation_id,approval_id,authority_epoch,authority_head,authority_sequence,signer_digest,signed_evidence,signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",[t.installation_id,manifest.digest,e.parent,manifestWire,e.physicalDigest,e.planDigest,e.operationId,e.approvalId,e.epoch,e.authorityHead,e.authoritySequence,t.approval_key_digest,approvalWire,signature]);
    authority.checkExperimentalProvisioning(e.operationId);if(transportFailed)return fail();
    commitDispatched=true;
    if((await db.query("COMMIT")).command!=="COMMIT"||transportFailed)throw new ExperimentalProvisioningUnknown();
    await db.end();ended=true;
    authority.settleExperimentalProvisioning(e.operationId,"COMMITTED");admitted=false;
    return {status:"ACTIVE" as const,revision:manifest.digest,operationId:e.operationId,physicalDigest:e.physicalDigest,planDigest:e.planDigest};
  }catch(error){
    let rollback=false;
    if(!commitDispatched&&began)rollback=await db.query("ROLLBACK").then(x=>x.command==="ROLLBACK",()=>false);
    if(!ended){try{await db.end();ended=true;}catch{rollback=false;}}
    if(admitted){
      const outcome=!commitDispatched&&rollback&&!transportFailed?"ROLLED_BACK":"UNCERTAIN";
      authority.settleExperimentalProvisioning(e.operationId,outcome);
      if(outcome==="UNCERTAIN")throw new ExperimentalProvisioningUnknown();
    }
    throw error;
  }finally{if(!ended)await db.end().catch(()=>undefined);}
}
export async function verifyExperimentalProvisionedCatalog(connectionString:string,manifestWire:string){
  assertLocalUrl(connectionString);
  const manifest=parseSchemaManifest(JSON.parse(manifestWire)),db=new Client({connectionString,connectionTimeoutMillis:4000,query_timeout:15000});
  try{
    await db.connect();await db.query("BEGIN READ ONLY");await db.query("SET LOCAL search_path=pg_catalog");
    const t=await loadTrust(db),physical=compileProvisioningContract(manifest,scopeOf(t));
    if((await db.query("SELECT 1 FROM public.platform_schema_registry r JOIN public.platform_schema_revisions_v1 v ON v.installation_id=r.installation_id AND v.revision_digest=r.manifest_digest WHERE r.installation_id=$1 AND r.manifest_digest=$2 AND v.manifest=$3 AND v.physical_digest=$4",[t.installation_id,manifest.digest,manifestWire,physical.digest])).rowCount!==1)return fail();
    await verifyCatalog(db,t,physical);await db.query("COMMIT");return physical.digest;
  }finally{await db.end().catch(()=>undefined);}
}


type HistoryOperation=ExperimentalProvisioningAdmission & {outcome:"ADMITTED"|"UNCERTAIN"|"COMMITTED"|"ROLLED_BACK"};
interface RevisionRow {
 installation_id:string;revision_digest:string;parent_digest:string|null;manifest:string;physical_digest:string;plan_digest:string;operation_id:string;approval_id:string;authority_epoch:string;authority_head:string;authority_sequence:string;signer_digest:string;signed_evidence:string;signature:string
}
async function verifyProvisioningHistory(db:ClientBase,t:Trust,operations:readonly HistoryOperation[],resolveId?:string){
  const expected=operations.filter(o=>o.outcome==="COMMITTED"||o.operationId===resolveId);
  const rows=(await db.query<RevisionRow>("SELECT * FROM public.platform_schema_revisions_v1 ORDER BY applied_at,operation_id")).rows;
  if(rows.length!==expected.length)return fail();
  const keyBytes=Buffer.from(t.approval_key,"base64"),key=createPublicKey({key:keyBytes,format:"der",type:"spki"});
  if(hash(keyBytes)!==t.approval_key_digest||t.revoked||key.asymmetricKeyType!=="ed25519")return fail();
  for(const o of expected){
    const row=rows.find(x=>x.operation_id===o.operationId);
    if(!row||row.installation_id!==t.installation_id||row.revision_digest!==o.manifestDigest||row.parent_digest!==o.parent||row.approval_id!==o.approvalId||
      row.authority_epoch!==o.epoch||row.authority_head!==o.approvalHead||Number(row.authority_sequence)!==o.approvalSequence||
      row.plan_digest!==o.planDigest||row.physical_digest!==o.physicalDigest||row.signer_digest!==t.approval_key_digest||
      hash(JSON.stringify([row.signed_evidence,row.signature]))!==o.signedDigest||
      !verify(null,Buffer.from(row.signed_evidence),key,Buffer.from(row.signature,"base64url")))return fail();
    const e=parseApproval(row.signed_evidence),manifest=parseSchemaManifest(JSON.parse(row.manifest));
    if(manifest.digest!==row.revision_digest||JSON.stringify(manifest)!==row.manifest||e.operationId!==row.operation_id||
      e.installationId!==t.installation_id||e.applicationId!==t.application_id||e.databaseName!==t.database_name||
      e.databaseOid!==t.database_oid||e.ledgerId!==t.ledger_id||e.manifestDigest!==manifest.digest||
      compileProvisioningContract(manifest,scopeOf(t)).digest!==row.physical_digest)return fail();
  }
  return rows;
}
export interface ProvisioningCommitEvidence{
  version:1;operationId:string;databaseName:string;databaseOid:string;systemIdentifier:string;timeline:number;installationId:string;epoch:string;revision:string;physicalDigest:string;historyDigest:string;dataDigests:Record<string,string>;
}
export async function collectExperimentalProvisioningCommit(db:ClientBase,operations:readonly HistoryOperation[],operationId:string):Promise<ProvisioningCommitEvidence>{
  const id=await identity(db);
  if(!id.superuser)return fail();
  const quiescent=async()=>{
    const row=(await db.query<{allow:boolean;others:number;prepared:number;system:string;timeline:number}>("SELECT d.datallowconn AS allow,(SELECT count(*)::int FROM pg_stat_activity WHERE datid=d.oid AND pid<>pg_backend_pid()) AS others,(SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database()) AS prepared,(pg_control_system()).system_identifier::text AS system,(pg_control_checkpoint()).timeline_id AS timeline FROM pg_database d WHERE d.datname=current_database()")).rows[0];
    if(!row||row.allow||row.others||row.prepared)return fail();return row;
  };
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try{
    await db.query("SET LOCAL search_path=pg_catalog");
    const before=await quiescent(),trustRows=(await db.query<Trust>("SELECT * FROM public.platform_schema_installation_trust_v1")).rows,t=trustRows[0],op=operations.find(o=>o.operationId===operationId);
    if(trustRows.length!==1||!t||!op||op.outcome!=="UNCERTAIN"||t.database_name!==id.name||t.database_oid!==id.oid||t.system_identifier!==before.system||t.timeline!==before.timeline||
      t.installation_id!==op.installationId||t.epoch!==op.epoch||t.application_id!==op.applicationId)return fail();
    await roleContract(db,t.installer_role,t.runtime_role,t.namespace);
    const rows=await verifyProvisioningHistory(db,t,operations,operationId),last=rows.find(r=>r.operation_id===operationId);
    if(!last)return fail();
    const manifest=parseSchemaManifest(JSON.parse(last.manifest)),physical=compileProvisioningContract(manifest,scopeOf(t));
    const head=(await db.query<{manifest_digest:string;manifest:string}>("SELECT manifest_digest,manifest FROM public.platform_schema_registry")).rows;
    if(head.length!==1||head[0]?.manifest_digest!==manifest.digest||head[0].manifest!==last.manifest)return fail();
    await verifyCatalog(db,t,physical);
    const dataDigests:Record<string,string>={};
    for(const resource of physical.resources){
      const values=(await db.query<{value:string}>("SELECT to_jsonb(t)::text AS value FROM "+qualified(t.namespace,resource.table)+" t ORDER BY value LIMIT 1001")).rows;
      if(values.length>1000)return fail();
      dataDigests[resource.table]=hash(JSON.stringify(values.map(v=>v.value)));
    }
    await db.query("SELECT pg_stat_clear_snapshot()");
    if(!equal(before,await quiescent()))return fail();
    await db.query("COMMIT");
    return {version:1,operationId,databaseName:id.name,databaseOid:id.oid,systemIdentifier:before.system,timeline:before.timeline,installationId:t.installation_id,epoch:t.epoch,revision:manifest.digest,physicalDigest:physical.digest,historyDigest:hash(JSON.stringify(rows.map(r=>[r.revision_digest,r.operation_id,r.signature,r.parent_digest]))),dataDigests};
  }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}
}
