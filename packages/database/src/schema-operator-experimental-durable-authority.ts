// Disposable single-host prototype, not P07 adoption or a production service.
// The private state directory and signing key are trusted administrative assets.
// A separately protected latest-head anchor is required to detect privileged
// rollback of the entire authority directory. Never automatically recreate it.
import { createHash, randomUUID, sign, type KeyObject } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExperimentalD1Budget } from "./schema-operator-experimental-deadline";
import { RecoveryEpochAuthority, recoveryEpochMessage } from "./schema-operator-experimental-recovery-epoch";
import { superviseDisposableSchemaOperation } from "./schema-operator-experimental-supervisor";
import type { SchemaOperatorRequest, SchemaOperatorResult } from "./platform-schema-migration-operator";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
type Outcome = "ADMITTED" | "UNCERTAIN" | "COMMITTED" | "ROLLED_BACK";
type Operation = { operationId: string; submissionId: string; approvalId: string; planDigest: string;
  epoch: string; outcome: Outcome; newDigest?: string };
type JournalEvidence = Pick<Operation,"operationId"|"submissionId"|"approvalId"|"planDigest"> & { newDigest: string };
type Event =
  | { kind: "GENESIS"; installationId: string; databaseName: string; epoch: string }
  | { kind: "ADMIT"; operation: Operation }
  | { kind: "OUTCOME"; operationId: string; outcome: "UNCERTAIN"|"COMMITTED"|"ROLLED_BACK"; newDigest?: string; evidenceDigest?: string }
  | { kind: "INTENT"; intent: string }
  | { kind: "ADVANCE"; epoch: string; evidenceDigest: string }
  | { kind: "READY"; evidenceDigest: string };
type State = { installationId: string; databaseName: string; epoch: string; epochs: string[];
  pending: boolean; advanced: boolean; intent?: string; operations: Map<string,Operation> };
