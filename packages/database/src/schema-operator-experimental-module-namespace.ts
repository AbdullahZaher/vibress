// Experimental operator-only component. Not exported by the serving database API.
// A module namespace is derived only from verified installation identities; the
// caller never supplies a schema name. Reservation, schema creation and grants
// commit atomically, and the reservation row is immutable.
import {createHash} from "node:crypto";
import type {ClientBase} from "pg";
import {asApplicationId,asInstallationId} from "@vibress/platform-kernel";
import {provisioningIdentifier as qi,provisioningNamespace,type SchemaCompilationScope} from "@vibress/schema-engine";

export const MODULE_NAMESPACE_PROFILE="M03_MODULE_NAMESPACE_V1" as const;
const fail=(reason="INVARIANT"):never=>{throw Error("M03_MODULE_NAMESPACE_REFUSED:"+reason);};
const hash=(data:string)=>createHash("sha256").update(data).digest("hex");
const sorted=(a:readonly string[])=>[...a].sort();
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const moduleIdPattern=/^[a-z][a-z0-9_]{1,62}$/;
const reservedPrefix=/^(pg_|v3_|platform_|vibress_)/;
const reservedExact=new Set(["public","information_schema","platform","vibress","system","admin","core"]);
export interface ModuleNamespaceScope{readonly applicationId:string;readonly installationId:string;readonly moduleId:string}
export interface ModuleNamespaceReservation{readonly status:"RESERVED"|"ALREADY_RESERVED";readonly profile:typeof MODULE_NAMESPACE_PROFILE;readonly moduleId:string;readonly namespace:string}
interface Trust{installation_id:string;application_id:string;namespace:string;installer_role:string;runtime_role:string;database_name:string;database_oid:string;revoked:boolean}
interface ReservationRow{installation_id:string;application_id:string;module_id:string;namespace:string;installer_role:string;runtime_role:string;binding_digest:string}
/** Deterministic schema name for one verified module. Reserved database names,
 * PostgreSQL system prefixes and platform/core prefixes are never accepted. */
