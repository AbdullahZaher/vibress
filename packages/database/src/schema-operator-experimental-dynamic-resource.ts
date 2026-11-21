// Experimental bounded dynamic record adapter. Every record is bound to one
// compiled profile revision, every key is declared, and budgets are enforced
// before SQL. PostgreSQL enforces the object shape, byte size and revision
// constant; the adapter additionally enforces per-tenant record counts under a
// transaction-scoped advisory lock. Payload filtering and ordering are refused
// because this profile creates no payload indexes.
import {randomUUID} from "node:crypto";
import {
  assertDynamicRecordQuery,
  compileProvisioningContract,
  dynamicRecordRevision,
  parseSchemaManifest,
  provisioningIdentifier as qi,
  PROVISIONING_PROFILE,
  PROVISIONING_PROFILE_V3,
  validateDynamicRecord,
} from "@vibress/schema-engine";
import {assertVerifiedScope,hasPermission,type ScopedTransaction} from "@vibress/tenancy";
import type {DisposableDurableRecoveryAuthority} from "./schema-operator-experimental-durable-authority";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const refuse=():never=>{throw Error("M03_DYNAMIC_RESOURCE_REFUSED");};
type Row={id:string;revision:string;version_token:string;payload:Record<string,unknown>};
type Page={records:Row[];nextCursor:string|null};
type Identity={application_id:string;installation_id:string;epoch:string;ledger_id:string;manifest_digest:string;profile:string;revoked:boolean;runtime_role:string;role:string;session:string;db:string;oid:string;configured_db:string;configured_oid:string;system:string;configured_system:string;timeline:number;configured_timeline:number};

const identityQuery=`SELECT t.application_id,t.installation_id,t.epoch,t.ledger_id,r.manifest_digest,t.profile,t.revoked,t.runtime_role,current_user AS role,session_user AS session,current_database() AS db,(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS oid,t.database_name AS configured_db,t.database_oid AS configured_oid,(pg_catalog.pg_control_system()).system_identifier::text AS system,t.system_identifier AS configured_system,(pg_catalog.pg_control_checkpoint()).timeline_id AS timeline,t.timeline AS configured_timeline FROM public.platform_schema_installation_trust_v1 t JOIN public.platform_schema_registry r USING(installation_id)`;

