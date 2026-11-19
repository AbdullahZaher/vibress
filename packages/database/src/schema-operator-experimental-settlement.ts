// Read-only, idempotent settlement across the durable M03 domains. The digest
// changes only when committed evidence changes; contradictions are refused
// instead of repaired.
import {createHash} from "node:crypto";
import type {ClientBase} from "pg";
import {parseSchemaManifest} from "@vibress/schema-engine";
import type {BusinessRecord} from "./schema-operator-experimental-business";
import {experimentalBusinessWitnessMessage} from "./schema-operator-experimental-business";
import type {DisposableDurableRecoveryAuthority} from "./schema-operator-experimental-durable-authority";

const refusal=(reason:string):never=>{throw Error("M03_SETTLEMENT_REFUSED:"+reason);};
const digestOf=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface DomainSettlement{
  digest:string;
  head:string;
  active:string;
  revisions:number;
  backfill:{chunks:number;targets:number;affected:number};
  business:{witnesses:number;settled:number};
}

export async function settleExperimentalDomains(db:ClientBase,authority:DisposableDurableRecoveryAuthority):Promise<DomainSettlement>{
  const state=authority.authenticatedSnapshot();
  if(state.pending||state.businessLease)return refusal("STATE");
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try{
    const trust=(await db.query<{installation_id:string;application_id:string;database_name:string;epoch:string;ledger_id:string;revoked:boolean;approval_key:string}>(
      "SELECT installation_id,application_id,database_name,epoch::text AS epoch,ledger_id::text AS ledger_id,revoked,approval_key FROM public.platform_schema_installation_trust_v1")).rows;
    if(trust.length!==1||trust[0]!.installation_id!==state.installationId||trust[0]!.database_name!==state.databaseName||trust[0]!.ledger_id!==state.ledgerId||trust[0]!.revoked)return refusal("IDENTITY");
    const registry=(await db.query<{manifest:string;manifest_digest:string}>("SELECT manifest,manifest_digest FROM public.platform_schema_registry WHERE installation_id=$1",[state.installationId])).rows[0];
    if(!registry)return refusal("PROVISIONING");
    const active=(await db.query<{revision_digest:string;authority_epoch:string}>("SELECT revision_digest,authority_epoch::text AS authority_epoch FROM public.platform_schema_revision_states_v1 WHERE installation_id=$1 AND state='ACTIVE'",[state.installationId])).rows;
    const revisions=(await db.query<{revision_digest:string;parent_digest:string|null;authority_epoch:string}>("SELECT revision_digest,parent_digest,authority_epoch::text AS authority_epoch FROM public.platform_schema_revisions_v1 WHERE installation_id=$1 ORDER BY applied_at,revision_digest",[state.installationId])).rows;
    if(active.length!==1||active[0]!.revision_digest!==registry.manifest_digest)return refusal("PROVISIONING");
    if(revisions.length===0||revisions.at(-1)!.revision_digest!==registry.manifest_digest)return refusal("PROVISIONING");
    if(parseSchemaManifest(JSON.parse(registry.manifest)).digest!==registry.manifest_digest)return refusal("PROVISIONING");
    const targets=(await db.query<{tenant_id:string;resource_id:string;column_name:string;value:string;chunks:number;affected_total:string;complete:boolean}>(
      "SELECT tenant_id,resource_id,column_name,value,chunks,affected_total::text AS affected_total,complete FROM public.platform_schema_backfill_targets_v1 WHERE installation_id=$1 AND revision_digest=$2 ORDER BY tenant_id,resource_id,column_name",[state.installationId,registry.manifest_digest])).rows;
    const chunks=(await db.query<{operation_id:string;tenant_id:string;resource_id:string;column_name:string;evidence:string;affected:number}>(
      "SELECT operation_id::text AS operation_id,tenant_id,resource_id,column_name,evidence,affected FROM public.platform_schema_backfill_chunks_v1 WHERE installation_id=$1 AND revision_digest=$2",[state.installationId,registry.manifest_digest])).rows;
    for(const chunk of chunks){
      const target=targets.find(t=>t.tenant_id===chunk.tenant_id&&t.resource_id===chunk.resource_id&&t.column_name===chunk.column_name);
      if(!target)return refusal("BACKFILL_PROGRESS");
      const wire=JSON.parse(chunk.evidence) as unknown;
      if(!Array.isArray(wire)||wire.length!==18||wire[0]!=="VIBRESS-M03-BACKFILL-V1"||wire[10]!==registry.manifest_digest||
        wire[13]!==chunk.tenant_id||wire[14]!==chunk.resource_id||wire[15]!==chunk.column_name||wire[16]!==target.value)return refusal("BACKFILL_PROGRESS");
    }
    let affected=0;
    for(const target of targets){
      const owned=chunks.filter(c=>c.tenant_id===target.tenant_id&&c.resource_id===target.resource_id&&c.column_name===target.column_name);
      const total=owned.reduce((sum,c)=>sum+c.affected,0);
      if(owned.length!==target.chunks||total!==Number(target.affected_total))return refusal("BACKFILL_PROGRESS");
      if(target.complete!==owned.some(c=>c.affected===0))return refusal("BACKFILL_PROGRESS");
      affected+=total;
    }
    const witnesses=(await db.query<{operation_id:string;xid:string;evidence:string;signature:string}>(
      "SELECT operation_id::text AS operation_id,xid::text AS xid,evidence,signature FROM public.platform_schema_business_witnesses_v1")).rows;
    const records=new Map<string,BusinessRecord>((state.provisionedBusinessOperations??[]).map(r=>[r.operationId,r]));
    const settled=[...records.values()].filter(r=>r.outcome==="COMMITTED"||r.outcome==="ROLLED_BACK");
    if(witnesses.length!==settled.filter(r=>r.outcome==="COMMITTED").length)return refusal("BUSINESS");
    for(const witness of witnesses){
      // The witness signature is bound to the recovery epoch key and is verified
      // by the authority on recovery; settlement binds the evidence text to the
      // authority-admitted record instead of claiming key custody it lacks.
      const record=records.get(witness.operation_id);
      if(!record||record.outcome!=="COMMITTED"||record.xid!==witness.xid||record.installationId!==state.installationId)return refusal("BUSINESS");
      const {outcome:_,...admission}=record;
      if(witness.evidence!==experimentalBusinessWitnessMessage(admission))return refusal("BUSINESS");
    }
    if(settled.some(r=>r.outcome==="ROLLED_BACK"&&witnesses.some(w=>w.operation_id===r.operationId)))return refusal("BUSINESS");
    const summary={installationId:state.installationId,epoch:trust[0]!.epoch,head:registry.manifest_digest,active:active[0]!.revision_digest,
      revisions:revisions.map(r=>[r.revision_digest,r.parent_digest]),
      backfill:{targets:targets.map(t=>[t.tenant_id,t.resource_id,t.column_name,t.value,t.chunks,Number(t.affected_total),t.complete]),chunks:chunks.map(c=>c.operation_id).sort(),affected},
      business:{witnesses:witnesses.map(w=>w.operation_id).sort(),settled:settled.map(r=>[r.operationId,r.outcome]).sort()}};
    await db.query("COMMIT");
    return {digest:digestOf(summary),head:registry.manifest_digest,active:active[0]!.revision_digest,revisions:revisions.length,
      backfill:{chunks:chunks.length,targets:targets.length,affected},business:{witnesses:witnesses.length,settled:settled.length}};
  }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}
}
