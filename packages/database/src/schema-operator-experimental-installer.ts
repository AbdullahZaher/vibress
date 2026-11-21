// Experimental operator-only component. Not exported by serving database API.
// Root owns trust configuration; installer is a trusted one-shot DDL principal,
// never an arbitrary SQL service or security sandbox for its own credentials.
import {createHash,createPublicKey,verify,type KeyObject} from "node:crypto";
import {Client,type ClientBase} from "pg";
import {asApplicationId,asInstallationId} from "@vibress/platform-kernel";
import {compileProvisioningContract,compileProvisioningTransition,compileRenameIntent,enforceBoundedJson,parseSchemaManifest,provisioningConstraintName,provisioningConstraints,provisioningColumnCollationV1,provisioningIndexKeyV1,provisioningIdentifier as qi,provisioningNamespace,provisioningTenantExpression,PROVISIONING_PROFILE,isProvisioningProfile,provisioningProfileFor,type ProvisioningProfile,type ProvisioningContract} from "@vibress/schema-engine";
import {CURRENT_STUDIO_VERSION,assertStudioDocumentEditable,checkDocumentResourceLimits,normalizeStudioDocument,validateStudioDocument} from "@vibress/studio-core";
import {verifyProtectedMetadataAuthority} from "./schema-operator-experimental-protected-acl";
import {recordExperimentalLifecycleTransition} from "./schema-operator-experimental-registry-lifecycle";
import type {DisposableDurableRecoveryAuthority,ExperimentalProvisioningAdmission} from "./schema-operator-experimental-durable-authority";
const fail=(reason="INVARIANT"):never=>{throw Error("M03_PROVISIONING_REFUSED:"+reason);};
const backfillRefusal=(reason:string):never=>{throw Error("M03_BACKFILL_REFUSED:"+reason);};
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
  // CI is pinned to the canonical 5433 topology; local test runs may also use
  // the separately owned 16.16 container on 5434 with identical credentials.
  const ports=process.env.GITHUB_ACTIONS==="true"?["5433"]:["5433","5434"];
  if(process.env.NODE_ENV!=="test"||u.protocol!=="postgresql:"||!["127.0.0.1","localhost"].includes(u.hostname)||(!ports.includes(u.port)&&(faultProxyPort===undefined||!Number.isInteger(faultProxyPort)||Number(u.port)!==faultProxyPort))||!/^\/vibress_s03_norm_[a-z0-9_]+$/.test(u.pathname)||u.search||u.hash)return fail();
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
  await verifyProtectedMetadataAuthority((sql,values)=>db.query(sql,values),installer,runtime,namespace);
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
    await db.query("GRANT SELECT ON public.platform_schema_installation_trust_v1,public.platform_schema_registry,public.platform_schema_revisions_v1,public.platform_schema_backfill_chunks_v1,public.platform_schema_backfill_targets_v1,public.platform_schema_rename_phases_v1,public.platform_schema_rename_chunks_v1,public.platform_schema_rename_progress_v1,public.platform_schema_revision_states_v1 TO "+qi(installer));
    await db.query("GRANT INSERT ON public.platform_schema_registry,public.platform_schema_revisions_v1,public.platform_schema_backfill_chunks_v1,public.platform_schema_backfill_targets_v1,public.platform_schema_rename_phases_v1,public.platform_schema_rename_chunks_v1,public.platform_schema_rename_progress_v1,public.platform_schema_revision_states_v1,public.platform_schema_state_transitions_v1 TO "+qi(installer));
    await db.query("GRANT UPDATE(chunks,affected_total,complete,completed_at,updated_at) ON public.platform_schema_backfill_targets_v1,public.platform_schema_rename_progress_v1 TO "+qi(installer));
    await db.query("GRANT UPDATE(state,state_version,operation_id,approval_id,authority_epoch,authority_head,authority_sequence,actor,updated_at) ON public.platform_schema_revision_states_v1 TO "+qi(installer));
    await db.query("GRANT UPDATE(manifest,manifest_digest,updated_at) ON public.platform_schema_registry TO "+qi(installer));
    await db.query("GRANT SELECT(installation_id,application_id,database_name,database_oid,system_identifier,timeline,epoch,ledger_id,profile,revoked,runtime_role,approval_key,approval_key_digest) ON public.platform_schema_installation_trust_v1 TO "+qi(runtime));
    await db.query("GRANT SELECT(installation_id,manifest_digest) ON public.platform_schema_registry TO "+qi(runtime));
    await db.query("GRANT INSERT(operation_id,evidence,signature) ON public.platform_schema_business_witnesses_v1 TO "+qi(runtime));
    // PG16 control-data functions otherwise retain default PUBLIC EXECUTE.
    await db.query("REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system(),pg_catalog.pg_control_checkpoint() FROM PUBLIC");
    await db.query("GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system(),pg_catalog.pg_control_checkpoint() TO "+qi(runtime)+","+qi(installer));
    await roleContract(db,installer,runtime,namespace);
    if(!equal(state,authority.authenticatedSnapshot()))return fail();
    await db.query("COMMIT");
    return namespace;
  }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}
}
// Approval is a canonical bounded wire string, not a mutable caller object.
// Only an installation-configured key is loaded by the installer.
export interface ProvisioningApproval {version:1;profile:ProvisioningProfile;applicationId:string;installationId:string;databaseName:string;databaseOid:string;epoch:string;ledgerId:string;authorityHead:string;authoritySequence:number;parent:string|null;manifestDigest:string;physicalDigest:string;planDigest:string;operationId:string;approvalId:string}
export function provisioningApprovalMessage(e:ProvisioningApproval){
  return JSON.stringify(["VIBRESS-M03-PROVISIONING-APPROVAL-V1",e.version,e.profile,e.applicationId,e.installationId,e.databaseName,e.databaseOid,e.epoch,e.ledgerId,e.authorityHead,e.authoritySequence,e.parent,e.manifestDigest,e.physicalDigest,e.planDigest,e.operationId,e.approvalId]);
}
function parseApproval(wire:string):ProvisioningApproval{
  if(typeof wire!=="string"||wire.length>4096)return fail();
  const raw:unknown=JSON.parse(wire);
  if(!Array.isArray(raw)||raw.length!==17||raw[0]!=="VIBRESS-M03-PROVISIONING-APPROVAL-V1")return fail();
  const [_,version,profile,applicationId,installationId,databaseName,databaseOid,epoch,ledgerId,authorityHead,authoritySequence,parent,manifestDigest,physicalDigest,planDigest,operationId,approvalId]=raw as unknown[];
  const s=(v:unknown,re:RegExp):v is string=>typeof v==="string"&&re.test(v);
  if(version!==1||!isProvisioningProfile(profile)||!s(applicationId,/^[a-z][a-z0-9_-]{1,62}$/)||!s(installationId,/^[a-z][a-z0-9_-]{1,62}$/)||
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
  // An OID and logical database name can survive PITR. Non-recovery
  // operations must match the configured physical identity and timeline too.
  const physical=(await db.query<{system:string;timeline:number}>("SELECT (pg_catalog.pg_control_system()).system_identifier::text AS system,(pg_catalog.pg_control_checkpoint()).timeline_id AS timeline")).rows;
  if(physical.length!==1||physical[0]?.system!==t.system_identifier||physical[0]?.timeline!==t.timeline)return fail("PHYSICAL_IDENTITY");
  await roleContract(db,t.installer_role,t.runtime_role,t.namespace);
  return t;
}
async function verifyCatalog(db:ClientBase,t:Trust,expected:ProvisioningContract|null){
  const resources=expected?.resources??[],namespace=t.namespace;
  // CORE V1 compiler emits ordinary tables and the PG16 default collation.
  // Verify those original semantics without changing signed V1 digest.
  const topology=(await db.query<{bad:boolean}>(`SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class parent ON parent.oid=i.inhparent JOIN pg_catalog.pg_namespace pn ON pn.oid=parent.relnamespace JOIN pg_catalog.pg_class child ON child.oid=i.inhrelid JOIN pg_catalog.pg_namespace cn ON cn.oid=child.relnamespace WHERE pn.nspname=$1 OR cn.nspname=$1)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relispartition)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1) AS bad`,[namespace])).rows[0];
  if(!topology||topology.bad)return fail("CATALOG_TOPOLOGY_V1");
  const objects=(await db.query<{name:string;kind:string;owner:string;permanent:string;rls:boolean;forced:boolean}>("SELECT c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner) AS owner,c.relpersistence AS permanent,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname",[namespace])).rows;
  const tables=objects.filter(x=>x.kind==="r"),indexes=objects.filter(x=>x.kind==="i");
  if(objects.length!==tables.length+indexes.length||!equal(tables.map(x=>x.name),sorted(resources.map(x=>x.table)))||objects.some(x=>x.owner!==t.installer_role||x.permanent!=="p"))return fail("CATALOG_1");
  const expectedIndexes:string[]=[];
  for(const resource of resources){
    const table=tables.find(x=>x.name===resource.table),tenant=resource.ownership==="tenant";
    if(!table||table.rls!==tenant||table.forced!==tenant)return fail("CATALOG_2");
    const cols=(await db.query<{name:string;type:string;required:boolean;hasdefault:boolean;identity:string;generated:string;acl:boolean}>("SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,a.atthasdef AS hasdefault,a.attidentity AS identity,a.attgenerated AS generated,a.attacl IS NOT NULL AS acl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname",[namespace,resource.table])).rows;
    const desired=resource.columns.map(c=>({name:c.name,type:c.type,required:c.required,hasdefault:false,identity:"",generated:"",acl:false})).sort((a,b)=>a.name.localeCompare(b.name,"en"));
    if(!equal(cols,desired))return fail("CATALOG_3");
    const columnCollations=(await db.query<{name:string;collation:string|null}>(`SELECT a.attname::text AS name,CASE WHEN co.oid IS NULL THEN NULL ELSE cn.nspname||'.'||co.collname END AS collation FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=co.collnamespace WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`,[namespace,resource.table])).rows;
    if(!equal(columnCollations,desired.map(c=>({name:c.name,collation:provisioningColumnCollationV1(c.type)}))))return fail("CATALOG_COLUMN_COLLATION_V1");
    const cons=(await db.query<{name:string;kind:string;columns:string[];target:string|null;targetNamespace:string|null;targetColumns:string[];valid:boolean;defer:boolean;update:string;del:string;match:string;expression:string}>("SELECT co.conname AS name,co.contype AS kind,ARRAY(SELECT a.attname::text FROM unnest(co.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum ORDER BY k.ord) AS columns,f.relname AS target,fn.nspname AS \"targetNamespace\",ARRAY(SELECT a.attname::text FROM unnest(co.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=f.oid AND a.attnum=k.attnum ORDER BY k.ord) AS \"targetColumns\",co.convalidated AS valid,co.condeferrable OR co.condeferred AS defer,co.confupdtype AS update,co.confdeltype AS del,co.confmatchtype AS match,coalesce(pg_get_expr(co.conbin,co.conrelid),'') AS expression FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class f ON f.oid=co.confrelid LEFT JOIN pg_namespace fn ON fn.oid=f.relnamespace WHERE n.nspname=$1 AND c.relname=$2 ORDER BY co.conname",[namespace,resource.table])).rows;
    const constraints=provisioningConstraints(resource,namespace);
    const enums=resource.columns.filter(c=>c.enumValues),checks=resource.checks??[];
    if(cons.length!==constraints.length+enums.length+checks.length)return fail("CATALOG_4");
    for(const c of constraints){
      const actual=cons.find(x=>x.name===c.name);
      if(!actual||!actual.valid||actual.defer||actual.kind!==c.kind||!equal(actual.columns,c.columns)||actual.target!==c.target||!equal(actual.targetColumns,c.targetColumns))return fail("CATALOG_5");
      if(c.kind==="f"&&(actual.targetNamespace!==namespace||actual.update!=="r"||actual.del!=="r"||actual.match!=="s"))return fail("CATALOG_6");
      if(c.kind!=="f")expectedIndexes.push(c.name);
    }
    for(const e of enums){
      const actual=cons.find(x=>x.name===provisioningConstraintName(resource.table,"enum",e.name));
      const expression="("+e.name+" = ANY (ARRAY["+e.enumValues!.map(v=>"'"+v+"'::text").join(", ")+"]))";
      if(!actual||actual.kind!=="c"||!actual.valid||!equal(actual.columns,[e.name])||actual.expression!==expression)return fail("CATALOG_7");
    }
    for(const ck of checks){
      const actual=cons.find(x=>x.name===ck.name);
      if(!actual||actual.kind!=="c"||!actual.valid||!equal(actual.columns,ck.columns)||actual.expression!==ck.normalized)return fail("CATALOG_CHECK_V2");
    }
    const ix=(await db.query<{name:string;columns:string[];unique:boolean;primary:boolean;valid:boolean;method:string;plain:boolean;options:number[]}>("SELECT i.relname AS name,ARRAY(SELECT a.attname::text FROM unnest(x.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum ORDER BY k.ord) AS columns,x.indisunique AS \"unique\",x.indisprimary AS \"primary\",x.indisvalid AND x.indisready AND x.indislive AS valid,am.amname AS method,x.indexprs IS NULL AND x.indpred IS NULL AND x.indnatts=x.indnkeyatts AS plain,ARRAY(SELECT unnest(x.indoption)::int) AS options FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_am am ON am.oid=i.relam WHERE n.nspname=$1 AND c.relname=$2",[namespace,resource.table])).rows;
    const expectedIx=[...constraints.filter(c=>c.kind!=="f").map(c=>({name:c.name,columns:c.columns,unique:true,primary:c.kind==="p"})),...resource.relations.map(e=>({name:provisioningConstraintName(resource.table,"ix",e.column),columns:e.columns,unique:false,primary:false})),...(resource.indexes??[]).map(columns=>({name:provisioningConstraintName(resource.table,"ix",columns.join("_")),columns,unique:false,primary:false}))];
    for(const e of expectedIx)if(!e.unique)expectedIndexes.push(e.name);
    if(ix.length!==expectedIx.length||expectedIx.some(e=>{const a=ix.find(x=>x.name===e.name);return !a||!a.valid||!a.plain||a.method!=="btree"||a.unique!==e.unique||a.primary!==e.primary||!equal(a.columns,e.columns)||a.options.some(x=>x!==0);}))return fail("CATALOG_8");
    const indexSemantics=(await db.query<{name:string;opclasses:string[];families:string[];collations:string[];safe:boolean}>(`SELECT i.relname::text AS name,
      ARRAY(SELECT onsp.nspname||'.'||o.opcname FROM unnest(x.indclass) WITH ORDINALITY k(id,ord) JOIN pg_catalog.pg_opclass o ON o.oid=k.id JOIN pg_catalog.pg_namespace onsp ON onsp.oid=o.opcnamespace ORDER BY k.ord) AS opclasses,
      ARRAY(SELECT fn.nspname||'.'||f.opfname FROM unnest(x.indclass) WITH ORDINALITY k(id,ord) JOIN pg_catalog.pg_opclass o ON o.oid=k.id JOIN pg_catalog.pg_opfamily f ON f.oid=o.opcfamily JOIN pg_catalog.pg_namespace fn ON fn.oid=f.opfnamespace ORDER BY k.ord) AS families,
      ARRAY(SELECT CASE WHEN k.id=0 THEN '-' ELSE cn.nspname||'.'||co.collname END FROM unnest(x.indcollation) WITH ORDINALITY k(id,ord) LEFT JOIN pg_catalog.pg_collation co ON co.oid=k.id LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=co.collnamespace ORDER BY k.ord) AS collations,
      (NOT x.indnullsnotdistinct AND x.indimmediate AND NOT x.indisexclusion AND NOT x.indisclustered AND NOT x.indisreplident) AS safe
      FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class c ON c.oid=x.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid WHERE n.nspname=$1 AND c.relname=$2`,[namespace,resource.table])).rows;
    for(const e of expectedIx){
      const a=indexSemantics.find(x=>x.name===e.name);
      const keys=e.columns.map(name=>{const column=resource.columns.find(c=>c.name===name);if(!column)return fail("CATALOG_INDEX_TYPE_V1");try{return provisioningIndexKeyV1(column.type);}catch{return fail("CATALOG_INDEX_TYPE_V1");}});
      if(!a||!a.safe||!equal(a.opclasses,keys.map(k=>k.opclass))||!equal(a.families,keys.map(k=>k.family))||!equal(a.collations,keys.map(k=>k.collation)))return fail("CATALOG_INDEX_SEMANTICS_V1");
    }
    const links=(await db.query<{name:string;index:string|null;indexNamespace:string|null;safe:boolean}>(`SELECT co.conname::text AS name,i.relname::text AS index,ins.nspname::text AS "indexNamespace",(co.conparentid=0 AND co.coninhcount=0 AND co.conislocal) AS safe FROM pg_catalog.pg_constraint co JOIN pg_catalog.pg_class c ON c.oid=co.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_class i ON i.oid=co.conindid LEFT JOIN pg_catalog.pg_namespace ins ON ins.oid=i.relnamespace WHERE n.nspname=$1 AND c.relname=$2`,[namespace,resource.table])).rows;
    for(const co of links){
      const expectedConstraint=constraints.find(c=>c.name===co.name);
      const expectedIndex=expectedConstraint?(expectedConstraint.kind==="f"?provisioningConstraintName(expectedConstraint.target!,"pk"):expectedConstraint.name):null;
      if(!co.safe||co.index!==expectedIndex||co.indexNamespace!==(expectedIndex?namespace:null))return fail("CATALOG_CONSTRAINT_INDEX_V1");
    }
    const triggerRows=(await db.query<{constraint:string;other:string;function:string;event:number;safe:boolean}>(`SELECT co.conname::text AS constraint,other.relname::text AS other,p.proname::text AS function,tg.tgtype::int AS event,
      (tg.tgisinternal AND tg.tgenabled='O' AND NOT tg.tgdeferrable AND NOT tg.tginitdeferred AND tg.tgparentid=0 AND tg.tgconstrindid=co.conindid AND tg.tgqual IS NULL AND tg.tgnargs=0 AND tg.tgattr::text='' AND tg.tgoldtable IS NULL AND tg.tgnewtable IS NULL AND pn.nspname='pg_catalog' AND onsp.nspname=$1 AND co.contype='f') AS safe
      FROM pg_catalog.pg_trigger tg JOIN pg_catalog.pg_class c ON c.oid=tg.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_constraint co ON co.oid=tg.tgconstraint LEFT JOIN pg_catalog.pg_class other ON other.oid=tg.tgconstrrelid LEFT JOIN pg_catalog.pg_namespace onsp ON onsp.oid=other.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=tg.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname=$1 AND c.relname=$2`,[namespace,resource.table])).rows;
    const triggerExpected=resource.relations.flatMap(e=>[{constraint:provisioningConstraintName(resource.table,"fk",e.column),other:e.table,function:"RI_FKey_check_ins",event:5,safe:true},{constraint:provisioningConstraintName(resource.table,"fk",e.column),other:e.table,function:"RI_FKey_check_upd",event:17,safe:true}]);
    for(const origin of resources)for(const e of origin.relations.filter(e=>e.table===resource.table))triggerExpected.push({constraint:provisioningConstraintName(origin.table,"fk",e.column),other:origin.table,function:"RI_FKey_restrict_del",event:9,safe:true},{constraint:provisioningConstraintName(origin.table,"fk",e.column),other:origin.table,function:"RI_FKey_restrict_upd",event:17,safe:true});
    if(!equal(sorted(triggerRows.map(x=>JSON.stringify(x))),sorted(triggerExpected.map(x=>JSON.stringify(x)))))return fail("CATALOG_TRIGGER_IDENTITY_V1");
    const policies=(await db.query<{name:string;permissive:boolean;command:string;roles:string;using:string;check:string}>("SELECT p.polname AS name,p.polpermissive AS permissive,p.polcmd AS command,p.polroles::text AS roles,pg_get_expr(p.polqual,p.polrelid) AS \"using\",pg_get_expr(p.polwithcheck,p.polrelid) AS \"check\" FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 ORDER BY p.polname",[namespace,resource.table])).rows;
    const expr="("+provisioningTenantExpression(t.application_id)+")";
    if(!equal(policies,tenant?[{name:"v3_tenant_access",permissive:true,command:"*",roles:"{0}",using:"true",check:"true"},{name:"v3_tenant_boundary",permissive:false,command:"*",roles:"{0}",using:expr,check:expr}]:[]))return fail("CATALOG_9");
    const acl=(await db.query<{edges:string[];allowed:boolean;triggers:number;badTriggers:number}>("SELECT ARRAY(SELECT (CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)||':'||pg_get_userbyid(a.grantor)||':'||a.privilege_type||':'||a.is_grantable::text FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a ORDER BY 1) AS edges,(SELECT bool_and(has_table_privilege($3,c.oid,p)= (p IN ('SELECT','INSERT','UPDATE','DELETE')) AND NOT has_table_privilege($3,c.oid,p||' WITH GRANT OPTION')) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p) AS allowed,(SELECT count(*)::int FROM pg_trigger WHERE tgrelid=c.oid) AS triggers,(SELECT count(*)::int FROM pg_trigger WHERE tgrelid=c.oid AND (NOT tgisinternal OR tgenabled<>'O')) AS \"badTriggers\" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2",[namespace,resource.table,t.runtime_role])).rows[0];
    const edges=sorted([...["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"].map(p=>t.installer_role+":"+t.installer_role+":"+p+":false"),...["SELECT","INSERT","UPDATE","DELETE"].map(p=>t.runtime_role+":"+t.installer_role+":"+p+":false")]);
    const fkTriggers=2*(resource.relations.length+resources.reduce((n,r)=>n+r.relations.filter(e=>e.table===resource.table).length,0));
    if(!acl||!acl.allowed||!equal(acl.edges,edges)||acl.badTriggers!==0||acl.triggers!==fkTriggers)return fail("CATALOG_10");
  }
  if(!equal(indexes.map(x=>x.name),sorted(expectedIndexes)))return fail("CATALOG_11");
  const extras=(await db.query<{n:number}>("SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1)+(SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typrelid=0 AND t.typelem=0) AS n",[namespace])).rows[0];
  if(Number(extras?.n)!==0)return fail("CATALOG_12");
}
export class ExperimentalProvisioningUnknown extends Error{constructor(){super("M03_INSTALLER_COMMIT_UNKNOWN_NO_RETRY");}}
/**
 * A READY V2 authority admits a new revision only when the approval extends
 * the cluster's persisted ACTIVE revision. Trust/identity, physical database,
 * timeline, epoch and approval head are verified separately by loadTrust and
 * the caller; this predicate owns the revision binding alone.
 */
export function readyV2AdmissionRefusal(state:{readyProtocol?:2},approval:{parent:string|null},activeParentDigest:string|null):string|null{
  if(state.readyProtocol!==2)return "NOT_V2";
  if(approval.parent===null||activeParentDigest===null||approval.parent!==activeParentDigest)return "ACTIVE_PARENT";
  return null;
}
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
      state.pending||state.businessLease||state.epoch!==t.epoch||state.ledgerId!==t.ledger_id||state.databaseName!==t.database_name||state.installationId!==t.installation_id||
      e.applicationId!==t.application_id||e.installationId!==t.installation_id||e.databaseName!==t.database_name||e.databaseOid!==t.database_oid||e.epoch!==t.epoch||
      e.ledgerId!==state.ledgerId||e.authorityHead!==state.head||e.authoritySequence!==state.sequence||e.manifestDigest!==manifest.digest||
      e.profile!==provisioningProfileFor(manifest))return fail();
    const heads=(await db.query<{manifest:string;manifest_digest:string;application_id:string;installation_id:string;database_name:string;operator_role:string;runtime_role:string;environment:string}>("SELECT * FROM public.platform_schema_registry")).rows,head=heads[0];
    const activeRows=(await db.query<{revision_digest:string}>("SELECT revision_digest FROM public.platform_schema_revision_states_v1 WHERE installation_id=$1 AND state='ACTIVE'",[t.installation_id])).rows;
    if(head?activeRows.length!==1||activeRows[0]?.revision_digest!==head.manifest_digest:activeRows.length!==0)return fail("LIFECYCLE");
    if(heads.length>1||head&&(head.application_id!==scope.applicationId||head.installation_id!==scope.installationId||head.database_name!==t.database_name||head.operator_role!==t.installer_role||head.runtime_role!==t.runtime_role||head.environment!=="test"))return fail();
    if((head?.manifest_digest??null)!==e.parent)return fail();
    if((await db.query("SELECT 1 FROM public.platform_schema_revisions_v1 WHERE operation_id=$1 OR approval_id=$2",[e.operationId,e.approvalId])).rowCount!==0)return fail();
    const previous=head?parseSchemaManifest(JSON.parse(head.manifest)):null;
    if(previous&&previous.digest!==head?.manifest_digest)return fail();
    if(previous&&(await db.query("SELECT 1 FROM public.platform_schema_revisions_v1 WHERE installation_id=$1 AND revision_digest=$2 AND manifest=$3",[t.installation_id,previous.digest,head?.manifest])).rowCount!==1)return fail();
    await verifyProvisioningHistory(db,t,state.provisioningOperations??[]);
    if(state.readyProtocol===2&&readyV2AdmissionRefusal(state,e,activeRows[0]?.revision_digest??null)!==null)return fail("READY_V2_BIND");
    const plan=compileProvisioningTransition(previous,manifest,scope);
    if(plan.digest!==e.planDigest||plan.physical.digest!==e.physicalDigest)return fail();
    await verifyCatalog(db,t,previous?compileProvisioningContract(previous,scope):null);
    if(!equal(state,authority.authenticatedSnapshot())||transportFailed)return fail();
    await recordExperimentalLifecycleTransition(db,{installationId:t.installation_id,revisionDigest:manifest.digest,expectedState:"APPROVED",nextState:"PROVISIONING",operationId:e.operationId,approvalId:e.approvalId,epoch:e.epoch,head:e.authorityHead,sequence:e.authoritySequence,actor:t.installer_role});
    const admission:ExperimentalProvisioningAdmission={operationId:e.operationId,approvalId:e.approvalId,epoch:e.epoch,applicationId:e.applicationId,installationId:e.installationId,databaseName:e.databaseName,databaseOid:e.databaseOid,approvalHead:e.authorityHead,approvalSequence:e.authoritySequence,planDigest:e.planDigest,physicalDigest:e.physicalDigest,manifestDigest:e.manifestDigest,parent:e.parent,signedDigest:hash(JSON.stringify([approvalWire,signature]))};
    authority.admitExperimentalProvisioning(admission);admitted=true;
    for(const statement of plan.statements){authority.checkExperimentalProvisioning(e.operationId);await db.query(statement);}
    for(const table of plan.physical.resources){
      if(!previous)await db.query("GRANT SELECT,INSERT,UPDATE,DELETE ON "+qualified(t.namespace,table.table)+" TO "+qi(t.runtime_role));
    }
    await verifyCatalog(db,t,plan.physical);
    await roleContract(db,t.installer_role,t.runtime_role,t.namespace);
    if(!head)await db.query("INSERT INTO public.platform_schema_registry(installation_id,application_id,environment,database_name,operator_role,runtime_role,manifest,manifest_digest) VALUES($1,$2,'test',$3,$4,$5,$6,$7)",[t.installation_id,t.application_id,t.database_name,t.installer_role,t.runtime_role,manifestWire,manifest.digest]);
    else if((await db.query("UPDATE public.platform_schema_registry SET manifest=$1,manifest_digest=$2,updated_at=clock_timestamp() WHERE installation_id=$3 AND manifest_digest=$4",[manifestWire,manifest.digest,t.installation_id,e.parent])).rowCount!==1)return fail();
    await db.query("INSERT INTO public.platform_schema_revisions_v1(installation_id,revision_digest,parent_digest,manifest,physical_digest,plan_digest,operation_id,approval_id,authority_epoch,authority_head,authority_sequence,signer_digest,signed_evidence,signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",[t.installation_id,manifest.digest,e.parent,manifestWire,e.physicalDigest,e.planDigest,e.operationId,e.approvalId,e.epoch,e.authorityHead,e.authoritySequence,t.approval_key_digest,approvalWire,signature]);
    await recordExperimentalLifecycleTransition(db,{installationId:t.installation_id,revisionDigest:manifest.digest,expectedState:"PROVISIONING",nextState:"DB_COMMITTED",operationId:e.operationId,approvalId:e.approvalId,epoch:e.epoch,head:e.authorityHead,sequence:e.authoritySequence,actor:t.installer_role});
    await roleContract(db,t.installer_role,t.runtime_role,t.namespace);
    authority.checkExperimentalProvisioning(e.operationId);if(transportFailed)return fail();
    commitDispatched=true;
    if((await db.query("COMMIT")).command!=="COMMIT"||transportFailed)throw new ExperimentalProvisioningUnknown();
    try{
      await db.query("BEGIN");
      await recordExperimentalLifecycleTransition(db,{installationId:t.installation_id,revisionDigest:manifest.digest,expectedState:"DB_COMMITTED",nextState:"ACTIVE",operationId:e.operationId,approvalId:e.approvalId,epoch:e.epoch,head:e.authorityHead,sequence:e.authoritySequence,actor:t.installer_role});
      if(e.parent!==null)await recordExperimentalLifecycleTransition(db,{installationId:t.installation_id,revisionDigest:e.parent,expectedState:"ACTIVE",nextState:"SUPERSEDED",operationId:e.operationId,approvalId:e.approvalId,epoch:e.epoch,head:e.authorityHead,sequence:e.authoritySequence,actor:t.installer_role});
      if((await db.query("COMMIT")).command!=="COMMIT"||transportFailed)throw Error("M03_LIFECYCLE_ACTIVATION_UNKNOWN");
    }catch(error){
      await db.query("ROLLBACK").catch(()=>undefined);
      await db.end();ended=true;
      authority.settleExperimentalProvisioning(e.operationId,"COMMITTED");admitted=false;
      throw error;
    }
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
export async function verifyExperimentalProvisionedCatalog(connectionString:string,manifestWire:string,authority:DisposableDurableRecoveryAuthority){
  assertLocalUrl(connectionString);
  const manifest=parseSchemaManifest(JSON.parse(manifestWire)),db=new Client({connectionString,connectionTimeoutMillis:4000,query_timeout:15000});
  try{
    await db.connect();await db.query("BEGIN READ ONLY");await db.query("SET LOCAL search_path=pg_catalog");
    const t=await loadTrust(db),physical=compileProvisioningContract(manifest,scopeOf(t));
    if((await db.query("SELECT 1 FROM public.platform_schema_registry r JOIN public.platform_schema_revisions_v1 v ON v.installation_id=r.installation_id AND v.revision_digest=r.manifest_digest WHERE r.installation_id=$1 AND r.manifest_digest=$2 AND v.manifest=$3 AND v.physical_digest=$4",[t.installation_id,manifest.digest,manifestWire,physical.digest])).rowCount!==1)return fail();
    // Only a revision that reached global ACTIVE admission is a valid head.
    if((await db.query("SELECT 1 FROM public.platform_schema_revision_states_v1 WHERE installation_id=$1 AND revision_digest=$2 AND state='ACTIVE'",[t.installation_id,manifest.digest])).rowCount!==1)return fail("LIFECYCLE");
    const state=authority.authenticatedSnapshot();
    if(state.pending||state.installationId!==t.installation_id||state.epoch!==t.epoch||state.ledgerId!==t.ledger_id||state.databaseName!==t.database_name)return fail();
    await verifyProvisioningHistory(db,t,state.provisioningOperations??[]);
    await verifyCatalog(db,t,physical);
    if(!equal(state,authority.authenticatedSnapshot()))return fail();
    await db.query("COMMIT");return physical.digest;
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
      e.profile!==provisioningProfileFor(manifest)||
      compileProvisioningContract(manifest,scopeOf(t)).digest!==row.physical_digest)return fail();
  }
  return rows;
}
export interface ProvisioningCommitEvidence{
  version:1;operationId:string;databaseName:string;databaseOid:string;systemIdentifier:string;timeline:number;installationId:string;epoch:string;revision:string;physicalDigest:string;historyDigest:string;dataDigests:Record<string,string>;
}
async function collectProvisioningEvidence(db:ClientBase,operations:readonly HistoryOperation[],operationId:string,mode:"COMMIT"|"CHECKPOINT"|"RESTORED"):Promise<ProvisioningCommitEvidence>{
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
    if(trustRows.length!==1||!t||!op||op.outcome!==(mode==="COMMIT"?"UNCERTAIN":"COMMITTED")||t.database_name!==id.name||t.database_oid!==id.oid||t.system_identifier!==before.system||(mode==="RESTORED"?before.timeline<=t.timeline:t.timeline!==before.timeline)||
      t.installation_id!==op.installationId||t.epoch!==op.epoch||t.application_id!==op.applicationId)return fail();
    await roleContract(db,t.installer_role,t.runtime_role,t.namespace);
    const rows=await verifyProvisioningHistory(db,t,operations,mode==="COMMIT"?operationId:undefined),last=rows.at(-1);
    if(last?.operation_id!==operationId)return fail();
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
    // Backfill checkpoints are part of the authenticated recovery inventory.
    const chunks=(await db.query<{value:string}>("SELECT to_jsonb(t)::text AS value FROM public.platform_schema_backfill_chunks_v1 t ORDER BY value LIMIT 1001")).rows;
    if(chunks.length>1000)return fail();
    dataDigests["@backfill-checkpoints"]=hash(JSON.stringify(chunks.map(v=>v.value)));
    await db.query("SELECT pg_stat_clear_snapshot()");
    if(!equal(before,await quiescent()))return fail();
    await db.query("COMMIT");
    return {version:1,operationId,databaseName:id.name,databaseOid:id.oid,systemIdentifier:before.system,timeline:before.timeline,installationId:t.installation_id,epoch:t.epoch,revision:manifest.digest,physicalDigest:physical.digest,historyDigest:hash(JSON.stringify(rows.map(r=>[r.revision_digest,r.operation_id,r.signature,r.parent_digest]))),dataDigests};
  }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}
}