type RecordLine = { previous: string; event: Event; hash: string };
const ZERO = "0".repeat(64);
const refuse = (): never => { throw Error("durable recovery authority refused"); };
const hash = (previous: string,event: Event) => createHash("sha256").update(JSON.stringify([previous,event])).digest("hex");
function validOperation(o: Operation): boolean {
  return UUID.test(o.operationId) && UUID.test(o.submissionId) && UUID.test(o.approvalId) &&
    SHA.test(o.planDigest) && UUID.test(o.epoch);
}
function reduce(s: State|undefined,e: Event): State {
  if(e.kind==="GENESIS"){
    if(s || !/^[a-z][a-z0-9_-]{1,62}$/.test(e.installationId) ||
      !/^vibress_s03_[a-z0-9_]+$/.test(e.databaseName) || !UUID.test(e.epoch)) return refuse();
    return {installationId:e.installationId,databaseName:e.databaseName,epoch:e.epoch,
      epochs:[e.epoch],pending:false,advanced:false,operations:new Map()};
  }
  if(!s) return refuse();
  const next:State={...s,epochs:[...s.epochs],operations:new Map(s.operations)};
  switch(e.kind){
    case "ADMIT":
      if(s.pending || !validOperation(e.operation) || e.operation.outcome!=="ADMITTED" ||
        e.operation.newDigest!==undefined || e.operation.epoch!==s.epoch || s.operations.has(e.operation.operationId)) return refuse();
      if([...s.operations.values()].some(o=>o.submissionId===e.operation.submissionId||o.approvalId===e.operation.approvalId)) return refuse();
      next.operations.set(e.operation.operationId,{...e.operation});break;
    case "OUTCOME": {
      const o=s.operations.get(e.operationId);
      if(!o || (o.outcome!=="ADMITTED" && o.outcome!=="UNCERTAIN") ||
        !["UNCERTAIN","COMMITTED","ROLLED_BACK"].includes(e.outcome) ||
        (e.evidenceDigest!==undefined&&!SHA.test(e.evidenceDigest)) ||
        (e.outcome==="COMMITTED" ? !e.newDigest||!SHA.test(e.newDigest) : e.newDigest!==undefined)) return refuse();
      next.operations.set(o.operationId,{...o,outcome:e.outcome,newDigest:e.newDigest});break;
    }
    case "INTENT":
      if(s.pending || !UUID.test(e.intent)) return refuse();
      next.pending=true;next.advanced=false;next.intent=e.intent;break;
    case "ADVANCE":
      if(!s.pending||s.advanced||!UUID.test(e.epoch)||s.epochs.includes(e.epoch)||!SHA.test(e.evidenceDigest)||
        [...s.operations.values()].some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN")) return refuse();
      next.epoch=e.epoch; next.epochs.push(e.epoch);next.advanced=true;break;
    case "READY":
      if(!s.pending||!s.advanced||!SHA.test(e.evidenceDigest)) return refuse();
      next.pending=false;next.advanced=false;next.intent=undefined;break;
    default:return refuse();
  }
  return next;
}
export class DisposableDurableRecoveryAuthority {
  private state: State|undefined;
  private head=ZERO;
  private lock: number|undefined;
  private poisoned=false;
  private readonly path: string;
  private readonly lockPath: string;
  private readonly fences=new Map<string,()=>void>();

  private constructor(private readonly directory:string, private readonly key:KeyObject) {
    if(process.env.NODE_ENV==="production"||key.type!=="private"||key.asymmetricKeyType!=="ed25519") refuse();
    this.path=join(directory,"authority.jsonl");this.lockPath=join(directory,"writer.lock");
    // No stale-lock auto-break. Crash takeover requires verified old-process
    // death and trust-root intervention; clean restart is exercised separately.
    this.lock=openSync(this.lockPath,"wx",0o600);
  }
  static initialize(directory:string,key:KeyObject,installationId:string,databaseName:string,epoch=randomUUID()){
    const a=new DisposableDurableRecoveryAuthority(directory,key);
    try{
      const fd=openSync(a.path,"wx",0o600);closeSync(fd);
      a.append({kind:"GENESIS",installationId,databaseName,epoch});
      const dir=openSync(directory,"r");try{fsyncSync(dir);}finally{closeSync(dir);}
      return a;
    }catch(error){a.close();throw error;}
  }
  static open(directory:string,key:KeyObject,expectedHead?:string){
    const a=new DisposableDurableRecoveryAuthority(directory,key);
    try{
      const raw=readFileSync(a.path,"utf8");
      if(!raw.endsWith("\n")||raw.length>16*1024*1024) refuse();
      for(const line of raw.trimEnd().split("\n")){
        const record=JSON.parse(line) as RecordLine;
        if(record.previous!==a.head||record.hash!==hash(a.head,record.event)) refuse();
        a.state=reduce(a.state,record.event);a.head=record.hash;
      }
      if(!a.state||(expectedHead!==undefined&&expectedHead!==a.head)) refuse();
      // A restarted authority never assumes in-flight outcomes or dead sessions.
      if([...a.state.operations.values()].some(o=>o.outcome==="ADMITTED")){
        if(!a.state.pending) a.beginRecovery();
        for(const o of a.state.operations.values()) if(o.outcome==="ADMITTED")
          a.append({kind:"OUTCOME",operationId:o.operationId,outcome:"UNCERTAIN"});
      }
      return a;
    }catch(error){a.close();throw error;}
  }
  private current():State {
    if(this.lock===undefined||this.poisoned||!this.state) return refuse();
    return this.state;
  }
  private append(event:Event):void{
    if(this.lock===undefined||this.poisoned) refuse();
    const next=reduce(this.state,event);
    const record={previous:this.head,event,hash:hash(this.head,event)};
    try{
      const fd=openSync(this.path,"a");try{
        writeFileSync(fd,JSON.stringify(record)+"\n","utf8");fsyncSync(fd);
      }finally{closeSync(fd);}
    }catch(error){this.poisoned=true;for(const fence of this.fences.values()) fence();throw error;}
    this.state=next;this.head=record.hash;
  }
  snapshot(){
    const s=this.current();
    return {head:this.head,installationId:s.installationId,databaseName:s.databaseName,epoch:s.epoch,
      epochs:[...s.epochs],pending:s.pending,advanced:s.advanced,intent:s.intent,
      operations:[...s.operations.values()].map(o=>({...o}))};
  }
  proofAuthority(publicKey:KeyObject):RecoveryEpochAuthority {
    return new RecoveryEpochAuthority(publicKey,async challenge=>{
      const s=this.current();
      if(challenge.installationId!==s.installationId||challenge.databaseName!==s.databaseName) return refuse();
      const state=s.pending?"RECOVERY_PENDING":"ACTIVE";
      return {...challenge,epoch:s.epoch,state,signature:sign(null,
        recoveryEpochMessage(challenge,s.epoch,state),this.key).toString("base64url")};
    });
  }
  // The intent is durable BEFORE fencing callbacks run, so a restart denies
  // admission. No restore may begin just because a client socket was closed.
  beginRecovery():void{
    this.current();this.append({kind:"INTENT",intent:randomUUID()});
    for(const fence of this.fences.values()) fence();
  }
  // Trusted DBA supplies external evidence of backend quiescence and exact
  // journal outcome. Absence alone is not accepted as rollback evidence.
  resolve(operationId:string,outcome:"COMMITTED"|"ROLLED_BACK",evidenceDigest:string,newDigest?:string):void{
    const s=this.current();if(!s.pending||this.fences.has(operationId)||!SHA.test(evidenceDigest)) refuse();
    // Include the evidence digest in the append-only audit via a separate
    // validated outcome record; no automatic claim of distributed atomicity.
    this.append({kind:"OUTCOME",operationId,outcome,newDigest,evidenceDigest});
  }
  advance(epoch:string,quiescenceEvidenceDigest:string):void{
    this.current();if(this.fences.size!==0) refuse();
    this.append({kind:"ADVANCE",epoch,evidenceDigest:quiescenceEvidenceDigest});
  }
  activate(evidence:{epoch:string;catalogManifestDigest:string;readinessEvidenceDigest:string;
    journal:readonly JournalEvidence[]}):void{
    const s=this.current();
    if(!s.pending||!s.advanced||evidence.epoch!==s.epoch||!SHA.test(evidence.catalogManifestDigest)||
      !SHA.test(evidence.readinessEvidenceDigest)||this.fences.size!==0) refuse();
    const committed=[...s.operations.values()].filter(o=>o.outcome==="COMMITTED");
    if(evidence.journal.length!==committed.length||new Set(evidence.journal.map(j=>j.operationId)).size!==committed.length||
      committed.some(o=>!evidence.journal.some(j=>j.operationId===o.operationId&&j.submissionId===o.submissionId&&
        j.approvalId===o.approvalId&&j.planDigest===o.planDigest&&j.newDigest===o.newDigest))) refuse();
    this.append({kind:"READY",evidenceDigest:evidence.readinessEvidenceDigest});
  }
  async execute(connectionString:string,request:SchemaOperatorRequest,publicKey:KeyObject,
    budget=new ExperimentalD1Budget()):Promise<SchemaOperatorResult>{
    const s=this.current(),url=new URL(connectionString);
    if(s.pending||request.installationId!==s.installationId||url.pathname!=="/"+s.databaseName) return refuse();
    budget.checkpoint();
    this.append({kind:"ADMIT",operation:{operationId:request.operationId,submissionId:request.submissionId,
      approvalId:request.approvalId,planDigest:request.planDigest,epoch:s.epoch,outcome:"ADMITTED"}});
    const id=request.operationId;
    try{
      const result=await superviseDisposableSchemaOperation(connectionString,request,this.proofAuthority(publicKey),"EXECUTE",budget,
        {attach:fence=>{
          this.fences.set(id,fence);
          if(this.current().pending) fence();
        }});
      this.append({kind:"OUTCOME",operationId:id,outcome:"COMMITTED",newDigest:result.newDigest});
      return budget.expired()&&result.status==="APPLIED"?{...result,status:"COMMITTED_LATE"}:
        budget.expired()&&result.status==="ALREADY_APPLIED"?{...result,status:"ALREADY_APPLIED_LATE"}:result;
    }catch(error){
      // Includes external write failure following PostgreSQL COMMIT. A failed
      // durable append poisons this instance; restart must reconcile ADMITTED.
      if(!this.poisoned){
        this.append({kind:"OUTCOME",operationId:id,outcome:"UNCERTAIN"});
        if(!this.current().pending) this.beginRecovery();
      }
      throw error;
    }finally{this.fences.delete(id);}
  }
  close():void{
    if(this.lock===undefined)return;
    if(this.fences.size!==0) refuse();
    closeSync(this.lock);this.lock=undefined;unlinkSync(this.lockPath);
  }
}
