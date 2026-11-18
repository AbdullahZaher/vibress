// Test-only child. Parent owns temporary directories and observes real SIGKILL.
// Never use against non-disposable authority data.
import { createPrivateKey,createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DisposableDurableRecoveryAuthority } from "../../../packages/database/src/schema-operator-experimental-durable-authority";
import { FileExperimentalRecoveryAnchor,type ExperimentalRecoveryAnchor } from "../../../packages/database/src/schema-operator-experimental-anchor";
const [dir,window]=process.argv.slice(2);
if(process.env.NODE_ENV!=="test"||!dir||!["BEFORE_CAS","AFTER_CAS","BEFORE_INTENT_WRITE","AFTER_INTENT_WRITE","AFTER_INTENT_FSYNC","AFTER_ANCHOR_TEMP_FSYNC","AFTER_ANCHOR_RENAME","AFTER_ANCHOR_DIR_FSYNC"].includes(window??""))throw Error("test-only crash fixture");
const key=createPrivateKey(readFileSync(join(dir,"ledger-key.pem")));
const admin=createPublicKey(readFileSync(join(dir,"admin-key.pem")));
const kill=()=>{process.kill(process.pid,"SIGKILL");throw Error("SIGKILL returned");};
const probe=(stage:string)=>{if(stage===window)kill();};
const anchor=new FileExperimentalRecoveryAnchor(join(dir,"anchor"),createPrivateKey(readFileSync(join(dir,"anchor-key.pem"))),probe);
const fault:ExperimentalRecoveryAnchor={read:()=>anchor.read(),compareAndSet:(p,n)=>{
  if(window==="BEFORE_CAS")kill();
  anchor.compareAndSet(p,n);if(window==="AFTER_CAS")kill();
}};
const a=DisposableDurableRecoveryAuthority.open(join(dir,"ledger"),key,fault,admin,probe);
a.beginRecovery();
throw Error("expected process death");
