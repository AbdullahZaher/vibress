// Isolated actual BullMQ worker binary; no production registration.
import {Worker} from "bullmq";
import {createPublicKey} from "node:crypto";
import {verifyReferenceJob,referenceWorkDigest,referenceAction,referenceProducer} from "./m03-normative-job-contract";
import {PlatformMembershipResolver} from "../../../packages/database/src/platform-application-registry";
import {Pool} from "pg";
import {asApplicationId,asTenantId,asPrincipalId} from "../../../packages/platform-kernel/src";
import {TenantUnitOfWork,verifyTenantScope,PolicyEngine} from "../../../packages/tenancy/src";
declare const M03_SCHEMA_VERSION:1|2;
const version=M03_SCHEMA_VERSION;
const need=(key:string)=>{const value=process.env[key];if(!value)throw Error("missing worker config");return value;};
const ident=(value:string)=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(value))throw Error("bad identifier");return '"'+value+'"';};
async function main(){
  const url=new URL(need("M03_RUNTIME_URL"));
  if(process.env.NODE_ENV!=="test"||process.env.M03_NORMATIVE_REFERENCE!=="1"||url.hostname!=="127.0.0.1"||url.port!=="5433"||!/^\/vibress_s03_norm_[a-z0-9_]+$/.test(url.pathname))throw Error("isolated worker only");
  const applicationId=asApplicationId(need("M03_APP")),installationId=need("M03_INSTALLATION"),principalId=asPrincipalId(referenceProducer),
    namespace=ident(need("M03_NAMESPACE")),customers=namespace+"."+ident(need("M03_CUSTOMERS")),activities=namespace+"."+ident(need("M03_ACTIVITIES")),pool=new Pool({connectionString:url.toString(),max:2});
  const readerUrl=new URL(need("M03_MEMBERSHIP_URL"));
  if(readerUrl.hostname!==url.hostname||readerUrl.port!==url.port||readerUrl.pathname!==url.pathname||readerUrl.username===url.username)throw Error("invalid membership reader identity");
  const reader=new Pool({connectionString:readerUrl.toString(),max:2});
  try{
    const identity=(await pool.query<{database:string;oid:string;role:string}>("SELECT current_database() AS database,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,current_user AS role")).rows[0];
    if(!identity||identity.database!==need("M03_DATABASE")||identity.oid!==need("M03_OID")||identity.role!==need("M03_RUNTIME_ROLE"))throw Error("wrong worker identity");
    await pool.query("SELECT "+(version===2?"website":"name")+" FROM "+customers+" LIMIT 0");
    const uow=new TenantUnitOfWork(pool),resolver=new PlatformMembershipResolver(reader),policy=new PolicyEngine([{id:"reference-job",action:referenceAction,effect:"allow"}]),producerKey=createPublicKey({key:Buffer.from(need("M03_JOB_PRODUCER_KEY"),"base64"),format:"der",type:"spki"});
    const worker=new Worker(need("M03_QUEUE"),async job=>{
      if(job.name!=="activity")throw Error("unsupported job action");
      const j=verifyReferenceJob(job.data,producerKey,Date.now());
      if(j.applicationId!==applicationId||j.installationId!==installationId||j.version!==1&&!(version===2&&j.version===2))throw Error("unsupported job scope/version");
      const tenantId=asTenantId(j.tenantId),membership=await resolver.resolve(principalId,applicationId,tenantId);
      if(!membership?.active)throw Error("M03_JOB_AUTHORIZATION_REFUSED");
      const principal={id:principalId,kind:"service" as const,applicationId,tenantIds:[tenantId],roles:membership.roles,permissions:membership.permissions};
      const decision=policy.decide({principal,action:referenceAction,scopeTenantId:tenantId,resourceTenantId:tenantId});
      const scope=verifyTenantScope({applicationId,tenantId,principal,membership,authorization:{allowed:decision.effect==="allow",permissions:membership.permissions,policyVersion:"reference-job-v1"}});
      const digest=referenceWorkDigest(j);
      return uow.run(scope,async tx=>{
        // Job effect marker is the generated activity's scoped PK. The marker
        // and customer effect commit together, rather than rely on Redis alone.
        const exists=await tx.query("SELECT id FROM "+customers+" WHERE id=$1",[j.customerId]);
        if(exists.rowCount!==1)throw Error("customer outside scope");
        const inserted=await tx.query("INSERT INTO "+activities+"(tenant_id,id,code,done) VALUES($1,$2,$3,true) ON CONFLICT (tenant_id,id) DO NOTHING RETURNING id",[tenantId,j.operationId,digest]);
        if(inserted.rowCount===0){
          const prior=await tx.query<{code:string;done:boolean}>("SELECT code,done FROM "+activities+" WHERE id=$1",[j.operationId]);
          if(prior.rows.length!==1||prior.rows[0]?.code!==digest||prior.rows[0]?.done!==true)throw Error("M03_JOB_IDENTITY_CONFLICT");
        }
        if(inserted.rowCount===1&&j.version===2)await tx.query("UPDATE "+customers+" SET website=$1 WHERE id=$2",[j.website,j.customerId]);
        return {version,effect:inserted.rowCount===1?"APPLIED":"ALREADY_APPLIED"};
      });
    },{connection:{host:"127.0.0.1",port:6380},prefix:need("M03_QUEUE_PREFIX"),concurrency:1});
    worker.on("error",()=>{process.exitCode=1;});
    await worker.waitUntilReady();process.send?.({kind:"ready",version});
    const close=async()=>{await worker.close();await pool.end();await reader.end();process.exitCode=0;if(process.connected)process.disconnect?.();};
    process.once("SIGTERM",()=>{void close();});process.once("disconnect",()=>{void close();});
  }catch(error){await pool.end().catch(()=>undefined);await reader.end().catch(()=>undefined);throw error;}
}
void main().catch(()=>{process.send?.({kind:"refused",version});process.exitCode=1;if(process.connected)process.disconnect?.();});