export function collectExperimentalProvisioningCommit(db:ClientBase,operations:readonly HistoryOperation[],operationId:string){
  return collectProvisioningEvidence(db,operations,operationId,"COMMIT");
}
export function collectExperimentalProvisioningCheckpoint(db:ClientBase,operations:readonly HistoryOperation[],operationId:string,restored=false){
  if(operations.some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN"))return fail("UNSETTLED_PROVISIONING");
  return collectProvisioningEvidence(db,operations,operationId,restored?"RESTORED":"CHECKPOINT");
}
/** Persist only a historical reattestation. No READY, runtime grant, legacy
 * operator permission, or rewrite of the original signed revision. The
 * external authority remains PENDING on any split/unknown outcome.
 */
export async function persistExperimentalProvisioningReattestation(db:ClientBase,old:ProvisioningCommitEvidence,restored:ProvisioningCommitEvidence,newEpoch:string,intent:string,approvalId:string,authorityHead:string,evidenceWire:string,signature:string){
  const id=await identity(db);
  if(!id.superuser||id.name!==restored.databaseName||id.oid!==restored.databaseOid||!uuid.test(newEpoch)||newEpoch===old.epoch)return fail();
  await db.query("BEGIN");
  try{
    await db.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'");
    const fence=(await db.query<{allow:boolean;others:number;prepared:number;system:string;timeline:number}>("SELECT d.datallowconn AS allow,(SELECT count(*)::int FROM pg_stat_activity WHERE datid=d.oid AND pid<>pg_backend_pid()) AS others,(SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database()) AS prepared,(pg_control_system()).system_identifier::text AS system,(pg_control_checkpoint()).timeline_id AS timeline FROM pg_database d WHERE d.datname=current_database()")).rows[0];
    if(!fence||fence.allow||fence.others||fence.prepared||fence.system!==restored.systemIdentifier||fence.timeline!==restored.timeline)return fail("REATTESTATION_FENCE");
    const trust=(await db.query<Trust>("SELECT * FROM public.platform_schema_installation_trust_v1 WHERE installation_id=$1",[restored.installationId])).rows;
    if(trust.length!==1||!trust[0])return fail("REATTESTATION_TRUST");
    await roleContract(db,trust[0].installer_role,trust[0].runtime_role,trust[0].namespace);
    if((await db.query("UPDATE public.platform_schema_installation_trust_v1 SET epoch=$1,timeline=$2 WHERE installation_id=$3 AND epoch=$4 AND timeline=$5 AND database_oid=$6 AND system_identifier=$7 AND NOT revoked",[newEpoch,restored.timeline,restored.installationId,old.epoch,old.timeline,restored.databaseOid,restored.systemIdentifier])).rowCount!==1)return fail("REATTES_STALE_TRUST");
    await db.query("INSERT INTO public.platform_schema_recovery_reattestations_v1(installation_id,revision_digest,original_operation_id,original_epoch,new_epoch,recovery_intent,approval_id,authority_head,evidence,signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[restored.installationId,restored.revision,restored.operationId,old.epoch,newEpoch,intent,approvalId,authorityHead,evidenceWire,signature]);
    await roleContract(db,trust[0].installer_role,trust[0].runtime_role,trust[0].namespace);
    if((await db.query("COMMIT")).command!=="COMMIT")throw new ExperimentalProvisioningUnknown();
  }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}
}


export interface ExperimentalBackfillApproval{
 version:1;installationId:string;applicationId:string;databaseName:string;databaseOid:string;epoch:string;ledgerId:string;authorityHead:string;authoritySequence:number;
 revision:string;physicalDigest:string;operationId:string;tenantId:string;resourceId:string;column:string;value:string;limit:number;
}
export function experimentalBackfillMessage(e:ExperimentalBackfillApproval){
  return JSON.stringify(["VIBRESS-M03-BACKFILL-V1",e.version,e.installationId,e.applicationId,e.databaseName,e.databaseOid,e.epoch,e.ledgerId,e.authorityHead,e.authoritySequence,e.revision,e.physicalDigest,e.operationId,e.tenantId,e.resourceId,e.column,e.value,e.limit]);
}
function parseBackfill(wire:string):ExperimentalBackfillApproval{
  if(typeof wire!=="string"||wire.length>8192)return fail();
  const raw:unknown=JSON.parse(wire);
  if(!Array.isArray(raw)||raw.length!==18||raw[0]!=="VIBRESS-M03-BACKFILL-V1")return fail();
  const [_,version,installationId,applicationId,databaseName,databaseOid,epoch,ledgerId,authorityHead,authoritySequence,revision,physicalDigest,operationId,tenantId,resourceId,column,value,limit]=raw as unknown[];
  const is=(v:unknown,re:RegExp):v is string=>typeof v==="string"&&re.test(v);
  if(version!==1||!is(installationId,/^[a-z][a-z0-9_-]{1,62}$/)||!is(applicationId,/^[a-z][a-z0-9_-]{1,62}$/)||!is(databaseName,/^vibress_s03_norm_[a-z0-9_]+$/)||!is(databaseOid,/^\d{1,10}$/)||
    !is(epoch,uuid)||!is(ledgerId,uuid)||!is(authorityHead,sha)||typeof authoritySequence!=="number"||!Number.isSafeInteger(authoritySequence)||authoritySequence<1||
    !is(revision,sha)||!is(physicalDigest,sha)||!is(operationId,uuid)||!is(tenantId,/^[a-z][a-z0-9_-]{1,62}$/)||tenantId==="pub_default"||
    !is(resourceId,/^[a-z][a-z0-9_]{0,62}$/)||!is(column,/^[a-z][a-z0-9_]{0,62}$/)||typeof value!=="string"||value.length>4096||value.includes("\u0000")||
    typeof limit!=="number"||!Number.isInteger(limit)||limit<1||limit>100)return fail();
  const e={version,installationId,applicationId,databaseName,databaseOid,epoch,ledgerId,authorityHead,authoritySequence,revision,physicalDigest,operationId,tenantId,resourceId,column,value,limit} as const;
  if(experimentalBackfillMessage(e)!==wire)return fail();
  return e;
}
/** A bounded reviewed idempotent text fill, never a generic UPDATE or arbitrary
 * expression. This prototype provides atomic DB checkpoints, not independent
 * crash/PITR durability of backfill outcomes. A lost ACK fences the authority.
 */
export async function runExperimentalBackfillChunk(connectionString:string,approvalWire:string,signature:string,authority:DisposableDurableRecoveryAuthority,faultProxyPort?:number){
  assertLocalUrl(connectionString,faultProxyPort);
  const e=parseBackfill(approvalWire);
  if(typeof signature!=="string"||!/^[A-Za-z0-9_-]{86}$/.test(signature))return fail();
  const db=new Client({connectionString,connectionTimeoutMillis:4000,query_timeout:15000});
  let transportFailed=false,dispatched=false;db.on("error",()=>{transportFailed=true;});
  try{
    await db.connect();await db.query("BEGIN");
    await db.query("SET LOCAL search_path=pg_catalog; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'");
    await db.query("SELECT pg_advisory_xact_lock(118033,301)");
    const t=await loadTrust(db),state=authority.authenticatedSnapshot();
    const keyBytes=Buffer.from(t.approval_key,"base64"),key=createPublicKey({key:keyBytes,format:"der",type:"spki"});
    if(hash(keyBytes)!==t.approval_key_digest||key.asymmetricKeyType!=="ed25519"||!verify(null,Buffer.from(approvalWire),key,Buffer.from(signature,"base64url"))||
      state.pending||state.businessLease||state.epoch!==t.epoch||state.ledgerId!==t.ledger_id||state.installationId!==t.installation_id||state.databaseName!==t.database_name||
      e.applicationId!==t.application_id||e.installationId!==t.installation_id||e.databaseName!==t.database_name||e.databaseOid!==t.database_oid||
      e.epoch!==t.epoch||e.ledgerId!==state.ledgerId||e.authorityHead!==state.head||e.authoritySequence!==state.sequence)return fail();
    const history=await verifyProvisioningHistory(db,t,state.provisioningOperations??[]);
    const active=(await db.query<{manifest:string;manifest_digest:string}>("SELECT manifest,manifest_digest FROM public.platform_schema_registry WHERE installation_id=$1",[t.installation_id])).rows[0];
    if(!active||active.manifest_digest!==e.revision||history.at(-1)?.revision_digest!==e.revision)return fail();
    const manifest=parseSchemaManifest(JSON.parse(active.manifest)),physical=compileProvisioningContract(manifest,scopeOf(t));
    if(physical.digest!==e.physicalDigest||manifest.digest!==e.revision)return fail();
    const resource=physical.resources.find(x=>x.id===e.resourceId),column=resource?.columns.find(x=>x.name===e.column);
    const declared=manifest.resources.find(x=>x.id===e.resourceId),backfillField=declared?.fields.find(x=>x.id===e.column);
    if(!resource||resource.ownership!=="tenant"||!declared||!column||!backfillField||column.required||column.enumValues||column.target)return fail();
    // Text stays a literal fill with the declared length bound. The bounded
    // JSON families are admitted only through the shared JSON guard; money has
    // no pair representation in the V1 message and is refused.
    let valueExpression="$3";
    if(column.type==="text"){
      if(backfillField.logicalType!=="text"||(backfillField.maxLength!==undefined&&e.value.length>backfillField.maxLength))return fail();
    }else if(column.type==="jsonb"){
      // Media values carry a publication-scoped asset identity that the
      // backfill message cannot prove; they are refused rather than trusted.
      if(backfillField.logicalType==="media")return backfillRefusal("MEDIA_OWNERSHIP");
      if(backfillField.logicalType!=="json"&&backfillField.logicalType!=="localized"&&backfillField.logicalType!=="studio")return fail();
      let parsed:unknown;
      try{parsed=JSON.parse(e.value);}catch{return backfillRefusal("VALUE");}
      enforceBoundedJson(backfillField,parsed);
      const record=parsed!==null&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed as Record<string,unknown>:undefined;
      if(backfillField.logicalType==="localized"){
        if(!record)return backfillRefusal("VALUE");
        const entries=Object.entries(record);
        if(entries.length===0)return backfillRefusal("VALUE");
        for(const [locale,text] of entries)if(!/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/.test(locale)||typeof text!=="string"||text.includes("\u0000"))return backfillRefusal("VALUE");
      }
      if(backfillField.logicalType==="studio"){
        if(!record)return backfillRefusal("VALUE");
        try{
          checkDocumentResourceLimits(record,{maxSizeBytes:backfillField.maxBytes as number,maxDepth:backfillField.maxDepth as number});
          const document=validateStudioDocument(normalizeStudioDocument(record));
          assertStudioDocumentEditable(document,document);
          if(document.version!==CURRENT_STUDIO_VERSION)return backfillRefusal("VALUE");
        }catch{return backfillRefusal("VALUE");}
      }
      valueExpression="$3::jsonb";
    }else return fail();
    await verifyCatalog(db,t,physical);
    const prior=(await db.query<{evidence:string;signature:string;affected:number;ids:string[]}>("SELECT evidence,signature,affected,ids FROM public.platform_schema_backfill_chunks_v1 WHERE operation_id=$1",[e.operationId])).rows[0];
    if(prior){
      if(prior.evidence!==approvalWire||prior.signature!==signature)return fail();
      const complete=(await db.query<{complete:boolean}>("SELECT complete FROM public.platform_schema_backfill_targets_v1 WHERE installation_id=$1 AND revision_digest=$2 AND tenant_id=$3 AND resource_id=$4 AND column_name=$5",[t.installation_id,e.revision,e.tenantId,e.resourceId,e.column])).rows[0]?.complete??false;
      await db.query("ROLLBACK");return {status:"ALREADY_COMMITTED" as const,affected:prior.affected,ids:prior.ids,complete};
    }
    // One target admits exactly one value; progress only moves forward and a
    // completed target can never be reopened or cleared.
    await db.query("INSERT INTO public.platform_schema_backfill_targets_v1(installation_id,revision_digest,tenant_id,resource_id,column_name,value,admitted_evidence,admitted_signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",[t.installation_id,e.revision,e.tenantId,e.resourceId,e.column,e.value,approvalWire,signature]);
    const target=(await db.query<{value:string;complete:boolean}>("SELECT value,complete FROM public.platform_schema_backfill_targets_v1 WHERE installation_id=$1 AND revision_digest=$2 AND tenant_id=$3 AND resource_id=$4 AND column_name=$5 FOR UPDATE",[t.installation_id,e.revision,e.tenantId,e.resourceId,e.column])).rows[0];
    if(!target)return backfillRefusal("CONFLICT");
    if(target.complete)return backfillRefusal("COMPLETE");
    if(target.value!==e.value)return backfillRefusal("CONFLICT");
    await db.query("SELECT set_config('vibress.application_id',$1,true),set_config('vibress.tenant_id',$2,true)",[e.applicationId,e.tenantId]);
    const q=qualified(t.namespace,resource.table),field=qi(column.name);
    const updated=(await db.query<{id:string}>("WITH selected AS (SELECT id FROM "+q+" WHERE tenant_id=$1 AND "+field+" IS NULL ORDER BY id LIMIT $2 FOR UPDATE) UPDATE "+q+" d SET "+field+"="+valueExpression+" FROM selected s WHERE d.tenant_id=$1 AND d.id=s.id AND d."+field+" IS NULL RETURNING d.id::text AS id",[e.tenantId,e.limit,e.value])).rows;
    const ids=updated.map(x=>x.id).sort();
    await db.query("INSERT INTO public.platform_schema_backfill_chunks_v1(installation_id,revision_digest,operation_id,tenant_id,resource_id,column_name,evidence,signature,affected,ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[t.installation_id,e.revision,e.operationId,e.tenantId,e.resourceId,e.column,approvalWire,signature,ids.length,ids]);
    await db.query("UPDATE public.platform_schema_backfill_targets_v1 SET chunks=chunks+1,affected_total=affected_total+$6,complete=$7,completed_at=CASE WHEN $7 THEN clock_timestamp() ELSE completed_at END,updated_at=clock_timestamp() WHERE installation_id=$1 AND revision_digest=$2 AND tenant_id=$3 AND resource_id=$4 AND column_name=$5",[t.installation_id,e.revision,e.tenantId,e.resourceId,e.column,ids.length,ids.length===0]);
    await roleContract(db,t.installer_role,t.runtime_role,t.namespace);
    if(!equal(state,authority.authenticatedSnapshot())||transportFailed)return fail();
    dispatched=true;if((await db.query("COMMIT")).command!=="COMMIT"||transportFailed)throw new ExperimentalProvisioningUnknown();
    return {status:"COMMITTED" as const,affected:ids.length,ids,complete:ids.length===0};
  }catch(error){
    if(dispatched){if(!authority.authenticatedSnapshot().pending)authority.beginRecovery();throw new ExperimentalProvisioningUnknown();}
    await db.query("ROLLBACK").catch(()=>undefined);throw error;
  }finally{await db.end().catch(()=>undefined);}
}

export interface ExperimentalRenameApproval{
 version:1;installationId:string;applicationId:string;databaseName:string;databaseOid:string;epoch:string;ledgerId:string;authorityHead:string;authoritySequence:number;
 revision:string;targetRevision:string;planDigest:string;operationId:string;resourceId:string;from:string;to:string;
 phase:"EXPAND"|"BACKFILL"|"VALIDATE";tenantId:string;limit:number;rationale:string;
}
export function experimentalRenameMessage(e:ExperimentalRenameApproval){
 return JSON.stringify(["VIBRESS-M03-RENAME-V1",e.version,e.installationId,e.applicationId,e.databaseName,e.databaseOid,e.epoch,e.ledgerId,e.authorityHead,e.authoritySequence,e.revision,e.targetRevision,e.planDigest,e.operationId,e.resourceId,e.from,e.to,e.phase,e.tenantId,e.limit,e.rationale]);
}
const renameRefusal=(reason:string):never=>{throw Error("M03_RENAME_REFUSED:"+reason);};
const tenantIdPattern=/^[a-z][a-z0-9_-]{1,62}$/;
function parseRename(wire:string):ExperimentalRenameApproval{
 if(typeof wire!=="string"||wire.length>16384)return fail();
 const raw:unknown=JSON.parse(wire);
 if(!Array.isArray(raw)||raw.length!==21||raw[0]!=="VIBRESS-M03-RENAME-V1")return fail();
 const [_,version,installationId,applicationId,databaseName,databaseOid,epoch,ledgerId,authorityHead,authoritySequence,revision,targetRevision,planDigest,operationId,resourceId,from,to,phase,tenantId,limit,rationale]=raw as unknown[];
 const is=(v:unknown,re:RegExp):v is string=>typeof v==="string"&&re.test(v);
 if(version!==1||!is(installationId,/^[a-z][a-z0-9_-]{1,62}$/)||!is(applicationId,/^[a-z][a-z0-9_-]{1,62}$/)||!is(databaseName,/^vibress_s03_norm_[a-z0-9_]+$/)||!is(databaseOid,/^\d{1,10}$/)||
   !is(epoch,uuid)||!is(ledgerId,uuid)||!is(authorityHead,sha)||typeof authoritySequence!=="number"||!Number.isSafeInteger(authoritySequence)||authoritySequence<1||
   !is(revision,sha)||!is(targetRevision,sha)||!is(planDigest,sha)||!is(operationId,uuid)||!is(resourceId,/^[a-z][a-z0-9_]{0,62}$/)||
   !is(from,/^[a-z][a-z0-9_]{0,62}$/)||!is(to,/^[a-z][a-z0-9_]{0,62}$/)||from===to||
   (phase!=="EXPAND"&&phase!=="BACKFILL"&&phase!=="VALIDATE")||typeof tenantId!=="string"||typeof limit!=="number"||!Number.isInteger(limit)||
   typeof rationale!=="string"||rationale.trim().length<8||rationale.length>512||rationale.includes("\u0000"))return fail();
 if(phase==="EXPAND"?(tenantId!==""||limit!==0):!is(tenantId,tenantIdPattern)||tenantId==="pub_default")return fail();
 if(phase==="BACKFILL"?(limit<1||limit>100):limit!==0)return fail();
 const e={version,installationId,applicationId,databaseName,databaseOid,epoch,ledgerId,authorityHead,authoritySequence,revision,targetRevision,planDigest,operationId,resourceId,from,to,phase,tenantId,limit,rationale} as const;
 if(experimentalRenameMessage(e as ExperimentalRenameApproval)!==wire)return fail();
 return e;
}
/** Reviewed non-destructive rename phases. EXPAND applies the compiler's
 * exact reviewed ADD COLUMN, BACKFILL copies source to destination for one
 * tenant in bounded chunks, VALIDATE runs the compiler predicate. The source
 * column is never dropped and no destructive contract phase is reachable. */
export async function runExperimentalRename(connectionString:string,approvalWire:string,signature:string,authority:DisposableDurableRecoveryAuthority,proposedWire:string){
 assertLocalUrl(connectionString);
 const e=parseRename(approvalWire);
 if(typeof signature!=="string"||!/^[A-Za-z0-9_-]{86}$/.test(signature)||typeof proposedWire!=="string"||proposedWire.length>1024*1024)return fail();
 const db=new Client({connectionString,connectionTimeoutMillis:4000,query_timeout:15000});
 let transportFailed=false,dispatched=false;db.on("error",()=>{transportFailed=true;});
 try{
  await db.connect();await db.query("BEGIN");
  await db.query("SET LOCAL search_path=pg_catalog; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'");
  await db.query("SELECT pg_advisory_xact_lock(118033,301)");
  const t=await loadTrust(db),state=authority.authenticatedSnapshot();
  const keyBytes=Buffer.from(t.approval_key,"base64"),key=createPublicKey({key:keyBytes,format:"der",type:"spki"});
  if(hash(keyBytes)!==t.approval_key_digest||key.asymmetricKeyType!=="ed25519"||!verify(null,Buffer.from(approvalWire),key,Buffer.from(signature,"base64url"))||
    state.pending||state.businessLease||state.epoch!==t.epoch||state.ledgerId!==t.ledger_id||state.installationId!==t.installation_id||state.databaseName!==t.database_name||
    e.applicationId!==t.application_id||e.installationId!==t.installation_id||e.databaseName!==t.database_name||e.databaseOid!==t.database_oid||
    e.epoch!==t.epoch||e.ledgerId!==state.ledgerId||e.authorityHead!==state.head||e.authoritySequence!==state.sequence)return fail();
  const history=await verifyProvisioningHistory(db,t,state.provisioningOperations??[]);
  const active=(await db.query<{manifest:string;manifest_digest:string}>("SELECT manifest,manifest_digest FROM public.platform_schema_registry WHERE installation_id=$1",[t.installation_id])).rows[0];
  if(!active||active.manifest_digest!==e.revision||history.at(-1)?.revision_digest!==e.revision)return fail();
  const current=parseSchemaManifest(JSON.parse(active.manifest)),scope=scopeOf(t),physical=compileProvisioningContract(current,scope);
  let target;
  try{target=parseSchemaManifest(JSON.parse(proposedWire));}catch{return renameRefusal("PLAN");}
  if(JSON.stringify(target)!==proposedWire||target.digest!==e.targetRevision)return renameRefusal("PLAN");
  let plan;
  try{plan=compileRenameIntent(current,target,{version:1,resourceId:e.resourceId,from:e.from,to:e.to,rationale:e.rationale},scope);}catch{return renameRefusal("PLAN");}
  if(plan.digest!==e.planDigest||plan.resource.id!==e.resourceId||plan.from.column!==e.from||plan.to.column!==e.to||
    plan.from.type!==plan.to.type||plan.destructive||plan.authorization!=="NONE")return renameRefusal("PLAN");
  const resource=physical.resources.find(r=>r.id===e.resourceId);
  if(!resource||resource.table!==plan.resource.table)return renameRefusal("SHAPE");
  const q=qualified(t.namespace,resource.table);
  const columns=async()=>(await db.query<{name:string;type:string;notnull:boolean;default:string|null;identity:string}>(`SELECT a.attname::text AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS notnull,pg_get_expr(d.adbin,d.adrelid) AS default,a.attidentity::text AS identity FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[q])).rows;
  if(e.phase==="EXPAND"){
    const prior=(await db.query<{evidence:string;signature:string}>("SELECT evidence,signature FROM public.platform_schema_rename_phases_v1 WHERE operation_id=$1",[e.operationId])).rows[0];
    if(prior){
      if(prior.evidence!==approvalWire||prior.signature!==signature)return fail();
      const observed=await columns(),added=observed.find(c=>c.name===e.to);
      if(observed.length!==resource.columns.length+1||!added||added.type!==plan.to.type||added.notnull||added.default!==null||added.identity!=="")return renameRefusal("SHAPE");
      await db.query("ROLLBACK");return {status:"ALREADY_APPLIED" as const,phase:"EXPAND" as const,column:e.to};
    }
    if((await db.query("SELECT 1 FROM public.platform_schema_rename_phases_v1 WHERE installation_id=$1 AND revision_digest=$2 AND target_revision_digest=$3 AND resource_id=$4 AND source_column=$5 AND target_column=$6",[t.installation_id,e.revision,e.targetRevision,e.resourceId,e.from,e.to])).rowCount!==0)return renameRefusal("EXISTS");
    await verifyCatalog(db,t,physical);
    const observed=await columns();
    if(observed.some(c=>c.name===e.to))return renameRefusal("EXISTS");
    const source=observed.find(c=>c.name===e.from);
    if(!source||source.type!==plan.from.type||observed.length!==resource.columns.length)return renameRefusal("SHAPE");
    const statements=plan.phases.expand.statements;
    if(statements.length!==1||!/^ALTER TABLE [a-z0-9_."]+ ADD COLUMN [a-z0-9_"]+ [a-z0-9_ ()]+$/.test(statements[0]!)||/DROP|ALTER COLUMN|SET NOT NULL/i.test(statements[0]!))return renameRefusal("PLAN");
    for(const statement of statements)await db.query(statement);
    const after=await columns(),added=after.find(c=>c.name===e.to);
    if(after.length!==observed.length+1||!added||added.type!==plan.to.type||added.notnull||added.default!==null||added.identity!==""||
      !equal(after.slice(0,observed.length),observed))return renameRefusal("SHAPE");
    await db.query("INSERT INTO public.platform_schema_rename_phases_v1(installation_id,revision_digest,target_revision_digest,resource_id,source_column,target_column,plan_digest,operation_id,evidence,signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[t.installation_id,e.revision,e.targetRevision,e.resourceId,e.from,e.to,e.planDigest,e.operationId,approvalWire,signature]);
    await roleContract(db,t.installer_role,t.runtime_role,t.namespace);
    if(!equal(state,authority.authenticatedSnapshot())||transportFailed)return fail();
    dispatched=true;if((await db.query("COMMIT")).command!=="COMMIT"||transportFailed)throw new ExperimentalProvisioningUnknown();
    return {status:"APPLIED" as const,phase:"EXPAND" as const,column:e.to};
  }
  const phase=(await db.query<{plan_digest:string}>("SELECT plan_digest FROM public.platform_schema_rename_phases_v1 WHERE installation_id=$1 AND revision_digest=$2 AND target_revision_digest=$3 AND resource_id=$4 AND source_column=$5 AND target_column=$6",[t.installation_id,e.revision,e.targetRevision,e.resourceId,e.from,e.to])).rows[0];
  if(!phase||phase.plan_digest!==e.planDigest)return renameRefusal("NOT_EXPANDED");
  const observed=await columns(),source=observed.find(c=>c.name===e.from),added=observed.find(c=>c.name===e.to);
  if(!source||source.type!==plan.from.type||observed.length!==resource.columns.length+1||!added||added.type!==plan.to.type||added.notnull||added.default!==null||added.identity!==""||
    !equal(observed.slice(0,resource.columns.length),resource.columns.map(c=>({name:c.name,type:c.type,notnull:c.required,default:null,identity:""}))))return renameRefusal("SHAPE");
  if(e.phase==="BACKFILL"){
    const prior=(await db.query<{evidence:string;signature:string;affected:number;ids:string[]}>("SELECT evidence,signature,affected,ids FROM public.platform_schema_rename_chunks_v1 WHERE operation_id=$1",[e.operationId])).rows[0];
    if(prior){
      if(prior.evidence!==approvalWire||prior.signature!==signature)return fail();
      const complete=(await db.query<{complete:boolean}>("SELECT complete FROM public.platform_schema_rename_progress_v1 WHERE installation_id=$1 AND revision_digest=$2 AND target_revision_digest=$3 AND tenant_id=$4 AND resource_id=$5 AND source_column=$6 AND target_column=$7",[t.installation_id,e.revision,e.targetRevision,e.tenantId,e.resourceId,e.from,e.to])).rows[0]?.complete??false;
      await db.query("ROLLBACK");return {status:"ALREADY_COMMITTED" as const,affected:prior.affected,ids:prior.ids,complete};
    }
    await db.query("INSERT INTO public.platform_schema_rename_progress_v1(installation_id,revision_digest,target_revision_digest,tenant_id,resource_id,source_column,target_column) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",[t.installation_id,e.revision,e.targetRevision,e.tenantId,e.resourceId,e.from,e.to]);
    const progress=(await db.query<{complete:boolean}>("SELECT complete FROM public.platform_schema_rename_progress_v1 WHERE installation_id=$1 AND revision_digest=$2 AND target_revision_digest=$3 AND tenant_id=$4 AND resource_id=$5 AND source_column=$6 AND target_column=$7 FOR UPDATE",[t.installation_id,e.revision,e.targetRevision,e.tenantId,e.resourceId,e.from,e.to])).rows[0];
    if(!progress)return renameRefusal("PROGRESS");
    if(progress.complete)return renameRefusal("COMPLETE");
    await db.query("SELECT set_config('vibress.application_id',$1,true),set_config('vibress.tenant_id',$2,true)",[e.applicationId,e.tenantId]);
    const from=qi(e.from),to=qi(e.to);
    const updated=(await db.query<{id:string}>("WITH selected AS (SELECT id FROM "+q+" WHERE tenant_id=$1 AND "+to+" IS NULL ORDER BY id LIMIT $2 FOR UPDATE) UPDATE "+q+" d SET "+to+"=d."+from+" FROM selected s WHERE d.tenant_id=$1 AND d.id=s.id AND d."+to+" IS NULL RETURNING d.id::text AS id",[e.tenantId,e.limit])).rows;
    const ids=updated.map(x=>x.id).sort();
    await db.query("INSERT INTO public.platform_schema_rename_chunks_v1(installation_id,revision_digest,target_revision_digest,operation_id,tenant_id,resource_id,source_column,target_column,evidence,signature,affected,ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[t.installation_id,e.revision,e.targetRevision,e.operationId,e.tenantId,e.resourceId,e.from,e.to,approvalWire,signature,ids.length,ids]);
    await db.query("UPDATE public.platform_schema_rename_progress_v1 SET chunks=chunks+1,affected_total=affected_total+$8,complete=$9,completed_at=CASE WHEN $9 THEN clock_timestamp() ELSE completed_at END,updated_at=clock_timestamp() WHERE installation_id=$1 AND revision_digest=$2 AND target_revision_digest=$3 AND tenant_id=$4 AND resource_id=$5 AND source_column=$6 AND target_column=$7",[t.installation_id,e.revision,e.targetRevision,e.tenantId,e.resourceId,e.from,e.to,ids.length,ids.length===0]);
    await roleContract(db,t.installer_role,t.runtime_role,t.namespace);
    if(!equal(state,authority.authenticatedSnapshot())||transportFailed)return fail();
    dispatched=true;if((await db.query("COMMIT")).command!=="COMMIT"||transportFailed)throw new ExperimentalProvisioningUnknown();
    return {status:"COMMITTED" as const,affected:ids.length,ids,complete:ids.length===0};
  }
  const predicate=plan.phases.validate.predicates[0];
  if(plan.phases.validate.predicates.length!==1||!predicate||!/^count\(\*\) FILTER \(WHERE "[a-z0-9_]+" IS NULL\) = 0$/.test(predicate)||!predicate.includes(qi(e.to)))return renameRefusal("PLAN");
  await db.query("SELECT set_config('vibress.application_id',$1,true),set_config('vibress.tenant_id',$2,true)",[e.applicationId,e.tenantId]);
  const validated=(await db.query<{ok:boolean;rows:number;missing:number;divergent:number}>("SELECT ("+predicate+") AS ok,count(*)::int AS rows,count(*) FILTER (WHERE "+qi(e.to)+" IS NULL)::int AS missing,count(*) FILTER (WHERE "+qi(e.to)+" IS NOT NULL AND "+qi(e.to)+" IS DISTINCT FROM "+qi(e.from)+")::int AS divergent FROM "+q+" WHERE tenant_id=$1",[e.tenantId])).rows[0]!;
  if((validated.missing===0)!==validated.ok)return renameRefusal("SHAPE");
  await roleContract(db,t.installer_role,t.runtime_role,t.namespace);
  if(!equal(state,authority.authenticatedSnapshot())||transportFailed)return fail();
  if((await db.query("COMMIT")).command!=="COMMIT"||transportFailed)throw new ExperimentalProvisioningUnknown();
  return {status:validated.ok&&validated.divergent===0?"VALIDATED" as const:"INCOMPLETE" as const,rows:validated.rows,missing:validated.missing,divergent:validated.divergent};
 }catch(error){
  if(dispatched){if(!authority.authenticatedSnapshot().pending)authority.beginRecovery();throw new ExperimentalProvisioningUnknown();}
  await db.query("ROLLBACK").catch(()=>undefined);throw error;
 }finally{await db.end().catch(()=>undefined);}
}