export function moduleNamespaceName(scope:ModuleNamespaceScope):string{
  if(!moduleIdPattern.test(scope.moduleId)||reservedExact.has(scope.moduleId)||reservedPrefix.test(scope.moduleId))return fail("MODULE_ID");
  return "v3_mod_"+hash(["VIBRESS-M03-MODULE-NAMESPACE-V1",scope.applicationId,scope.installationId,scope.moduleId].join("\u0000")).slice(0,24);
}
function bindingDigest(scope:ModuleNamespaceScope,namespace:string,installer:string,runtime:string){
  return hash(["VIBRESS-M03-MODULE-BINDING-V1",MODULE_NAMESPACE_PROFILE,scope.applicationId,scope.installationId,scope.moduleId,namespace,installer,runtime].join("\u0000"));
}
async function identity(db:ClientBase){
  const rows=(await db.query<{name:string;oid:string;role:string;session:string;version:number;superuser:boolean}>("SELECT current_database() AS name,d.oid::text AS oid,current_user AS role,session_user AS session,current_setting('server_version_num')::int AS version,r.rolsuper AS superuser FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_roles r WHERE d.datname=current_database() AND r.rolname=current_user")).rows;
  const row=rows[0];
  if(process.env.NODE_ENV!=="test"||rows.length!==1||!row||!/^vibress_s03_norm_[a-z0-9_]+$/.test(row.name)||row.version<160000||row.version>=170000||row.role!==row.session||!row.superuser)return fail("IDENTITY");
  return row;
}
async function loadTrust(db:ClientBase,scope:SchemaCompilationScope,id:{name:string;oid:string}){
  const rows=(await db.query<Trust>("SELECT installation_id,application_id,namespace,installer_role,runtime_role,database_name,database_oid,revoked FROM public.platform_schema_installation_trust_v1")).rows;
  const t=rows[0];
  // The trust row is the only authority for installer/runtime identities; the
  // module binding must agree with the already-reserved core namespace.
  if(rows.length!==1||!t||t.revoked||t.installation_id!==scope.installationId||t.application_id!==scope.applicationId||
    t.database_name!==id.name||t.database_oid!==id.oid||t.installer_role===t.runtime_role||
    t.namespace!==provisioningNamespace({applicationId:asApplicationId(scope.applicationId),installationId:asInstallationId(scope.installationId)}))return fail("TRUST");
  return t;
}
async function verifyModuleCatalog(db:ClientBase,namespace:string,installer:string,runtime:string){
  qi(namespace);qi(installer);qi(runtime);
  const ns=(await db.query<{owner:string;acl:string[];objects:number;defaults:number;unsafe:number}>(
    `SELECT pg_get_userbyid(nspowner) AS owner,
      ARRAY(SELECT (CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)||':'||pg_get_userbyid(a.grantor)||':'||a.privilege_type||':'||a.is_grantable::text FROM aclexplode(coalesce(nspacl,acldefault('n',nspowner))) a ORDER BY 1) AS acl,
      (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace=n.oid)+(SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace=n.oid)+(SELECT count(*)::int FROM pg_type t WHERE t.typnamespace=n.oid) AS objects,
      (SELECT count(*)::int FROM pg_default_acl d WHERE d.defaclnamespace=n.oid) AS defaults,
      (SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace=n.oid AND p.prosecdef) AS unsafe
      FROM pg_namespace n WHERE n.nspname=$1`,[namespace])).rows[0];
  const acl=sorted([installer+":"+installer+":CREATE:false",installer+":"+installer+":USAGE:false",runtime+":"+installer+":USAGE:false"]);
  if(!ns||ns.owner!==installer||!equal(sorted(ns.acl),acl)||ns.objects!==0||ns.defaults!==0||ns.unsafe!==0)return fail("CATALOG");
}
async function verifyReservation(db:ClientBase,input:{scope:SchemaCompilationScope;moduleId:string},namespace:string,t:Trust){
  const scope={applicationId:input.scope.applicationId,installationId:input.scope.installationId,moduleId:input.moduleId};
  const rows=(await db.query<ReservationRow>("SELECT installation_id,application_id,module_id,namespace,installer_role,runtime_role,binding_digest FROM public.platform_module_namespaces_v1 WHERE installation_id=$1 AND module_id=$2",[input.scope.installationId,input.moduleId])).rows;
  const row=rows[0];
  if(rows.length!==1||!row||row.installation_id!==scope.installationId||row.application_id!==scope.applicationId||row.module_id!==scope.moduleId||
    row.namespace!==namespace||row.installer_role!==t.installer_role||row.runtime_role!==t.runtime_role||
    row.binding_digest!==bindingDigest(scope,namespace,t.installer_role,t.runtime_role))return fail("MISMATCH");
  await verifyModuleCatalog(db,namespace,t.installer_role,t.runtime_role);
  return row;
}
export async function reserveExperimentalModuleNamespace(db:ClientBase,input:{scope:SchemaCompilationScope;moduleId:string}):Promise<ModuleNamespaceReservation>{
  const id=await identity(db),scope=input.scope;
  const namespace=moduleNamespaceName({applicationId:scope.applicationId,installationId:scope.installationId,moduleId:input.moduleId});
  await loadTrust(db,scope,id);
  await db.query("BEGIN");
  try{
    await db.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'");
    await db.query("SELECT pg_advisory_xact_lock(118033,302)");
    const t=await loadTrust(db,scope,id);
    if(namespace===t.namespace)return fail("COLLISION");
    const existing=(await db.query<ReservationRow>("SELECT installation_id,application_id,module_id,namespace,installer_role,runtime_role,binding_digest FROM public.platform_module_namespaces_v1 WHERE installation_id=$1 AND module_id=$2",[scope.installationId,input.moduleId])).rows[0];
    if(existing){
      await verifyReservation(db,input,namespace,t);
      await db.query("COMMIT");
      return {status:"ALREADY_RESERVED",profile:MODULE_NAMESPACE_PROFILE,moduleId:input.moduleId,namespace};
    }
    if((await db.query("SELECT 1 FROM public.platform_module_namespaces_v1 WHERE namespace=$1",[namespace])).rowCount!==0)return fail("COLLISION");
    try{
      await db.query("INSERT INTO public.platform_module_namespaces_v1(installation_id,application_id,module_id,namespace,installer_role,runtime_role,binding_digest) VALUES($1,$2,$3,$4,$5,$6,$7)",[scope.installationId,scope.applicationId,input.moduleId,namespace,t.installer_role,t.runtime_role,bindingDigest({applicationId:scope.applicationId,installationId:scope.installationId,moduleId:input.moduleId},namespace,t.installer_role,t.runtime_role)]);
    }catch(error){
      if((error as {code?:string}).code==="23505")return fail("COLLISION");
      throw error;
    }
    await db.query("CREATE SCHEMA "+qi(namespace)+" AUTHORIZATION "+qi(t.installer_role));
    await db.query("GRANT USAGE ON SCHEMA "+qi(namespace)+" TO "+qi(t.runtime_role));
    await verifyModuleCatalog(db,namespace,t.installer_role,t.runtime_role);
    await db.query("COMMIT");
    return {status:"RESERVED",profile:MODULE_NAMESPACE_PROFILE,moduleId:input.moduleId,namespace};
  }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}
}
/** Read-only continuity check: the persisted reservation must still match the
 * deterministic identity and the live schema catalog after a restart/restore. */
export async function verifyExperimentalModuleNamespace(db:ClientBase,input:{scope:SchemaCompilationScope;moduleId:string}){
  const id=await identity(db),namespace=moduleNamespaceName({applicationId:input.scope.applicationId,installationId:input.scope.installationId,moduleId:input.moduleId});
  const t=await loadTrust(db,input.scope,id);
  await verifyReservation(db,input,namespace,t);
  return namespace;
}
