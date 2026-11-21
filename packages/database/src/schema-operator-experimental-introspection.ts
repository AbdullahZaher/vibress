// Internal, disposable CORE-profile metadata projection. Not exported by
// the serving API. The caller supplies an authenticated principal and trusted
// membership resolver and policy configuration, never request-supplied grants.
import {compileProvisioningContract,parseSchemaManifest,PROVISIONING_PROFILE} from "@vibress/schema-engine";
import {resolveVerifiedScope,hasPermission, type ScopeResolver,type PolicyEngine,type TenantUnitOfWork} from "@vibress/tenancy";
import type {ApplicationId,InstallationId,TenantId,VerifiedPrincipal} from "@vibress/platform-kernel";
import type {DisposableDurableRecoveryAuthority} from "./schema-operator-experimental-durable-authority";
import {verifyRuntimeProtectedMetadataAuthority} from "./schema-operator-experimental-protected-acl";
type Visibility=Readonly<Record<string,{readonly permission:string;readonly fields:Readonly<Record<string,string>>}>>;
const refuse=():never=>{throw Error("M03_INTROSPECTION_REFUSED");};
export async function projectExperimentalResources(input:{authority:DisposableDurableRecoveryAuthority;runner:TenantUnitOfWork;resolver:ScopeResolver;policy:PolicyEngine;policyVersion:string;visibility:Visibility;applicationId:ApplicationId;installationId:InstallationId;tenantId:TenantId;principal:VerifiedPrincipal;manifestWire:string}){
  const {authority,runner,resolver,policy,principal,applicationId,installationId,tenantId,policyVersion,visibility}=input;
  if(process.env.NODE_ENV!=="test"||input.manifestWire.length>1024*1024)return refuse();
  const initial=authority.authenticatedSnapshot(),last=initial.provisioningOperations?.filter(o=>o.outcome==="COMMITTED").at(-1);
  if(initial.pending||initial.businessLease||initial.readyProtocol===2||!last||initial.installationId!==installationId||last.applicationId!==applicationId||last.epoch!==initial.epoch||initial.provisioningOperations?.some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN"))return refuse();
  const m=parseSchemaManifest(JSON.parse(input.manifestWire)),physical=compileProvisioningContract(m,{applicationId,installationId});
  if(JSON.stringify(m)!==input.manifestWire||last.manifestDigest!==m.digest||last.physicalDigest!==physical.digest)return refuse();
  const scope=await resolveVerifiedScope(resolver,{applicationId,tenantId,principal,policyVersion});
  const allowed=(permission:string|undefined)=>typeof permission==="string"&&hasPermission(scope.authorization.permissions,permission)&&policy.decide({principal:scope.principal,action:permission,scopeTenantId:tenantId,resourceTenantId:tenantId}).effect==="allow";
  const visible=m.resources.filter(r=>Object.hasOwn(visibility,r.id)&&allowed(visibility[r.id]?.permission));
  const resources=visible.map(r=>({
    id:r.id,ownership:r.ownership,fields:r.fields.filter(f=>Object.hasOwn(visibility[r.id]!.fields,f.id)&&allowed(visibility[r.id]!.fields[f.id])&&(!f.targetResource||visible.some(target=>target.id===f.targetResource))).map(f=>({id:f.id,type:f.logicalType,required:f.required,...(f.targetResource?{targetResource:f.targetResource}:{})}))
  }));
  const result=await runner.run(scope,async tx=>{
    const rows=(await tx.query<{application_id:string;installation_id:string;epoch:string;ledger_id:string;manifest_digest:string;profile:string;revoked:boolean;runtime_role:string;role:string;session:string;db:string;oid:string;configured_system:string;system:string;configured_timeline:number;timeline:number;configured_db:string;configured_oid:string}>(
      `SELECT t.application_id,t.installation_id,t.epoch,t.ledger_id,r.manifest_digest,t.profile,t.revoked,t.runtime_role,current_user AS role,session_user AS session,current_database() AS db,(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS oid,t.system_identifier AS configured_system,(pg_catalog.pg_control_system()).system_identifier::text AS system,t.timeline AS configured_timeline,(pg_catalog.pg_control_checkpoint()).timeline_id AS timeline,t.database_name AS configured_db,t.database_oid AS configured_oid FROM public.platform_schema_installation_trust_v1 t JOIN public.platform_schema_registry r USING(installation_id)`)).rows;
    const x=rows[0];
    if(rows.length!==1||!x||x.profile!==PROVISIONING_PROFILE||x.revoked||x.role!==x.session||x.role!==x.runtime_role||x.application_id!==applicationId||x.installation_id!==installationId||x.epoch!==initial.epoch||x.ledger_id!==initial.ledgerId||x.manifest_digest!==m.digest||x.db!==initial.databaseName||x.db!==x.configured_db||x.oid!==last.databaseOid||x.oid!==x.configured_oid||x.system!==x.configured_system||x.timeline!==x.configured_timeline)return refuse();
    await verifyRuntimeProtectedMetadataAuthority((sql,values)=>tx.query(sql,values),x.runtime_role,physical.namespace);
    if(JSON.stringify(initial)!==JSON.stringify(authority.authenticatedSnapshot()))return refuse();
    // No physical names, digests, defaults, enum values, data, identifiers
    // from rows, approval keys, or hidden relationship endpoints are returned.
    return {version:1 as const,resources};
  });
  if(JSON.stringify(initial)!==JSON.stringify(authority.authenticatedSnapshot()))return refuse();
  return result;
}
