// File-backed CAS anchor for owned disposable tests. Separate stable storage
// and key custody are deployment requirements, not established by this adapter.
import { createPublicKey, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireRecoveryLock,inspectDeadRecoveryLock,archiveDeadRecoveryLock,syncRecoveryDirectory } from "./schema-operator-experimental-offline-lock";

export interface RecoveryHead {
  readonly ledgerId:string;
  readonly installationId:string;
  readonly signingIdentity:string;
  readonly sequence:number;
  readonly head:string;
}
export interface ExperimentalRecoveryAnchor {
  read():RecoveryHead|null;
  compareAndSet(previous:RecoveryHead|null,next:RecoveryHead):void;
  // Optional local adapter maintenance under the authority's exclusive gate.
  inspectAbandonedMatchedLock?(expected:RecoveryHead):string|null;
  archiveAbandonedMatchedLock?(expected:RecoveryHead,digest:string,nonce:string):void;
}
const SHA=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const message=(h:RecoveryHead)=>Buffer.from(JSON.stringify(["VIBRESS-S03-HEAD-V1",h.ledgerId,h.installationId,h.signingIdentity,h.sequence,h.head]));
export function sameRecoveryHead(a:RecoveryHead|null,b:RecoveryHead|null):boolean{
  return a===null||b===null?a===b:message(a).equals(message(b));
}
function valid(h:RecoveryHead):boolean {
  return UUID.test(h.ledgerId)&&/^[a-z][a-z0-9_-]{1,62}$/.test(h.installationId)&&SHA.test(h.signingIdentity)&&
    Number.isSafeInteger(h.sequence)&&h.sequence>0&&SHA.test(h.head);
}
export class FileExperimentalRecoveryAnchor implements ExperimentalRecoveryAnchor {
  private readonly path:string;
  private readonly publicKey:KeyObject;
  constructor(private readonly directory:string,private readonly key:KeyObject,private readonly testProbe?:(window:string)=>void){
    if(testProbe&&process.env.NODE_ENV!=="test")throw Error("test probe unavailable");
    if(process.env.NODE_ENV==="production"||key.type!=="private"||key.asymmetricKeyType!=="ed25519")throw Error("invalid anchor key");
    this.path=join(directory,"head.json");this.publicKey=createPublicKey(key);
  }
  read():RecoveryHead|null {
    let raw:string;
    try{raw=readFileSync(this.path,"utf8");}
    catch(error){if(typeof error==="object"&&error!==null&&"code" in error&&error.code==="ENOENT")return null;throw error;}
    if(raw.length>4096)throw Error("invalid anchor");
    const record=JSON.parse(raw) as {value:RecoveryHead;signature:string};
    if(!record.value||!valid(record.value)||typeof record.signature!=="string"||
      !/^[A-Za-z0-9_-]{86}$/.test(record.signature)||
      !verify(null,message(record.value),this.publicKey,Buffer.from(record.signature,"base64url")))throw Error("invalid anchor");
    return record.value;
  }
  inspectAbandonedMatchedLock(expected:RecoveryHead):string|null{
    if(!sameRecoveryHead(this.read(),expected))throw Error("anchor mismatch");
    let record:ReturnType<typeof inspectDeadRecoveryLock>;
    try{record=inspectDeadRecoveryLock(this.directory,"anchor",this.publicKey);}
    catch(error){
      if(typeof error==="object"&&error!==null&&"code" in error&&error.code==="ENOENT"){
        // ENOENT must refer to the lock itself, not procfs or other identity input.
        try{readFileSync(join(this.directory,"anchor.lock"));}
        catch(missing){if(typeof missing==="object"&&missing!==null&&"code" in missing&&missing.code==="ENOENT")return null;throw missing;}
      }
      throw error;
    }
    const context=record.context as {previous:RecoveryHead|null;next:RecoveryHead};
    if(!context||!context.next||!valid(context.next)||!sameRecoveryHead(context.next,expected)||
      (context.previous===null?expected.sequence!==1:!context.previous||!valid(context.previous)||
       context.previous.sequence+1!==expected.sequence||context.previous.ledgerId!==expected.ledgerId||
       context.previous.installationId!==expected.installationId||context.previous.signingIdentity!==expected.signingIdentity))
      throw Error("abandoned anchor transition is not uniquely matched");
    return record.digest;
  }
  archiveAbandonedMatchedLock(expected:RecoveryHead,digest:string,nonce:string):void{
    // Caller is the trusted anchor custodian acting under signed authority
    // maintenance. This method never modifies head.json or advances CAS.
    if(this.inspectAbandonedMatchedLock(expected)!==digest)throw Error("abandoned anchor witness changed");
    archiveDeadRecoveryLock(this.directory,"anchor",nonce,this.publicKey,digest);
  }
  compareAndSet(previous:RecoveryHead|null,next:RecoveryHead):void{
    const lockPath=join(this.directory,"anchor.lock");
    const lock=acquireRecoveryLock(this.directory,"anchor",this.key,{previous,next});
    const temp=join(this.directory,"head-"+randomUUID()+".tmp");
    try{
      if(!sameRecoveryHead(this.read(),previous)||!valid(next)||
        (previous===null?next.sequence!==1:next.sequence!==previous.sequence+1||
          next.ledgerId!==previous.ledgerId||next.installationId!==previous.installationId||next.signingIdentity!==previous.signingIdentity))
        throw Error("anchor compare-and-set refused");
      const fd=openSync(temp,"wx",0o600);
      try{writeFileSync(fd,JSON.stringify({value:next,signature:sign(null,message(next),this.key).toString("base64url")}),"utf8");fsyncSync(fd);}
      finally{closeSync(fd);}
      this.testProbe?.("AFTER_ANCHOR_TEMP_FSYNC");
      renameSync(temp,this.path);
      this.testProbe?.("AFTER_ANCHOR_RENAME");
      const dir=openSync(this.directory,"r");try{fsyncSync(dir);}finally{closeSync(dir);}
      this.testProbe?.("AFTER_ANCHOR_DIR_FSYNC");
    }finally{
      try{unlinkSync(temp);}catch{/* temp may have been renamed */}
      closeSync(lock);unlinkSync(lockPath);syncRecoveryDirectory(this.directory);
    }
  }
}