export async function openExperimentalDynamicResource(tx:ScopedTransaction,manifestWire:string,resourceId:string,authority:DisposableDurableRecoveryAuthority){
  if(process.env.NODE_ENV!=="test"||typeof manifestWire!=="string"||manifestWire.length>1024*1024)return refuse();
  assertVerifiedScope(tx.scope);
  const scope=tx.scope,initial=authority.authenticatedSnapshot(),last=initial.provisioningOperations?.filter(o=>o.outcome==="COMMITTED").at(-1);
  if(initial.pending||initial.businessLease||initial.readyProtocol===2||!last||last.epoch!==initial.epoch||last.applicationId!==scope.applicationId||initial.provisioningOperations?.some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN"))return refuse();
  const manifest=parseSchemaManifest(JSON.parse(manifestWire));
  const physical=compileProvisioningContract(manifest,{applicationId:scope.applicationId,installationId:manifest.installationId});
  if(JSON.stringify(manifest)!==manifestWire||physical.profile!==PROVISIONING_PROFILE_V3||manifest.installationId!==initial.installationId||manifest.digest!==last.manifestDigest||physical.digest!==last.physicalDigest)return refuse();
  const resource=physical.resources.find(r=>r.id===resourceId),declared=manifest.resources.find(r=>r.id===resourceId);
  if(!resource||!declared?.dynamic||resource.ownership!=="tenant"||resource.columns.length!==6||resource.relations.length!==0||resource.unique.length!==0||JSON.stringify(resource.key)!==JSON.stringify(["tenant_id","id"])||(resource.checks??[]).length!==2)return refuse();
  const profile=declared.dynamic,revision=dynamicRecordRevision(profile);
  const fixed=[{name:"tenant_id",type:"text",required:true},{name:"id",type:"uuid",required:true},{name:"revision",type:"text",required:true},{name:"version_token",type:"uuid",required:true},{name:"payload",type:"jsonb",required:true},{name:"deleted_on",type:"timestamp with time zone",required:false}] as const;
  if(!resource.columns.every((column,index)=>{
    const want:typeof fixed[number]|undefined=fixed[index];
    return want!==undefined&&column.name===want.name&&column.type===want.type&&column.required===want.required&&!column.enumValues&&!column.target;
  }))return refuse();
  const table=qi(physical.namespace)+"."+qi(resource.table),tenant=scope.tenantId;
  const rows=(await tx.query<Identity>(identityQuery)).rows;
  const x=rows[0];
  if(rows.length!==1||!x||x.revoked||x.profile!==PROVISIONING_PROFILE||x.application_id!==scope.applicationId||x.installation_id!==initial.installationId||x.epoch!==initial.epoch||x.ledger_id!==initial.ledgerId||x.manifest_digest!==manifest.digest||x.db!==initial.databaseName||x.db!==x.configured_db||x.oid!==last.databaseOid||x.oid!==x.configured_oid||x.system!==x.configured_system||x.timeline!==x.configured_timeline||x.role!==x.session||x.role!==x.runtime_role)return refuse();
  const unchanged=()=>{
    if(JSON.stringify(initial)!==JSON.stringify(authority.authenticatedSnapshot())){
      tx.markRollbackOnly("dynamic resource authority changed");
      return refuse();
    }
  };
  const allow=(action:string)=>{
    unchanged();
    if(!hasPermission(scope.authorization.permissions,"resource."+resourceId+"."+action))return refuse();
  };
  const projection="id::text AS id,revision,version_token,payload";
  const encodeCursor=(row:Row)=>"v1."+Buffer.from(JSON.stringify([manifest.digest,revision,row.id])).toString("base64url");
  const decodeCursor=(after:string):string=>{
    if(!after.startsWith("v1.")||after.length>512)return refuse();
    let parsed:unknown;
    try{parsed=JSON.parse(Buffer.from(after.slice(3),"base64url").toString("utf8"));}catch{return refuse();}
    if(!Array.isArray(parsed)||parsed.length!==3||parsed[0]!==manifest.digest||parsed[1]!==revision||typeof parsed[2]!=="string"||!uuid.test(parsed[2]))return refuse();
    return parsed[2];
  };
  const checked=(input:unknown)=>{const evidence=validateDynamicRecord(profile,input);return evidence;};
  return {
    revision,
    async create(input:unknown):Promise<Row>{
      allow("create");
      const evidence=checked(input);
      // Serialize the per-tenant budget so concurrent trusted writers cannot
      // overshoot maxRecordsPerTenant within this transaction's view.
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1||':'||$2,0))",[table,tenant]);
      const count=(await tx.query<{n:number}>("SELECT count(*)::int AS n FROM "+table+" WHERE tenant_id=$1 AND deleted_on IS NULL",[tenant])).rows[0]?.n;
      if(typeof count!=="number"||count>=profile.maxRecordsPerTenant)return refuse();
      const result=await tx.query<Row>("INSERT INTO "+table+"(tenant_id,id,revision,version_token,payload,deleted_on) VALUES($1,$2,$3,$4,$5::jsonb,NULL) RETURNING "+projection,[tenant,randomUUID(),revision,randomUUID(),evidence.canonical]);
      unchanged();
      if(result.rowCount!==1||!result.rows[0])return refuse();
      return result.rows[0];
    },
    async get(id:string):Promise<Row|null>{
      allow("read");
      if(typeof id!=="string"||!uuid.test(id))return refuse();
      const result=await tx.query<Row>("SELECT "+projection+" FROM "+table+" WHERE tenant_id=$1 AND id=$2::uuid AND revision=$3 AND deleted_on IS NULL",[tenant,id,revision]);
      unchanged();
      return result.rows[0]??null;
    },
    async update(id:string,expectedVersion:string,input:unknown):Promise<Row|null>{
      allow("update");
      if(typeof id!=="string"||!uuid.test(id)||typeof expectedVersion!=="string"||!uuid.test(expectedVersion))return refuse();
      const evidence=checked(input);
      const result=await tx.query<Row>("UPDATE "+table+" SET payload=$5::jsonb,version_token=$4 WHERE tenant_id=$1 AND id=$2::uuid AND version_token=$3 AND revision=$6 AND deleted_on IS NULL RETURNING "+projection,[tenant,id,expectedVersion,randomUUID(),evidence.canonical,revision]);
      unchanged();
      return result.rows[0]??null;
    },
    async remove(id:string,expectedVersion:string):Promise<boolean>{
      allow("delete");
      if(typeof id!=="string"||!uuid.test(id)||typeof expectedVersion!=="string"||!uuid.test(expectedVersion))return refuse();
      const result=await tx.query("UPDATE "+table+" SET deleted_on=clock_timestamp(),version_token=$4 WHERE tenant_id=$1 AND id=$2::uuid AND version_token=$3 AND revision=$5 AND deleted_on IS NULL",[tenant,id,expectedVersion,randomUUID(),revision]);
      unchanged();
      return result.rowCount===1;
    },
    async list(query:unknown):Promise<Page>{
      allow("read");
      assertDynamicRecordQuery(query);
      const input=query as {limit:number;after?:string};
      const after=input.after??null,key=after===null?null:decodeCursor(after);
      const result=await tx.query<Row>("SELECT "+projection+" FROM "+table+" WHERE tenant_id=$1 AND revision=$3 AND deleted_on IS NULL AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $4",[tenant,key,revision,input.limit+1]);
      unchanged();
      const records=result.rows.slice(0,input.limit);
      return {records,nextCursor:result.rows.length>input.limit?encodeCursor(records.at(-1)!):null};
    },
    // Explicit refusal keeps payload filtering/ordering from silently becoming
    // sequential scans over unbounded tenant data.
    query(_operation:unknown):never{
      throw Error("M03_DYNAMIC_QUERY_UNSUPPORTED");
    },
  };
}
