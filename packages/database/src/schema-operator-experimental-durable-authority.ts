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
import { persistWriterIdentity,inspectDeadWriter,archiveDeadWriter,syncRecoveryDirectory } from "./schema-operator-experimental-offline-lock";
import { SchemaMigrationOperatorError, type SchemaOperatorRequest, type SchemaOperatorResult } from "./platform-schema-migration-operator";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
type OperationIdentity = { operationId:string; submissionId:string; approvalId:string; planDigest:string; epoch:string };
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
  | { kind: "TAKEOVER"; nonce:string; writerDigest:string; signature:string }
  | { kind: "INTENT"; intent: string }
  | { kind: "ADVANCE"; epoch: string; evidenceDigest: string }
  | { kind: "READY"; evidenceDigest: string; catalogManifestDigest:string; journalDigest:string };
type State = { installationId: string; databaseName: string; epoch: string; epochs: string[]; ledgerId:string; signingIdentity:string; administrationIdentity:string;
  pending: boolean; advanced: boolean; intent?: string; operations: Map<string,Operation> };
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
      if(s.pending || [...s.operations.values()].some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN") || !validOperation(e.operation) || e.operation.outcome!=="ADMITTED" ||
        e.operation.newDigest!==undefined || e.operation.epoch!==s.epoch || s.operations.has(e.operation.operationId)) return refuse();
      if([...s.operations.values()].some(o=>o.submissionId===e.operation.submissionId||o.approvalId===e.operation.approvalId)) return refuse();
      next.operations.set(e.operation.operationId,{...e.operation});break;
    case "OUTCOME": {
      const o=s.operations.get(e.operationId);
      if(!o || (o.outcome!=="ADMITTED" && o.outcome!=="UNCERTAIN") ||
        !["UNCERTAIN","COMMITTED","ROLLED_BACK"].includes(e.outcome) ||
        (e.evidenceDigest!==undefined&&!SHA.test(e.evidenceDigest)) ||
        (e.outcome==="COMMITTED" ? !e.newDigest||!SHA.test(e.newDigest) : e.newDigest!==undefined)) return refuse();
      const identity:OperationIdentity={operationId:o.operationId,submissionId:o.submissionId,approvalId:o.approvalId,planDigest:o.planDigest,epoch:o.epoch};
      next.operations.set(o.operationId,e.outcome==="COMMITTED"?{...identity,outcome:"COMMITTED",newDigest:e.newDigest}:{...identity,outcome:e.outcome});break;
    }
    case "TAKEOVER":
      if(!s.pending||!UUID.test(e.nonce)||!SHA.test(e.writerDigest)||!/^[A-Za-z0-9_-]{86}$/.test(e.signature))return refuse();
      break;
    case "INTENT":
      if(s.pending || !UUID.test(e.intent)) return refuse();
      next.pending=true;next.advanced=false;next.intent=e.intent;break;
    case "ADVANCE":
      if(!s.pending||s.advanced||!UUID.test(e.epoch)||s.epochs.includes(e.epoch)||!SHA.test(e.evidenceDigest)||
        [...s.operations.values()].some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN")) return refuse();
      next.epoch=e.epoch; next.epochs.push(e.epoch);next.advanced=true;break;
    case "READY":
      if(!s.pending||!s.advanced||!SHA.test(e.evidenceDigest)||!SHA.test(e.catalogManifestDigest)||!SHA.test(e.journalDigest)) return refuse();
      next.pending=false;next.advanced=false;delete next.intent;break;
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
    if(testProbe&&process.env.NODE_ENV!=="test")return refuse();
    this.path=join(directory,"authority.jsonl");this.lockPath=join(directory,"writer.lock");
    const maintenancePath=join(directory,"maintenance.lock");
    // Serialize every supported writer acquisition against offline maintenance.
    const gate=maintenanceHeld?undefined:openSync(maintenancePath,"wx",0o600);
    try{
      this.lock=openSync(this.lockPath,"wx",0o600);
      try{persistWriterIdentity(this.lock,directory,key);}
      catch(error){closeSync(this.lock);this.lock=undefined;throw error;}
    }finally{if(gate!==undefined){closeSync(gate);unlinkSync(maintenancePath);}}
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
      unresolved:[...state.operations.values()].filter(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN").length});
  }
  static inspectOfflineTakeover(directory:string,key:KeyObject,anchor:ExperimentalRecoveryAnchor,administrationKey:KeyObject){
    if(process.env.NODE_ENV==="production"||key.type!=="private"||key.asymmetricKeyType!=="ed25519"||
      administrationKey.type!=="public"||administrationKey.asymmetricKeyType!=="ed25519")return refuse();
    const {state,head,sequence}=readLedger(directory),publicKey=createPublicKey(key);
    if(!state.pending||state.signingIdentity!==keyIdentity(publicKey)||state.administrationIdentity!==keyIdentity(administrationKey)||
      !sameRecoveryHead(anchor.read(),{ledgerId:state.ledgerId,installationId:state.installationId,signingIdentity:state.signingIdentity,head,sequence}))return refuse();
    const writerDigest=inspectDeadWriter(directory,publicKey);
    return Object.freeze({ledgerId:state.ledgerId,installationId:state.installationId,head,epoch:state.epoch,sequence,writerDigest});
  }
  // Explicit signed action only. No automatic lock deletion, no anchor repair,
  // no activation. Other boots/hosts and mismatched histories are refused.
  static takeoverMatchedPending(directory:string,key:KeyObject,anchor:ExperimentalRecoveryAnchor,administrationKey:KeyObject,
    decision:{nonce:string;writerDigest:string;signature:string}){
    if(process.env.NODE_ENV==="production")return refuse();
    const gatePath=join(directory,"maintenance.lock"),gate=openSync(gatePath,"wx",0o600);
    let changed=false,completed=false;
    let a:DisposableDurableRecoveryAuthority|undefined;
    try{
      const observed=this.inspectOfflineTakeover(directory,key,anchor,administrationKey);
      const payload={nonce:decision.nonce,writerDigest:decision.writerDigest};
      if(!UUID.test(decision.nonce)||decision.writerDigest!==observed.writerDigest||
        !/^[A-Za-z0-9_-]{86}$/.test(decision.signature)||
        !verify(null,recoveryAdministrationMessage(observed,"OFFLINE_TAKEOVER",payload),administrationKey,Buffer.from(decision.signature,"base64url")))return refuse();
      // On any failure after preservation of the old lock begins, leave
      // maintenance fenced; a later operator cannot blindly retry.
      changed=true;archiveDeadWriter(directory,decision.nonce,createPublicKey(key),decision.writerDigest);
      a=new DisposableDurableRecoveryAuthority(directory,key,anchor,administrationKey,true);
      const loaded=readLedger(directory);a.state=loaded.state;a.head=loaded.head;a.sequence=loaded.sequence;
      a.assertAnchor();
      a.append({kind:"TAKEOVER",nonce:decision.nonce,writerDigest:decision.writerDigest,signature:decision.signature});
      for(const operation of a.current().operations.values())if(operation.outcome==="ADMITTED")
        a.append({kind:"OUTCOME",operationId:operation.operationId,outcome:"UNCERTAIN"});
      syncRecoveryDirectory(directory);
      completed=true;return a;
    }finally{
      closeSync(gate);
      if(!changed||completed){unlinkSync(gatePath);syncRecoveryDirectory(directory);}
      else if(a?.lock!==undefined){closeSync(a.lock);a.lock=undefined;}
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
      if([...state.operations.values()].some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN")){
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
      epochs:[...s.epochs],pending:s.pending,advanced:s.advanced,intent:s.intent,
      operations:[...s.operations.values()].map(o=>({...o}))};
  }
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
  resolve(operationId:string,outcome:"COMMITTED"|"ROLLED_BACK",evidenceDigest:string,newDigest?:string,signature?:string):void{
    const s=this.current();if(!s.pending||s.operations.get(operationId)?.outcome!=="UNCERTAIN"||this.fences.has(operationId)||!SHA.test(evidenceDigest)) refuse();
    // Include the evidence digest in the append-only audit via a separate
    // validated outcome record; no automatic claim of distributed atomicity.
    this.requireAdministration("RESOLVE",{operationId,outcome,evidenceDigest,newDigest},signature);
    if(outcome==="COMMITTED"){
      if(!newDigest||!SHA.test(newDigest)) return refuse();
      this.append({kind:"OUTCOME",operationId,outcome:"COMMITTED",newDigest,evidenceDigest});
    }else{
      if(newDigest!==undefined) refuse();
      this.append({kind:"OUTCOME",operationId,outcome:"ROLLED_BACK",evidenceDigest});
    }
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
  activate(evidence:{epoch:string;catalogManifestDigest:string;readinessEvidenceDigest:string;
    journal:readonly JournalEvidence[]},signature?:string):void{
    const s=this.current();
    if(!s.pending||!s.advanced||evidence.epoch!==s.epoch||!SHA.test(evidence.catalogManifestDigest)||
      !SHA.test(evidence.readinessEvidenceDigest)||this.fences.size!==0) refuse();
    this.requireAdministration("READY",evidence,signature);
    const committed=[...s.operations.values()].filter(o=>o.outcome==="COMMITTED");
    if(evidence.journal.length!==committed.length||new Set(evidence.journal.map(j=>j.operationId)).size!==committed.length||
      committed.some(o=>!evidence.journal.some(j=>j.operationId===o.operationId&&j.submissionId===o.submissionId&&
        j.approvalId===o.approvalId&&j.planDigest===o.planDigest&&j.newDigest===o.newDigest))) refuse();
    const last=committed.at(-1);
    if(last&&last.newDigest!==evidence.catalogManifestDigest) refuse();
    const journalDigest=createHash("sha256").update(JSON.stringify([...evidence.journal].sort((a,b)=>a.operationId.localeCompare(b.operationId)))).digest("hex");
    this.append({kind:"READY",evidenceDigest:evidence.readinessEvidenceDigest,
      catalogManifestDigest:evidence.catalogManifestDigest,journalDigest});
  }
  async execute(connectionString:string,request:SchemaOperatorRequest,publicKey:KeyObject,
    budget=new ExperimentalD1Budget()):Promise<SchemaOperatorResult>{
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
      const admission={observeSettlement:(value:OwnedOperationFacts)=>{facts=value;},attach:(fence:()=>void)=>{
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
