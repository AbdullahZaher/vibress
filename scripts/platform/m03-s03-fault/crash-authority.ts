// Test-only child. Parent owns temporary directories and observes real SIGKILL.
// Never use against non-disposable authority data.
import { createPrivateKey,createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchemaOperatorRequest } from "../../../packages/database/src/platform-schema-migration-operator";
import { DisposableDurableRecoveryAuthority } from "../../../packages/database/src/schema-operator-experimental-durable-authority";
import { FileExperimentalRecoveryAnchor,type ExperimentalRecoveryAnchor } from "../../../packages/database/src/schema-operator-experimental-anchor";
const [dir,window]=process.argv.slice(2);
if(process.env.NODE_ENV!=="test"||!dir||!["BEFORE_CAS","AFTER_CAS","BEFORE_INTENT_WRITE","AFTER_INTENT_WRITE","AFTER_INTENT_FSYNC","AFTER_ANCHOR_TEMP_FSYNC","AFTER_ANCHOR_RENAME","AFTER_ANCHOR_DIR_FSYNC","BEFORE_OUTCOME_WRITE","AFTER_MAINTENANCE_ACQUIRE","AFTER_WRITER_ARCHIVE","AFTER_OLD_WRITER_UNLINK","AFTER_REPLACEMENT_WRITER_ACQUIRE","AFTER_TAKEOVER_WRITE","AFTER_TAKEOVER_PERSIST","AFTER_MAINTENANCE_RELEASE"].includes(window??""))throw Error("test-only crash fixture");
const key=createPrivateKey(readFileSync(join(dir,"ledger-key.pem")));
const admin=createPublicKey(readFileSync(join(dir,"admin-key.pem")));
const kill=()=>{process.kill(process.pid,"SIGKILL");throw Error("SIGKILL returned");};
const probe=(stage:string)=>{if(stage===window)kill();};
const anchor=new FileExperimentalRecoveryAnchor(join(dir,"anchor"),createPrivateKey(readFileSync(join(dir,"anchor-key.pem"))),probe);
const fault:ExperimentalRecoveryAnchor={read:()=>anchor.read(),compareAndSet:(p,n)=>{
  if(window==="BEFORE_CAS")kill();
  anchor.compareAndSet(p,n);if(window==="AFTER_CAS")kill();
}};
if(["AFTER_MAINTENANCE_ACQUIRE","AFTER_WRITER_ARCHIVE","AFTER_OLD_WRITER_UNLINK","AFTER_REPLACEMENT_WRITER_ACQUIRE","AFTER_TAKEOVER_WRITE","AFTER_TAKEOVER_PERSIST","AFTER_MAINTENANCE_RELEASE"].includes(window)){
  const decision=JSON.parse(readFileSync(join(dir,"takeover.json"),"utf8")) as Parameters<typeof DisposableDurableRecoveryAuthority.takeoverMatchedPending>[4];
  DisposableDurableRecoveryAuthority.takeoverMatchedPending(join(dir,"ledger"),key,anchor,admin,decision,probe);
  throw Error("expected process death");
}
const a=DisposableDurableRecoveryAuthority.open(join(dir,"ledger"),key,fault,admin,probe);
if(window==="BEFORE_OUTCOME_WRITE"){
  const url=process.env.M03_S03_FAULT_DATABASE_URL??"";
  const parsed=new URL(url);
  if(process.env.M03_S03_DISPOSABLE_CONFIRM!=="I_CONFIRM_DISPOSABLE"||
    !["127.0.0.1","localhost"].includes(parsed.hostname)||parsed.port!=="5433"||
    !/^\/vibress_s03_[a-z]+_[0-9a-f]{8}$/.test(parsed.pathname))throw Error("disposable crash target required");
  const request=JSON.parse(readFileSync(join(dir,"request.json"),"utf8")) as SchemaOperatorRequest;
  void a.execute(url,request,createPublicKey(key)).then(()=>{process.exitCode=2;},()=>{process.exitCode=2;}).finally(()=>a.close());
}else{
  a.beginRecovery();
  throw Error("expected process death");
}
