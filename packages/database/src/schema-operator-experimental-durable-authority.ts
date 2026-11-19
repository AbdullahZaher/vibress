// Disposable single-host prototype, not P07 adoption or a production service.
// The private state directory and signing key are trusted administrative assets.
// A separately protected latest-head anchor is required to detect privileged
// rollback of the entire authority directory. Never automatically recreate it.
import { createHash, createPublicKey, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExperimentalD1Budget } from "./schema-operator-experimental-deadline";
import { RecoveryEpochAuthority, recoveryEpochMessage } from "./schema-operator-experimental-recovery-epoch";
import { superviseDisposableSchemaOperation, registerExperimentalAdmission, type OwnedOperationFacts } from "./schema-operator-experimental-supervisor";
import { sameRecoveryHead, type ExperimentalRecoveryAnchor, type RecoveryHead } from "./schema-operator-experimental-anchor";
import { acquireRecoveryLock,inspectDeadWriter,inspectDeadArchivedWriter,inspectDeadRecoveryLock,archiveDeadWriter,archiveDeadRecoveryLock,syncRecoveryDirectory } from "./schema-operator-experimental-offline-lock";
import type { ClientBase } from "pg";
import { TenantUnitOfWork,type ScopedTransaction,type VerifiedScope } from "@vibress/tenancy";
import type { RollbackWitness } from "./schema-operator-experimental-session";
import { collectDisposableRollbackEvidence,collectScopedRecoveryReadiness,type ScopedRecoveryTarget,SchemaMigrationOperatorError, type SchemaOperatorRequest, type SchemaOperatorResult } from "./platform-schema-migration-operator";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
type OperationIdentity = { operationId:string; submissionId:string; approvalId:string; planDigest:string; epoch:string; rollbackWitness?:RollbackWitness };
type OperationOutcome = { outcome:"COMMITTED"; newDigest:string } |
  { outcome:"ADMITTED"|"UNCERTAIN"|"ROLLED_BACK"; newDigest?:never };
type Operation = OperationIdentity & OperationOutcome;
type JournalEvidence = Pick<Operation,"operationId"|"submissionId"|"approvalId"|"planDigest"> & { newDigest: string };
type ObservedCommitEvidence = Readonly<{installationId:string;databaseName:string;epoch:string;
  catalogManifestDigest:string;readinessEvidenceDigest:string;journal:readonly JournalEvidence[]}>;
type Event =
  | { kind: "GENESIS"; installationId: string; databaseName: string; epoch: string; ledgerId:string; signingIdentity:string; administrationIdentity:string }
  | { kind: "ADMIT"; operation: Operation }
  | ({ kind: "OUTCOME"; operationId: string; evidenceDigest?: string } & ({outcome:"COMMITTED";newDigest:string}|{outcome:"UNCERTAIN"|"ROLLED_BACK";newDigest?:never}))
  | { kind:"ROLLBACK_WITNESS"; operationId:string; witness:RollbackWitness }
  | { kind: "TAKEOVER"; nonce:string; writerDigest:string; signature:string; maintenanceDigest?:string; anchorLockDigest?:string; action?:"MAINTENANCE_TAKEOVER" }
  | { kind: "BUSINESS_ADMIT"; lease: string; epoch:string }
  | { kind: "BUSINESS_SETTLED"; lease:string; outcome:"COMMITTED"|"ROLLED_BACK" }
  | { kind: "INTENT"; intent: string }
  | { kind: "ADVANCE"; epoch: string; evidenceDigest: string }
  | { kind: "ADVANCE_V2"; epoch:string; evidenceDigest:string; scopedTarget:ScopedRecoveryTarget }
  | { kind: "READY"|"READY_V2"; evidenceDigest: string; catalogManifestDigest:string; journalDigest:string };
type State = { installationId: string; databaseName: string; epoch: string; epochs: string[]; ledgerId:string; signingIdentity:string; administrationIdentity:string;
  pending: boolean; advanced: boolean; businessLease?:string; intent?: string; readyProtocol?:2; scopedTarget?:ScopedRecoveryTarget; operations: Map<string,Operation> };
