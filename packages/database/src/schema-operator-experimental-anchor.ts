// File-backed CAS anchor for owned disposable tests. Separate stable storage
// and key custody are deployment requirements, not established by this adapter.
import { createPublicKey, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  constructor(private readonly directory:string,private readonly key:KeyObject){
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
  compareAndSet(previous:RecoveryHead|null,next:RecoveryHead):void{
    const lockPath=join(this.directory,"anchor.lock");
    const lock=openSync(lockPath,"wx",0o600);
    const temp=join(this.directory,"head-"+randomUUID()+".tmp");
    try{
      if(!sameRecoveryHead(this.read(),previous)||!valid(next)||
        (previous===null?next.sequence!==1:next.sequence!==previous.sequence+1||
          next.ledgerId!==previous.ledgerId||next.installationId!==previous.installationId||next.signingIdentity!==previous.signingIdentity))
        throw Error("anchor compare-and-set refused");
      const fd=openSync(temp,"wx",0o600);
      try{writeFileSync(fd,JSON.stringify({value:next,signature:sign(null,message(next),this.key).toString("base64url")}),"utf8");fsyncSync(fd);}
      finally{closeSync(fd);}
      renameSync(temp,this.path);
      const dir=openSync(this.directory,"r");try{fsyncSync(dir);}finally{closeSync(dir);}
    }finally{
      try{unlinkSync(temp);}catch{/* temp may have been renamed */}
      closeSync(lock);unlinkSync(lockPath);
    }
  }
}
