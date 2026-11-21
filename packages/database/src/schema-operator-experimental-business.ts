// Experimental: exactly one signed generated CRM insert, no arbitrary callback,
// no serving registration and no generic administrative unlock.
import {createHash,createPublicKey,verify,type KeyObject} from "node:crypto";
import {verifyProtectedMetadataAuthority,verifyRuntimeProtectedMetadataAuthority} from "./schema-operator-experimental-protected-acl";
import type {ClientBase} from "pg";
import type {ScopedTransaction,VerifiedScope} from "@vibress/tenancy";
import {compileProvisioningContract,parseSchemaManifest,provisioningIdentifier as qi,PROVISIONING_PROFILE} from "@vibress/schema-engine";
import {asApplicationId,asInstallationId} from "@vibress/platform-kernel";
const fail=():never=>{throw Error("M03_BUSINESS_EVIDENCE_REFUSED");};
const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha=/^[a-f0-9]{64}$/;
const id=/^[a-z][a-z0-9_-]{1,62}$/;
export interface BusinessApproval{
  version:1;operationId:string;applicationId:string;installationId:string;databaseName:string;databaseOid:string;epoch:string;ledgerId:string;authorityHead:string;authoritySequence:number;
  revision:string;physicalDigest:string;tenantId:string;principalId:string;rowId:string;code:string;name:string;
}
export interface BusinessAdmission{
  operationId:string;applicationId:string;installationId:string;databaseName:string;databaseOid:string;epoch:string;ledgerId:string;authorityHead:string;authoritySequence:number;
  revision:string;physicalDigest:string;tenantId:string;principalId:string;rowId:string;workDigest:string;effectDigest:string;runtimeRole:string;namespace:string;table:string;
  systemIdentifier:string;timeline:number;postmasterStart:string;xid:string;
}
export type BusinessRecord=BusinessAdmission & {outcome:"ADMITTED"|"UNCERTAIN"|"COMMITTED"|"ROLLED_BACK"};
export interface BusinessObservation{
  version:1;operationId:string;outcome:"COMMITTED"|"ROLLED_BACK";admissionDigest:string;witnessDigest:string|null;systemIdentifier:string;databaseOid:string;timeline:number;postmasterStart:string;xidStatus:string|null;
}
export function experimentalBusinessMessage(e:BusinessApproval){
  return JSON.stringify(["VIBRESS-M03-CUSTOMER-INSERT-V1",e.version,e.operationId,e.applicationId,e.installationId,e.databaseName,e.databaseOid,e.epoch,e.ledgerId,e.authorityHead,e.authoritySequence,e.revision,e.physicalDigest,e.tenantId,e.principalId,e.rowId,e.code,e.name]);
}
function parseApproval(wire:string):BusinessApproval{
  if(typeof wire!=="string"||wire.length>8192)return fail();
  const r:unknown=JSON.parse(wire);
  if(!Array.isArray(r)||r.length!==18||r[0]!=="VIBRESS-M03-CUSTOMER-INSERT-V1")return fail();
  const [_,version,operationId,applicationId,installationId,databaseName,databaseOid,epoch,ledgerId,authorityHead,authoritySequence,revision,physicalDigest,tenantId,principalId,rowId,code,name]=r as unknown[];
  const is=(v:unknown,re:RegExp):v is string=>typeof v==="string"&&re.test(v);
  if(version!==1||!is(operationId,uuid)||!is(applicationId,id)||!is(installationId,id)||!is(databaseName,/^vibress_s03_norm_[a-z0-9_]+$/)||!is(databaseOid,/^\d{1,10}$/)||!is(epoch,uuid)||!is(ledgerId,uuid)||!is(authorityHead,sha)||typeof authoritySequence!=="number"||!Number.isSafeInteger(authoritySequence)||authoritySequence<1||
  !is(revision,sha)||!is(physicalDigest,sha)||!is(tenantId,id)||!is(principalId,id)||!is(rowId,uuid)||!is(code,/^[a-z0-9-]{1,80}$/)||typeof name!=="string"||name.length<1||name.length>200||name.includes("\u0000"))return fail();
  const e={version,operationId,applicationId,installationId,databaseName,databaseOid,epoch,ledgerId,authorityHead,authoritySequence,revision,physicalDigest,tenantId,principalId,rowId,code,name} as const;
  if(experimentalBusinessMessage(e)!==wire)return fail();
  return e;
}
const qualified=(n:string,t:string)=>qi(n)+"."+qi(t);
const effect=(tenant:string,row:string,code:string,name:string)=>hash(JSON.stringify([tenant,row,code,name]));
// The witness signature excludes outcome: the witness is inserted IN the
// transaction; only the database observation establishes that it committed.
export function experimentalBusinessWitnessMessage(admission:BusinessAdmission){
  return JSON.stringify(["VIBRESS-M03-BUSINESS-WITNESS-V1",admission]);
}
function admissionOf(record:BusinessRecord):BusinessAdmission{
  const {outcome:_,...admission}=record;return admission;
}
type Identity={
  installation_id:string;application_id:string;database_name:string;database_oid:string;system_identifier:string;timeline:number;epoch:string;ledger_id:string;profile:string;revoked:boolean;runtime_role:string;approval_key:string;approval_key_digest:string;manifest_digest:string;
  actualDatabase:string;actualOid:string;actualSystem:string;actualTimeline:number;actualRole:string;sessionRole:string;postmasterStart:string;xid:string;
};
async function getIdentity(tx:ScopedTransaction){
  const rows=(await tx.query<Identity>("SELECT t.installation_id,t.application_id,t.database_name,t.database_oid,t.system_identifier,t.timeline,t.epoch,t.ledger_id,t.profile,t.revoked,t.runtime_role,t.approval_key,t.approval_key_digest,r.manifest_digest,current_database() AS \"actualDatabase\",(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS \"actualOid\",(pg_catalog.pg_control_system()).system_identifier::text AS \"actualSystem\",(pg_catalog.pg_control_checkpoint()).timeline_id AS \"actualTimeline\",current_user AS \"actualRole\",session_user AS \"sessionRole\",extract(epoch FROM pg_catalog.pg_postmaster_start_time())::text AS \"postmasterStart\",pg_catalog.pg_current_xact_id()::text AS xid FROM public.platform_schema_installation_trust_v1 t JOIN public.platform_schema_registry r USING(installation_id)")).rows;
  const x=rows[0];
  if(process.env.NODE_ENV!=="test"||rows.length!==1||!x||x.revoked||x.profile!==PROVISIONING_PROFILE||x.database_name!==x.actualDatabase||x.database_oid!==x.actualOid||x.system_identifier!==x.actualSystem||x.timeline!==x.actualTimeline||x.runtime_role!==x.actualRole||x.actualRole!==x.sessionRole)return fail();
  return x;
}
export async function prepareExperimentalBusiness(tx:ScopedTransaction,scope:VerifiedScope,manifestWire:string,approvalWire:string,signature:string,expected:{head:string;sequence:number;epoch:string;ledgerId:string;installationId:string;databaseName:string;revision:string;physicalDigest:string}){
  const e=parseApproval(approvalWire);
  if(typeof signature!=="string"||!/^[A-Za-z0-9_-]{86}$/.test(signature)||typeof manifestWire!=="string"||manifestWire.length>1024*1024)return fail();
  const m=parseSchemaManifest(JSON.parse(manifestWire));
  if(JSON.stringify(m)!==manifestWire||m.digest!==expected.revision||e.revision!==expected.revision||e.physicalDigest!==expected.physicalDigest||e.authorityHead!==expected.head||e.authoritySequence!==expected.sequence||e.epoch!==expected.epoch||e.ledgerId!==expected.ledgerId||e.installationId!==expected.installationId||e.databaseName!==expected.databaseName||
  e.applicationId!==scope.applicationId||e.tenantId!==scope.tenantId||e.principalId!==scope.principal.id)return fail();
  const contract=compileProvisioningContract(m,{applicationId:asApplicationId(e.applicationId),installationId:asInstallationId(e.installationId)}),resource=contract.resources.find(r=>r.id==="customers"&&r.ownership==="tenant");
  if(contract.digest!==e.physicalDigest||!resource||!resource.columns.some(c=>c.name==="code"&&c.type==="text")||!resource.columns.some(c=>c.name==="name"&&c.type==="text"))return fail();
  const x=await getIdentity(tx),keyBytes=Buffer.from(x.approval_key,"base64"),key=createPublicKey({key:keyBytes,format:"der",type:"spki"});
  if(hash(keyBytes)!==x.approval_key_digest||key.asymmetricKeyType!=="ed25519"||!verify(null,Buffer.from(approvalWire),key,Buffer.from(signature,"base64url"))||x.application_id!==e.applicationId||x.installation_id!==e.installationId||x.database_oid!==e.databaseOid||x.database_name!==e.databaseName||x.epoch!==e.epoch||x.ledger_id!==e.ledgerId||x.manifest_digest!==e.revision)return fail();
  await verifyRuntimeProtectedMetadataAuthority((sql,values)=>tx.query(sql,values),x.runtime_role,contract.namespace);
  const a:BusinessAdmission={operationId:e.operationId,applicationId:e.applicationId,installationId:e.installationId,databaseName:e.databaseName,databaseOid:e.databaseOid,epoch:e.epoch,ledgerId:e.ledgerId,authorityHead:e.authorityHead,authoritySequence:e.authoritySequence,revision:e.revision,physicalDigest:e.physicalDigest,tenantId:e.tenantId,principalId:e.principalId,rowId:e.rowId,workDigest:hash(JSON.stringify([approvalWire,signature])),effectDigest:effect(e.tenantId,e.rowId,e.code,e.name),runtimeRole:x.runtime_role,namespace:contract.namespace,table:resource.table,systemIdentifier:x.actualSystem,timeline:x.actualTimeline,postmasterStart:x.postmasterStart,xid:x.xid};
  return {admission:a,code:e.code,name:e.name};
}
export async function performExperimentalBusiness(tx:ScopedTransaction,prepared:Awaited<ReturnType<typeof prepareExperimentalBusiness>>,signature:string){
  const a=prepared.admission;
  if((await tx.query("INSERT INTO "+qualified(a.namespace,a.table)+"(tenant_id,id,code,name) VALUES($1,$2,$3,$4)",[a.tenantId,a.rowId,prepared.code,prepared.name])).rowCount!==1)return fail();
  if((await tx.query("INSERT INTO public.platform_schema_business_witnesses_v1(operation_id,evidence,signature) VALUES($1,$2,$3)",[a.operationId,experimentalBusinessWitnessMessage(a),signature])).rowCount!==1)return fail();
  const x=await getIdentity(tx);
  await verifyRuntimeProtectedMetadataAuthority((sql,values)=>tx.query(sql,values),a.runtimeRole,a.namespace);
  if(x.xid!==a.xid||x.actualOid!==a.databaseOid||x.actualSystem!==a.systemIdentifier||x.actualTimeline!==a.timeline||x.actualRole!==a.runtimeRole||x.epoch!==a.epoch||x.manifest_digest!==a.revision)return fail();
}
export async function collectExperimentalBusinessOutcome(db:ClientBase,record:BusinessRecord,key:KeyObject):Promise<BusinessObservation>{
  if(process.env.NODE_ENV!=="test"||record.outcome!=="UNCERTAIN")return fail();
  const a=admissionOf(record);
  const fence=async()=>{
    const rows=(await db.query<{database:string;oid:string;system:string;timeline:number;postmasterStart:string;allow:boolean;others:number;prepared:number;superuser:boolean;recovery:boolean}>("SELECT current_database() AS database,d.oid::text AS oid,(pg_control_system()).system_identifier::text AS system,(pg_control_checkpoint()).timeline_id AS timeline,extract(epoch FROM pg_postmaster_start_time())::text AS \"postmasterStart\",d.datallowconn AS allow,(SELECT count(*)::int FROM pg_stat_activity WHERE datid=d.oid AND pid<>pg_backend_pid()) AS others,(SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database()) AS prepared,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,pg_is_in_recovery() AS recovery FROM pg_database d WHERE d.datname=current_database()")).rows;
    const x=rows[0];if(rows.length!==1||!x||!x.superuser||x.recovery||x.allow||x.others||x.prepared||x.database!==a.databaseName||x.oid!==a.databaseOid||x.system!==a.systemIdentifier||x.timeline<a.timeline)return fail();return x;
  };
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try{
    const before=await fence();
    const scope=(await db.query<{epoch:string;ledger_id:string;manifest_digest:string;application_id:string;runtime_role:string;installer_role:string;namespace:string}>("SELECT t.epoch,t.ledger_id,r.manifest_digest,t.application_id,t.runtime_role,t.installer_role,t.namespace FROM public.platform_schema_installation_trust_v1 t JOIN public.platform_schema_registry r USING(installation_id) WHERE t.installation_id=$1 AND NOT t.revoked",[a.installationId])).rows;
    if(scope.length!==1||scope[0]?.epoch!==a.epoch||scope[0].ledger_id!==a.ledgerId||scope[0].manifest_digest!==a.revision||scope[0].application_id!==a.applicationId||scope[0].runtime_role!==a.runtimeRole)return fail();
    if(scope[0]?.namespace!==a.namespace)return fail();
    await verifyProtectedMetadataAuthority((sql,values)=>db.query(sql,values),scope[0].installer_role,a.runtimeRole,a.namespace);
    const witness=(await db.query<{xid:string;evidence:string;signature:string}>("SELECT xid::text,evidence,signature FROM public.platform_schema_business_witnesses_v1 WHERE operation_id=$1",[a.operationId])).rows;
    const original=before.timeline===a.timeline&&before.postmasterStart===a.postmasterStart;
    const status=original?(await db.query<{status:string|null}>("SELECT pg_xact_status($1::xid8) AS status",[a.xid])).rows[0]?.status??null:null;
    let outcome:"COMMITTED"|"ROLLED_BACK",witnessDigest:string|null=null;
    if(witness.length===1){
      const w=witness[0]!,message=experimentalBusinessWitnessMessage(a);
      if(w.xid!==a.xid||w.evidence!==message||!/^[A-Za-z0-9_-]{86}$/.test(w.signature)||!verify(null,Buffer.from(message),key,Buffer.from(w.signature,"base64url"))||original&&status!==null&&status!=="committed")return fail();
      const values=(await db.query<{tenant_id:string;id:string;code:string;name:string}>("SELECT tenant_id,id::text,code,name FROM "+qualified(a.namespace,a.table)+" WHERE tenant_id=$1 AND id=$2",[a.tenantId,a.rowId])).rows;
      if(values.length!==1||!values[0]||effect(values[0].tenant_id,values[0].id,values[0].code,values[0].name)!==a.effectDigest)return fail();
      outcome="COMMITTED";witnessDigest=hash(JSON.stringify(w));
    }else{
      // Absence alone is NEVER rollback evidence, especially after PITR.
      if(witness.length!==0||!original||status!=="aborted")return fail();
      outcome="ROLLED_BACK";
    }
    await verifyProtectedMetadataAuthority((sql,values)=>db.query(sql,values),scope[0].installer_role,a.runtimeRole,a.namespace);
    await db.query("SELECT pg_stat_clear_snapshot()");
    if(JSON.stringify(before)!==JSON.stringify(await fence()))return fail();
    await db.query("COMMIT");
    return {version:1,operationId:a.operationId,outcome,admissionDigest:hash(experimentalBusinessWitnessMessage(a)),witnessDigest,systemIdentifier:before.system,databaseOid:before.oid,timeline:before.timeline,postmasterStart:before.postmasterStart,xidStatus:status};
  }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}
}