type RecordLine = { previous: string; event: Event; hash: string };
const ZERO = "0".repeat(64);
function refuse(): never { throw Error("durable recovery authority refused"); }
const keyIdentity=(key:KeyObject)=>createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex");
// An independent trusted administrator signs exact observations, not merely a
// digest format. The signature is bound to this ledger head and transition.
export function recoveryAdministrationMessage(scope:{ledgerId:string;installationId:string;head:string;epoch:string},action:string,payload:unknown):Buffer{
  return Buffer.from(JSON.stringify(["VIBRESS-S03-ADMIN-V1",scope.ledgerId,scope.installationId,scope.head,scope.epoch,action,payload]));
}
const hash = (previous: string,event: Event) => createHash("sha256").update(JSON.stringify([previous,event])).digest("hex");
function validOperation(o: Operation): boolean {
  return UUID.test(o.operationId) && UUID.test(o.submissionId) && UUID.test(o.approvalId) &&
    SHA.test(o.planDigest) && UUID.test(o.epoch);
}
function validScopedTarget(t:ScopedRecoveryTarget,s:State):boolean{
  return !!t&&t.version===2&&/^[a-z][a-z0-9_-]{1,62}$/.test(t.applicationId)&&t.installationId===s.installationId&&t.databaseName===s.databaseName&&
    /^[0-9]{1,20}$/.test(t.systemIdentifier)&&/^[0-9]{1,10}$/.test(t.databaseOid)&&Number.isInteger(t.timeline)&&t.timeline>=2&&SHA.test(t.manifestDigest)&&
    !!t.dataDigests&&Object.keys(t.dataDigests).length===1&&Object.entries(t.dataDigests).every(([k,v])=>/^vr_[a-z0-9_]+_[a-f0-9]{12}$/.test(k)&&SHA.test(v));
}
function validWitness(w:RollbackWitness):boolean{
  return !!w&&/^\d{1,20}$/.test(w.xid)&&/^\d{1,10}$/.test(w.databaseOid)&&/^\d+\.\d+$/.test(w.postmasterStart)&&
    SHA.test(w.previousDigest)&&Object.keys(w.dataDigests).length===1&&Object.entries(w.dataDigests).every(([k,v])=>/^vr_[a-z0-9_]+_[a-f0-9]{12}$/.test(k)&&SHA.test(v));
}
type TakeoverDecision={nonce:string;writerDigest:string;signature:string;maintenanceDigest?:string;anchorLockDigest?:string};
type MaintenanceContext={purpose:"OPEN"}|{purpose:"TAKEOVER";nonce:string;writerDigest:string};
function missingFile(error:unknown):boolean{return typeof error==="object"&&error!==null&&"code" in error&&error.code==="ENOENT";}
function assertNoRepairGate(directory:string):void{
  try{readFileSync(join(directory,"repair.lock"));refuse();}catch(error){if(!missingFile(error))throw error;}
}
function reduce(s: State|undefined,e: Event): State {
  if(e.kind==="GENESIS"){
    if(s || !/^[a-z][a-z0-9_-]{1,62}$/.test(e.installationId) ||
      !/^vibress_s03_[a-z0-9_]+$/.test(e.databaseName) || !UUID.test(e.epoch)||!UUID.test(e.ledgerId)||!SHA.test(e.signingIdentity)||!SHA.test(e.administrationIdentity)) return refuse();
    return {installationId:e.installationId,databaseName:e.databaseName,epoch:e.epoch,
      epochs:[e.epoch],ledgerId:e.ledgerId,signingIdentity:e.signingIdentity,administrationIdentity:e.administrationIdentity,pending:false,advanced:false,operations:new Map()};
  }
  if(!s) return refuse();
  const next:State={...s,epochs:[...s.epochs],operations:new Map(s.operations)};
  switch(e.kind){
    case "ADMIT":
      if(s.businessLease||s.pending || [...s.operations.values()].some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN") || !validOperation(e.operation) || e.operation.outcome!=="ADMITTED" ||
        e.operation.newDigest!==undefined || e.operation.epoch!==s.epoch || s.operations.has(e.operation.operationId)) return refuse();
      if([...s.operations.values()].some(o=>o.submissionId===e.operation.submissionId||o.approvalId===e.operation.approvalId)) return refuse();
      next.operations.set(e.operation.operationId,{...e.operation});break;
    case "ROLLBACK_WITNESS": {
      const o=s.operations.get(e.operationId);const w=e.witness;
      if(!o||o.outcome!=="ADMITTED"||o.rollbackWitness||!validWitness(w))return refuse();
      next.operations.set(e.operationId,{...o,rollbackWitness:w});break;
    }
    case "OUTCOME": {
      const o=s.operations.get(e.operationId);
      if(!o || (o.outcome!=="ADMITTED" && o.outcome!=="UNCERTAIN") ||
        !["UNCERTAIN","COMMITTED","ROLLED_BACK"].includes(e.outcome) ||
        (e.evidenceDigest!==undefined&&!SHA.test(e.evidenceDigest)) ||
        (e.outcome==="COMMITTED" ? !e.newDigest||!SHA.test(e.newDigest) : e.newDigest!==undefined)) return refuse();
      const identity:OperationIdentity={operationId:o.operationId,submissionId:o.submissionId,approvalId:o.approvalId,planDigest:o.planDigest,epoch:o.epoch,...(o.rollbackWitness?{rollbackWitness:o.rollbackWitness}:{})};
      next.operations.set(o.operationId,e.outcome==="COMMITTED"?{...identity,outcome:"COMMITTED",newDigest:e.newDigest}:{...identity,outcome:e.outcome});break;
    }
    case "TAKEOVER":
      if(!UUID.test(e.nonce)||!SHA.test(e.writerDigest)||!/^[A-Za-z0-9_-]{86}$/.test(e.signature)||
        (e.maintenanceDigest!==undefined&&!SHA.test(e.maintenanceDigest))||(e.anchorLockDigest!==undefined&&!SHA.test(e.anchorLockDigest)))return refuse();
      if(!s.pending){next.pending=true;next.advanced=false;next.intent=e.nonce;}
      break;
    case "BUSINESS_ADMIT":
      if(s.pending||s.businessLease||s.readyProtocol===2||e.epoch!==s.epoch||!UUID.test(e.lease)||
        [...s.operations.values()].some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN"))return refuse();
      next.businessLease=e.lease;break;
    case "BUSINESS_SETTLED":
      if(!s.businessLease||s.businessLease!==e.lease||!["COMMITTED","ROLLED_BACK"].includes(e.outcome))return refuse();
      delete next.businessLease;break;
    case "INTENT":
      if(s.pending || !UUID.test(e.intent)) return refuse();
      next.pending=true;next.advanced=false;next.intent=e.intent;break;
    case "ADVANCE":
    case "ADVANCE_V2":
      if(s.businessLease||!s.pending||s.advanced||!UUID.test(e.epoch)||s.epochs.includes(e.epoch)||!SHA.test(e.evidenceDigest)||
        [...s.operations.values()].some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN")) return refuse();
      if(e.kind==="ADVANCE"&&s.readyProtocol===2)return refuse();
      if(e.kind==="ADVANCE_V2"&&!validScopedTarget(e.scopedTarget,s))return refuse();
      next.epoch=e.epoch; next.epochs.push(e.epoch);next.advanced=true;
      if(e.kind==="ADVANCE_V2"){next.readyProtocol=2;next.scopedTarget=JSON.parse(JSON.stringify(e.scopedTarget)) as ScopedRecoveryTarget;}
      break;
    case "READY":
    case "READY_V2":
      if(e.kind==="READY_V2"?s.readyProtocol!==2||!s.scopedTarget:s.readyProtocol===2)return refuse();
      if(s.businessLease||!s.pending||!s.advanced||!SHA.test(e.evidenceDigest)||!SHA.test(e.catalogManifestDigest)||!SHA.test(e.journalDigest)) return refuse();
      next.pending=false;next.advanced=false;delete next.intent;delete next.scopedTarget;break;
    default:return refuse();
  }
  return next;
}
function readLedger(directory:string){
  const raw=readFileSync(join(directory,"authority.jsonl"),"utf8");
  if(!raw.endsWith("\n")||raw.length>16*1024*1024)return refuse();
  let state:State|undefined,head=ZERO,sequence=0;
  for(const line of raw.trimEnd().split("\n")){
    const record=JSON.parse(line) as RecordLine;
    if(record.previous!==head||record.hash!==hash(head,record.event))return refuse();
    state=reduce(state,record.event);head=record.hash;sequence++;
  }
  if(!state)return refuse();
  return {state,head,sequence};
}
type PersistenceProbe=(window:string)=>void;
export class DurableOutcomePersistenceError extends SchemaMigrationOperatorError {
  readonly persistenceStatus="UNCONFIRMED" as const;
  constructor(readonly transactionFacts:OwnedOperationFacts|undefined){
    super("INDETERMINATE","external outcome unavailable; offline reconciliation required");
  }
}
export class DisposableDurableRecoveryAuthority {
  private state: State|undefined;
  private head=ZERO;
  private sequence=0;
  private lock: number|undefined;
  private poisoned=false;
  private readonly path: string;
  private readonly lockPath: string;
  private readonly fences=new Map<string,()=>void>();

  private constructor(directory:string, private readonly key:KeyObject, private readonly anchor:ExperimentalRecoveryAnchor,
    private readonly administrationKey:KeyObject, maintenanceHeld=false,private readonly testProbe?:PersistenceProbe) {
    if(process.env.NODE_ENV==="production"||key.type!=="private"||key.asymmetricKeyType!=="ed25519"||administrationKey.type!=="public"||administrationKey.asymmetricKeyType!=="ed25519"||
      keyIdentity(createPublicKey(key))===keyIdentity(administrationKey)) refuse();
    if(testProbe&&process.env.NODE_ENV!=="test")throw Error("test probe unavailable");
    this.path=join(directory,"authority.jsonl");this.lockPath=join(directory,"writer.lock");
    const maintenancePath=join(directory,"maintenance.lock");
    // Serialize every supported writer acquisition against offline maintenance.
    // A retained repair gate denies normal writer acquisition regardless of
    // whether the interrupted maintenance lock was already released.
    if(!maintenanceHeld)assertNoRepairGate(directory);
    const gate=maintenanceHeld?undefined:acquireRecoveryLock(directory,"maintenance",key,{purpose:"OPEN"});
    try{
      this.lock=acquireRecoveryLock(directory,"writer",key);
    }finally{if(gate!==undefined){closeSync(gate);unlinkSync(maintenancePath);syncRecoveryDirectory(directory);}}
  }
  static initialize(directory:string,key:KeyObject,installationId:string,databaseName:string,epoch:string,
    anchor:ExperimentalRecoveryAnchor,administrationKey:KeyObject){
    const a=new DisposableDurableRecoveryAuthority(directory,key,anchor,administrationKey);
    try{
      const fd=openSync(a.path,"wx",0o600);closeSync(fd);
      a.append({kind:"GENESIS",installationId,databaseName,epoch,ledgerId:randomUUID(),
        signingIdentity:keyIdentity(createPublicKey(key)),administrationIdentity:keyIdentity(administrationKey)});
      const dir=openSync(directory,"r");try{fsyncSync(dir);}finally{closeSync(dir);}
      return a;
    }catch(error){a.close();throw error;}
  }
  // Diagnostic only. No stale-lock removal, record truncation, anchor change,
  // or authority activation. A matching chain is not proof of process death.
  static inspectOffline(directory:string,anchor:ExperimentalRecoveryAnchor){
    const raw=readFileSync(join(directory,"authority.jsonl"),"utf8");
    if(!raw.endsWith("\n")||raw.length>16*1024*1024) return refuse();
    let state:State|undefined,head=ZERO,sequence=0;
    const trusted=anchor.read();
    let anchoredPrefix=false;
    for(const line of raw.trimEnd().split("\n")){
      const record=JSON.parse(line) as RecordLine;
      if(record.previous!==head||record.hash!==hash(head,record.event))return refuse();
      state=reduce(state,record.event);head=record.hash;sequence++;
      if(sameRecoveryHead(trusted,{ledgerId:state.ledgerId,installationId:state.installationId,
        signingIdentity:state.signingIdentity,head,sequence}))anchoredPrefix=true;
    }
    if(!state)return refuse();
    const disposition=trusted===null?"MISSING_ANCHOR":!anchoredPrefix?"ANCHOR_NOT_IN_CHAIN":
      trusted.sequence===sequence?"MATCHED":"LEDGER_AHEAD";
    return Object.freeze({disposition,ledgerId:state.ledgerId,installationId:state.installationId,
      head,sequence,anchorSequence:trusted?.sequence,pending:state.pending,
      mismatch:trusted&&trusted.sequence>sequence?"ANCHOR_AHEAD":!anchoredPrefix?"UNMATCHED_HISTORY":undefined,
      unresolved:[...state.operations.values()].filter(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN").length});
  }
  // Non-mutating classification for the recovery console. No inferred repair.
  static classifyOffline(directory:string,anchor:ExperimentalRecoveryAnchor){
    try{readLedger(directory);}catch{return {disposition:"MALFORMED_OR_UNREADABLE_HISTORY"} as const;}
    try{anchor.read();}catch{return {disposition:"UNAUTHENTICATED_OR_UNREADABLE_ANCHOR"} as const;}
    const result=this.inspectOffline(directory,anchor);
    if(result.mismatch==="ANCHOR_AHEAD")return {...result,disposition:"ANCHOR_AHEAD"} as const;
    return result;
  }
  private static matchedView(directory:string,key:KeyObject,anchor:ExperimentalRecoveryAnchor,administrationKey:KeyObject){
    if(process.env.NODE_ENV==="production"||key.type!=="private"||key.asymmetricKeyType!=="ed25519"||
      administrationKey.type!=="public"||administrationKey.asymmetricKeyType!=="ed25519")return refuse();
    const {state,head,sequence}=readLedger(directory),publicKey=createPublicKey(key);
    const expected={ledgerId:state.ledgerId,installationId:state.installationId,signingIdentity:state.signingIdentity,head,sequence};
    if(state.signingIdentity!==keyIdentity(publicKey)||state.administrationIdentity!==keyIdentity(administrationKey)||
      !sameRecoveryHead(anchor.read(),expected))return refuse();
    const anchorLockDigest=anchor.inspectAbandonedMatchedLock?.(expected)??undefined;
    return {ledgerId:state.ledgerId,installationId:state.installationId,head,epoch:state.epoch,sequence,
      ...(anchorLockDigest?{anchorLockDigest}:{}),expected};
  }
  static inspectOfflineTakeover(directory:string,key:KeyObject,anchor:ExperimentalRecoveryAnchor,administrationKey:KeyObject){
    const {expected:_,...view}=this.matchedView(directory,key,anchor,administrationKey);
    return Object.freeze({...view,writerDigest:inspectDeadWriter(directory,createPublicKey(key))});
  }
  // Require a signed dead maintenance owner; no empty/legacy lock is accepted.
  // If its writer was unlinked, require the exact authenticated archived record.
  static inspectInterruptedMaintenance(directory:string,key:KeyObject,anchor:ExperimentalRecoveryAnchor,administrationKey:KeyObject){
    const {expected:_,...view}=this.matchedView(directory,key,anchor,administrationKey),publicKey=createPublicKey(key);
    const maintenance=inspectDeadRecoveryLock(directory,"maintenance",publicKey);
    const context=maintenance.context as MaintenanceContext;
    if(!context||!["OPEN","TAKEOVER"].includes(context.purpose))return refuse();
    let writerDigest:string|undefined;
    try{writerDigest=inspectDeadWriter(directory,publicKey);}
    catch(error){
      if(!missingFile(error))throw error;
      // Never treat inability to inspect a present writer as absence.
      try{readFileSync(join(directory,"writer.lock"));return refuse();}
      catch(missing){if(!missingFile(missing))throw missing;}
    }
    if(context.purpose==="TAKEOVER"){
      if(!UUID.test(context.nonce)||!SHA.test(context.writerDigest))return refuse();
      if(writerDigest!==context.writerDigest&&inspectDeadArchivedWriter(directory,context.nonce,publicKey)!==context.writerDigest)return refuse();
    }
    return Object.freeze({...view,maintenanceDigest:maintenance.digest,writerDigest:writerDigest??maintenance.digest});
  }
  private static authorizeTakeover(view:{ledgerId:string;installationId:string;head:string;epoch:string;writerDigest:string;maintenanceDigest?:string;anchorLockDigest?:string},
    decision:TakeoverDecision,administrationKey:KeyObject,action:string):void{
    const payload={nonce:decision.nonce,writerDigest:decision.writerDigest,
      ...(decision.maintenanceDigest?{maintenanceDigest:decision.maintenanceDigest}:{}),
      ...(decision.anchorLockDigest?{anchorLockDigest:decision.anchorLockDigest}:{})};
    if(!UUID.test(decision.nonce)||decision.writerDigest!==view.writerDigest||decision.maintenanceDigest!==view.maintenanceDigest||
      decision.anchorLockDigest!==view.anchorLockDigest||!/^[A-Za-z0-9_-]{86}$/.test(decision.signature)||
      !verify(null,recoveryAdministrationMessage(view,action,payload),administrationKey,Buffer.from(decision.signature,"base64url")))return refuse();
  }
  private static repairMatchedAnchor(directory:string,key:KeyObject,anchor:ExperimentalRecoveryAnchor,administrationKey:KeyObject,decision:TakeoverDecision):void{
    if(!decision.anchorLockDigest)return;
    const view=this.matchedView(directory,key,anchor,administrationKey);
    if(view.anchorLockDigest!==decision.anchorLockDigest||!anchor.archiveAbandonedMatchedLock)return refuse();
    anchor.archiveAbandonedMatchedLock(view.expected,decision.anchorLockDigest,decision.nonce);
  }
  private static resumeAfterArchive(directory:string,key:KeyObject,anchor:ExperimentalRecoveryAnchor,administrationKey:KeyObject,
    decision:TakeoverDecision,probe?:PersistenceProbe){
    let a:DisposableDurableRecoveryAuthority|undefined;
    try{
      a=new DisposableDurableRecoveryAuthority(directory,key,anchor,administrationKey,true,probe);
      probe?.("AFTER_REPLACEMENT_WRITER_ACQUIRE");
      const loaded=readLedger(directory);a.state=loaded.state;a.head=loaded.head;a.sequence=loaded.sequence;
      a.assertAnchor();
      a.append({kind:"TAKEOVER",nonce:decision.nonce,writerDigest:decision.writerDigest,signature:decision.signature,
        ...(decision.maintenanceDigest?{maintenanceDigest:decision.maintenanceDigest,action:"MAINTENANCE_TAKEOVER" as const}:{}),
        ...(decision.anchorLockDigest?{anchorLockDigest:decision.anchorLockDigest}:{})});
      probe?.("AFTER_TAKEOVER_PERSIST");
      for(const operation of a.current().operations.values())if(operation.outcome==="ADMITTED")
        a.append({kind:"OUTCOME",operationId:operation.operationId,outcome:"UNCERTAIN"});
      syncRecoveryDirectory(directory);return a;
    }catch(error){if(a?.lock!==undefined){closeSync(a.lock);a.lock=undefined;}throw error;}
  }
  // Clean, pending, or unresolved matched state is always recovered into PENDING.
  static takeoverMatchedPending(directory:string,key:KeyObject,anchor:ExperimentalRecoveryAnchor,administrationKey:KeyObject,
    decision:TakeoverDecision,probe?:PersistenceProbe){
    if(process.env.NODE_ENV==="production"||(probe&&process.env.NODE_ENV!=="test"))return refuse();
    assertNoRepairGate(directory);
    const initial=this.inspectOfflineTakeover(directory,key,anchor,administrationKey);
    this.authorizeTakeover(initial,decision,administrationKey,"OFFLINE_TAKEOVER");
    const gatePath=join(directory,"maintenance.lock"),gate=acquireRecoveryLock(directory,"maintenance",key,
      {purpose:"TAKEOVER",nonce:decision.nonce,writerDigest:decision.writerDigest});
    let changed=false,completed=false;
    try{
      assertNoRepairGate(directory);
      probe?.("AFTER_MAINTENANCE_ACQUIRE");
      this.authorizeTakeover(this.inspectOfflineTakeover(directory,key,anchor,administrationKey),decision,administrationKey,"OFFLINE_TAKEOVER");
      changed=true;
      this.repairMatchedAnchor(directory,key,anchor,administrationKey,decision);
      archiveDeadWriter(directory,decision.nonce,createPublicKey(key),decision.writerDigest,probe);
      const a=this.resumeAfterArchive(directory,key,anchor,administrationKey,decision,probe);
      completed=true;return a;
    }finally{
      closeSync(gate);
      if(!changed||completed){unlinkSync(gatePath);syncRecoveryDirectory(directory);probe?.("AFTER_MAINTENANCE_RELEASE");}
    }
  }
  // A separate recovery gate serializes recovery of a signed, dead maintenance
  // owner. The old gate remains present until a replacement writer is anchored.
  // If this second-level repair itself dies, retain the repair lock for review.
  static takeoverInterruptedMaintenance(directory:string,key:KeyObject,anchor:ExperimentalRecoveryAnchor,administrationKey:KeyObject,decision:TakeoverDecision){
    if(process.env.NODE_ENV==="production")return refuse();
    const initial=this.inspectInterruptedMaintenance(directory,key,anchor,administrationKey);
    this.authorizeTakeover(initial,decision,administrationKey,"MAINTENANCE_TAKEOVER");
    const repairPath=join(directory,"repair.lock"),repair=acquireRecoveryLock(directory,"repair",key,{nonce:decision.nonce});
    let changed=false,completed=false;
    try{
      const view=this.inspectInterruptedMaintenance(directory,key,anchor,administrationKey);
      this.authorizeTakeover(view,decision,administrationKey,"MAINTENANCE_TAKEOVER");
      changed=true;
      this.repairMatchedAnchor(directory,key,anchor,administrationKey,decision);
      if(view.writerDigest!==view.maintenanceDigest)archiveDeadWriter(directory,decision.nonce,createPublicKey(key),view.writerDigest);
      const a=this.resumeAfterArchive(directory,key,anchor,administrationKey,decision);
      try{archiveDeadRecoveryLock(directory,"maintenance",decision.nonce,createPublicKey(key),view.maintenanceDigest);}
      catch(error){if(a.lock!==undefined){closeSync(a.lock);a.lock=undefined;}throw error;}
      completed=true;return a;
    }finally{
      closeSync(repair);
      if(!changed||completed){unlinkSync(repairPath);syncRecoveryDirectory(directory);}
    }
  }
  static open(directory:string,key:KeyObject,anchor:ExperimentalRecoveryAnchor,administrationKey:KeyObject,testProbe?:PersistenceProbe){
    const a=new DisposableDurableRecoveryAuthority(directory,key,anchor,administrationKey,false,testProbe);
    try{
      const loaded=readLedger(directory);a.state=loaded.state;a.head=loaded.head;a.sequence=loaded.sequence;
      const state=a.current();
      if(state.signingIdentity!==keyIdentity(createPublicKey(key))||state.administrationIdentity!==keyIdentity(administrationKey)) refuse();
      a.assertAnchor();
      // A restarted authority never assumes in-flight outcomes or dead sessions.
      if(state.businessLease||[...state.operations.values()].some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN")){
        if(!state.pending) a.beginRecovery();
        for(const o of a.current().operations.values()) if(o.outcome==="ADMITTED")
          a.append({kind:"OUTCOME",operationId:o.operationId,outcome:"UNCERTAIN"});
      }
      return a;
    }catch(error){a.close();throw error;}
  }
  private current():State {
    if(this.lock===undefined||this.poisoned||!this.state) return refuse();
    return this.state;
  }
  private anchorValue(state:State,head=this.head,sequence=this.sequence):RecoveryHead {
    return {ledgerId:state.ledgerId,installationId:state.installationId,signingIdentity:state.signingIdentity,head,sequence};
  }
  private assertAnchor():void{
    if(!sameRecoveryHead(this.anchor.read(),this.anchorValue(this.current()))) refuse();
  }
  private append(event:Event,budget?:ExperimentalD1Budget):void{
    if(this.lock===undefined||this.poisoned) refuse();
    const next=reduce(this.state,event);
    const record={previous:this.head,event,hash:hash(this.head,event)};
    try{
      const previous=this.state?this.anchorValue(this.state):null;
      if(!sameRecoveryHead(this.anchor.read(),previous)) refuse();
      budget?.mark(event.kind+"_LEDGER_START");
      const fd=openSync(this.path,"a");try{
        this.testProbe?.("BEFORE_"+event.kind+"_WRITE");
        writeFileSync(fd,JSON.stringify(record)+"\n","utf8");
        this.testProbe?.("AFTER_"+event.kind+"_WRITE");
        fsyncSync(fd);
        this.testProbe?.("AFTER_"+event.kind+"_FSYNC");
      }finally{closeSync(fd);}
      // Never return success or publish state until both writes are confirmed.
      // A crash between them leaves a mismatch requiring offline investigation.
      budget?.mark(event.kind+"_LEDGER_FSYNC");
      const nextAnchor=this.anchorValue(next,record.hash,this.sequence+1);
      this.anchor.compareAndSet(previous,nextAnchor);
      if(!sameRecoveryHead(this.anchor.read(),nextAnchor)) refuse();
      budget?.mark(event.kind+"_ANCHOR_CONFIRMED");
    }catch(error){this.poisoned=true;for(const fence of this.fences.values()) fence();throw error;}
    this.state=next;this.head=record.hash;this.sequence++;
  }
  snapshot(){
    const s=this.current();
    return {head:this.head,sequence:this.sequence,ledgerId:s.ledgerId,installationId:s.installationId,databaseName:s.databaseName,epoch:s.epoch,
      epochs:[...s.epochs],pending:s.pending,advanced:s.advanced,intent:s.intent,...(s.businessLease?{businessLease:s.businessLease}:{}),...(s.readyProtocol?{readyProtocol:s.readyProtocol}:{}),...(s.scopedTarget?{scopedTarget:JSON.parse(JSON.stringify(s.scopedTarget)) as ScopedRecoveryTarget}:{}),
      operations:[...s.operations.values()].map(o=>({...o,...(o.rollbackWitness?{rollbackWitness:{...o.rollbackWitness,dataDigests:{...o.rollbackWitness.dataDigests}}}:{})}))};
  }
  authenticatedSnapshot(){this.assertAnchor();return this.snapshot();}
  proofAuthority(publicKey:KeyObject):RecoveryEpochAuthority {
    const state=this.current();
    if(keyIdentity(publicKey)!==state.signingIdentity) refuse();
    return new RecoveryEpochAuthority(publicKey,async challenge=>{
      this.assertAnchor();
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
  private requireAdministration(action:string,payload:unknown,signature:string|undefined):void{
    this.assertAnchor();
    if(!signature||!/^[A-Za-z0-9_-]{86}$/.test(signature)||!verify(null,recoveryAdministrationMessage(this.snapshot(),action,payload),
      this.administrationKey,Buffer.from(signature,"base64url"))) refuse();
  }
  // Trusted DBA supplies external evidence of backend quiescence and exact
  // journal outcome. Absence alone is not accepted as rollback evidence.
  // Legacy digest-only administrative boundary is denied. Historical callers
  // must use an operation-specific physical evidence path.
  resolve(_operationId:string,_outcome:"COMMITTED"|"ROLLED_BACK",_evidenceDigest:string,_newDigest?:string,_signature?:string):void{refuse();}
  async resolveObservedRollback(db:ClientBase,operationId:string,evidence:Awaited<ReturnType<typeof collectDisposableRollbackEvidence>>,signature:string):Promise<void>{
    const s=this.current(),operation=s.operations.get(operationId),witness=operation?.rollbackWitness;
    if(!s.pending||s.advanced||this.fences.size!==0||operation?.outcome!=="UNCERTAIN"||!witness||
      operation.epoch!==s.epoch||JSON.stringify(evidence.witness)!==JSON.stringify(witness))return refuse();
    this.requireAdministration("RESOLVE_OBSERVED_ROLLBACK",{operationId,evidence},signature);
    const observed=await collectDisposableRollbackEvidence(db,{installationId:s.installationId,databaseName:s.databaseName,epoch:s.epoch},witness);
    if(JSON.stringify(observed)!==JSON.stringify(evidence))return refuse();
    // Recheck the current signed head after awaiting the real observation.
    this.requireAdministration("RESOLVE_OBSERVED_ROLLBACK",{operationId,evidence},signature);
    const known=[...s.operations.values()].filter(o=>o.outcome==="COMMITTED");
    if(evidence.journal.length!==known.length||new Set(evidence.journal.map(j=>j.operationId)).size!==known.length||
      evidence.catalogManifestDigest!==witness.previousDigest||
      (known.length&&known.at(-1)?.newDigest!==witness.previousDigest)||
      known.some(o=>!evidence.journal.some(j=>j.operationId===o.operationId&&j.submissionId===o.submissionId&&j.approvalId===o.approvalId&&j.planDigest===o.planDigest&&j.newDigest===o.newDigest)))return refuse();
    this.append({kind:"OUTCOME",operationId,outcome:"ROLLED_BACK",evidenceDigest:observed.readinessEvidenceDigest});
  }
  // Resolve only a positive, exact completed-operation witness from the trusted
  // fenced PostgreSQL observer. Missing rows are not rollback evidence.
  resolveObservedCommit(operationId:string,evidence:ObservedCommitEvidence,signature:string):void{
    const s=this.current(),operation=s.operations.get(operationId);
    if(!s.pending||s.advanced||this.fences.size!==0||operation?.outcome!=="UNCERTAIN"||
      evidence.installationId!==s.installationId||evidence.databaseName!==s.databaseName||
      evidence.epoch!==s.epoch||operation.epoch!==s.epoch||
      !SHA.test(evidence.catalogManifestDigest)||!SHA.test(evidence.readinessEvidenceDigest))return refuse();
    this.requireAdministration("RESOLVE_OBSERVED_COMMIT",{operationId,evidence},signature);
    const known=[...s.operations.values()].filter(o=>o.outcome==="COMMITTED"||o.operationId===operationId);
    if(evidence.journal.length!==known.length||new Set(evidence.journal.map(j=>j.operationId)).size!==known.length)return refuse();
    for(const item of known){
      const row=evidence.journal.find(j=>j.operationId===item.operationId);
      if(!row||row.submissionId!==item.submissionId||row.approvalId!==item.approvalId||row.planDigest!==item.planDigest||
        !SHA.test(row.newDigest)||(item.outcome==="COMMITTED"&&row.newDigest!==item.newDigest)||
        (item.operationId===operationId&&row.newDigest!==evidence.catalogManifestDigest))return refuse();
    }
    this.append({kind:"OUTCOME",operationId,outcome:"COMMITTED",newDigest:evidence.catalogManifestDigest,evidenceDigest:evidence.readinessEvidenceDigest});
  }
  advance(epoch:string,quiescenceEvidenceDigest:string,signature?:string):void{
    this.current();if(this.fences.size!==0) refuse();
    this.requireAdministration("ADVANCE",{epoch,quiescenceEvidenceDigest},signature);
    this.append({kind:"ADVANCE",epoch,evidenceDigest:quiescenceEvidenceDigest});
  }
  advanceScoped(epoch:string,quiescenceEvidenceDigest:string,target:ScopedRecoveryTarget,signature:string):void{
    const s=this.current();
    if(this.fences.size!==0||!validScopedTarget(target,s))return refuse();
    this.requireAdministration("ADVANCE_V2",{epoch,quiescenceEvidenceDigest,target},signature);
    this.append({kind:"ADVANCE_V2",epoch,evidenceDigest:quiescenceEvidenceDigest,scopedTarget:target});
  }
  async scopedReadiness(db:ClientBase){
    this.assertAnchor();
    const s=this.current(),target=s.scopedTarget;
    if(!target||!s.pending||!s.advanced||!s.intent||this.fences.size!==0)return refuse();
    const context={version:2 as const,ledgerId:s.ledgerId,head:this.head,sequence:this.sequence,intent:s.intent,administrationIdentity:s.administrationIdentity};
    const observed=await collectScopedRecoveryReadiness(db,target,s.epoch);
    this.assertAnchor();
    if(context.head!==this.head||context.sequence!==this.sequence)return refuse();
    return {context,observed};
  }
  async activateScoped(db:ClientBase,evidence:Awaited<ReturnType<DisposableDurableRecoveryAuthority["scopedReadiness"]>>,signature:string):Promise<void>{
    this.requireAdministration("READY_V2",evidence,signature);
    const observed=await this.scopedReadiness(db);
    if(JSON.stringify(observed)!==JSON.stringify(evidence))return refuse();
    this.requireAdministration("READY_V2",evidence,signature);
    this.commitReady(observed.observed,createHash("sha256").update(JSON.stringify(observed)).digest("hex"));
  }
  activate(evidence:{epoch:string;catalogManifestDigest:string;readinessEvidenceDigest:string;
    journal:readonly JournalEvidence[]},signature?:string):void{
    if(this.current().readyProtocol===2)return refuse();
    this.requireAdministration("READY",evidence,signature);
    this.commitReady(evidence);
  }
  private commitReady(evidence:{epoch:string;catalogManifestDigest:string;readinessEvidenceDigest:string;journal:readonly JournalEvidence[]},boundDigest?:string):void{
    const s=this.current();
    if(!s.pending||!s.advanced||evidence.epoch!==s.epoch||!SHA.test(evidence.catalogManifestDigest)||
      !SHA.test(evidence.readinessEvidenceDigest)||this.fences.size!==0) refuse();
    const committed=[...s.operations.values()].filter(o=>o.outcome==="COMMITTED");
    if(evidence.journal.length!==committed.length||new Set(evidence.journal.map(j=>j.operationId)).size!==committed.length||
      committed.some(o=>!evidence.journal.some(j=>j.operationId===o.operationId&&j.submissionId===o.submissionId&&
        j.approvalId===o.approvalId&&j.planDigest===o.planDigest&&j.newDigest===o.newDigest))) refuse();
    const last=committed.at(-1);
    if(last&&last.newDigest!==evidence.catalogManifestDigest) refuse();
    const journalDigest=createHash("sha256").update(JSON.stringify([...evidence.journal].sort((a,b)=>a.operationId.localeCompare(b.operationId)))).digest("hex");
    this.append({kind:boundDigest===undefined?"READY":"READY_V2",evidenceDigest:boundDigest??evidence.readinessEvidenceDigest,
      catalogManifestDigest:evidence.catalogManifestDigest,journalDigest});
  }
  /** Test-only, authority-local lease. Not distributed fencing or a runtime
   * grant. No new admission after durable INTENT; settlement holds the lease.
   * A process crash or a bypassing direct DB path still requires external fencing.
   */
  async withExperimentalBusinessAdmission<T>(scope:{installationId:string;databaseName:string;epoch:string;confirm:"DISPOSABLE_ONLY"},runner:TenantUnitOfWork,verifiedScope:VerifiedScope,work:(tx:ScopedTransaction,check:()=>void)=>Promise<T>):Promise<T>{
    TenantUnitOfWork.prototype.assertOutermost.call(runner);
    if(process.env.NODE_ENV!=="test"||scope.confirm!=="DISPOSABLE_ONLY")return refuse();
    this.assertAnchor();
    const state=this.current();
    if(state.pending||state.businessLease||state.readyProtocol===2||state.installationId!==scope.installationId||state.databaseName!==scope.databaseName||state.epoch!==scope.epoch||this.fences.size!==0)return refuse();
    const lease=randomUUID();let invalid=false;
    const check=()=>{
      this.assertAnchor();
      const s=this.current();
      if(invalid||s.pending||s.epoch!==scope.epoch||!this.fences.has(lease))return refuse();
    };
    // Durable admission before connection acquisition. An unresolved lease
    // survives process replacement; no automatic administrative clearing path.
    this.append({kind:"BUSINESS_ADMIT",lease,epoch:scope.epoch});
    this.fences.set(lease,()=>{invalid=true;});
    const receipt:{outcome?:"COMMITTED"|"ROLLED_BACK"}={};
    const settle=(outcome:"COMMITTED"|"ROLLED_BACK")=>{
      if(receipt.outcome||!this.fences.has(lease))return refuse();
      receipt.outcome=outcome;
    };
    try{
      check();
      const result=await TenantUnitOfWork.prototype.runOutermost.call(runner,verifiedScope,(tx:ScopedTransaction)=>work(tx,check),settle) as T;
      if(receipt.outcome!=="COMMITTED")return refuse();
      this.append({kind:"BUSINESS_SETTLED",lease,outcome:"COMMITTED"});
      return result;
    }catch(error){
      if(!this.current().pending)this.beginRecovery();
      if(receipt.outcome==="ROLLED_BACK")this.append({kind:"BUSINESS_SETTLED",lease,outcome:"ROLLED_BACK"});
      // An unknown outcome retains the durable marker. Neither a signed
      // quiescence assertion nor a released socket resolves this business tx.
      throw error;
    }finally{this.fences.delete(lease);}
  }
  async execute(connectionString:string,request:SchemaOperatorRequest,publicKey:KeyObject,
    budget=new ExperimentalD1Budget(),captureRollbackWitness=false):Promise<SchemaOperatorResult>{
    this.assertAnchor();
    const s=this.current(),url=new URL(connectionString);
    if(this.fences.size!==0||keyIdentity(publicKey)!==s.signingIdentity||s.pending||request.installationId!==s.installationId||url.pathname!=="/"+s.databaseName) return refuse();
    budget.checkpoint();
    if(request.envelopeVersion!==1) refuse();
    budget.mark("ADMISSION_START");
    this.append({kind:"ADMIT",operation:{operationId:request.operationId,submissionId:request.submissionId,
      approvalId:request.approvalId,planDigest:request.planDigest,epoch:s.epoch,outcome:"ADMITTED"}},budget);
    const id=request.operationId;
    const expectedAdmission=JSON.stringify(["EXECUTE",request.installationId,id,request.submissionId,request.approvalId,request.planDigest,request.envelopeVersion]);
    let facts:OwnedOperationFacts|undefined;
    const observed=()=>facts?.admissionKey===expectedAdmission&&facts.mode==="EXECUTE"?facts:undefined;
    try{
      const admission={observeSettlement:(value:OwnedOperationFacts)=>{facts=value;},...(captureRollbackWitness?{observeRollbackWitness:(witness:RollbackWitness)=>{
        this.append({kind:"ROLLBACK_WITNESS",operationId:id,witness},budget);
      }}:{}),attach:(fence:()=>void)=>{
        this.fences.set(id,fence);
        if(this.current().pending) fence();
      }};
      registerExperimentalAdmission(admission,request,"EXECUTE");
      const result=await superviseDisposableSchemaOperation(connectionString,request,this.proofAuthority(publicKey),"EXECUTE",budget,admission);
      const fact=observed()?.transaction;
      if(fact?.outcome!=="COMMITTED"||fact.commitDigest!==result.newDigest)
        throw new SchemaMigrationOperatorError("INDETERMINATE","supervisor transaction fact mismatch");
      this.append({kind:"OUTCOME",operationId:id,outcome:"COMMITTED",newDigest:fact.commitDigest},budget);
      budget.mark("FINAL_CLASSIFICATION");
      return budget.expired()&&result.status==="APPLIED"?{...result,status:"COMMITTED_LATE"}:
        budget.expired()&&result.status==="ALREADY_APPLIED"?{...result,status:"ALREADY_APPLIED_LATE"}:result;
    }catch(error){
      // External persistence and transaction observation are separate. Never
      // infer rollback from an exception code, socket close or elapsed time.
      if(this.poisoned) throw new DurableOutcomePersistenceError(observed());
      const fact=observed()?.transaction;
      try{
        if(fact?.outcome==="ROLLED_BACK"&&fact.journalObservation==="ABSENT"){
          this.append({kind:"OUTCOME",operationId:id,outcome:"ROLLED_BACK"});
        }else if(fact?.outcome==="COMMITTED"&&fact.commitDigest){
          this.append({kind:"OUTCOME",operationId:id,outcome:"COMMITTED",newDigest:fact.commitDigest});
        }else{
          this.append({kind:"OUTCOME",operationId:id,outcome:"UNCERTAIN"});
          if(!this.current().pending) this.beginRecovery();
        }
      }catch{throw new DurableOutcomePersistenceError(observed());}
      throw error;
    }finally{this.fences.delete(id);}
  }
  // Reconciliation is read-only with respect to schema; it cannot admit a new
  // identity. Pending recovery is deliberately handled only by trusted admin.
  async reconcile(connectionString:string,request:SchemaOperatorRequest,publicKey:KeyObject,budget=new ExperimentalD1Budget()):Promise<SchemaOperatorResult>{
    this.assertAnchor();
    const s=this.current(),o=s.operations.get(request.operationId);
    if(s.pending||!o||o.outcome!=="COMMITTED"||o.epoch!==s.epoch||request.envelopeVersion!==1||
      request.installationId!==s.installationId||new URL(connectionString).pathname!=="/"+s.databaseName||
      o.submissionId!==request.submissionId||o.approvalId!==request.approvalId||o.planDigest!==request.planDigest) return refuse();
    if(this.fences.size!==0) return refuse();
    const id=o.operationId;
    try{
      const admission={attach:(fence:()=>void)=>{this.fences.set(id,fence);if(this.current().pending) fence();}};
      registerExperimentalAdmission(admission,request,"RECONCILE");
      const result=await superviseDisposableSchemaOperation(connectionString,request,this.proofAuthority(publicKey),"RECONCILE",budget,admission);
      if(result.newDigest!==o.newDigest) throw new SchemaMigrationOperatorError("INDETERMINATE","external journal conflicts with reconciled database");
      return result;
    }finally{this.fences.delete(id);}
  }
  close():void{
    if(this.lock===undefined)return;
    if(this.fences.size!==0) refuse();
    closeSync(this.lock);this.lock=undefined;unlinkSync(this.lockPath);
  }
}
