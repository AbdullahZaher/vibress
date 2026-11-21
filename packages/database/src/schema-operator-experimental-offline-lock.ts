// Disposable Linux same-boot, same-PID-namespace writer-death evidence.
// Directory ownership and cooperating version-pinned processes are trust roots.
import { createHash, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import { closeSync, fsyncSync, linkSync, openSync, readFileSync, readlinkSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
type Identity={directory:string;boot:string;namespace:string;uid:number;pid:number;start:string};
function refuse():never{throw Error("offline writer identity unavailable or still live");}
function readStart(pid:number):string|null{
  let raw:string;
  try{raw=readFileSync("/proc/"+pid+"/stat","utf8");}
  catch(error){if(typeof error==="object"&&error!==null&&"code" in error&&error.code==="ENOENT")return null;throw error;}
  const end=raw.lastIndexOf(")");
  const start=raw.slice(end+2).trim().split(/\s+/)[19];
  if(end<0||!start||!/^\d+$/.test(start))return refuse();
  return start;
}
function localIdentity(directory:string):Identity{
  if(process.platform!=="linux"||readlinkSync("/proc/self")!==String(process.pid))return refuse();
  const start=readStart(process.pid),uid=process.getuid?.();
  if(!start||uid===undefined||uid!==process.geteuid?.())return refuse();
  return {directory:realpathSync(directory),boot:readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim(),
    namespace:readlinkSync("/proc/self/ns/pid"),uid,pid:process.pid,start};
}
type LockKind="writer"|"maintenance"|"anchor"|"repair";
const message=(v:Identity,kind:LockKind,context:unknown)=>Buffer.from(JSON.stringify(["VIBRESS-S03-LOCK-V2",kind,v.directory,v.boot,v.namespace,v.uid,v.pid,v.start,context]));
export function syncRecoveryDirectory(directory:string):void{
  const fd=openSync(directory,"r");try{fsyncSync(fd);}finally{closeSync(fd);}
}
// Publish the signed identity atomically. Death before link leaves only an
// unreferenced temporary file; after link it leaves a fully signed lock.
export function acquireRecoveryLock(directory:string,kind:LockKind,key:KeyObject,context:unknown=null):number{
  const target=join(directory,kind+".lock");
  if(process.platform!=="linux")return openSync(target,"wx",0o600);
  const temp=join(directory,"lock-"+randomUUID()+".tmp"),fd=openSync(temp,"wx",0o600);
  let success=false;
  try{
    const identity=localIdentity(directory);
    writeFileSync(fd,JSON.stringify({identity,kind,context,signature:sign(null,message(identity,kind,context),key).toString("base64url")}),"utf8");
    fsyncSync(fd);linkSync(temp,target);
    syncRecoveryDirectory(directory);success=true;return fd;
  }finally{
    try{unlinkSync(temp);}finally{
      if(!success){closeSync(fd);/* a published lock remains fenced */}
    }
  }
}
function inspectDeadLockFile(directory:string,file:string,kind:LockKind,publicKey:KeyObject){
  const raw=readFileSync(file,"utf8");
  if(raw.length>16384||!raw)return refuse();
  const parsed=JSON.parse(raw) as {identity:Identity;kind:LockKind;context:unknown;signature:string};
  const local=localIdentity(directory),v=parsed.identity;
  if(!v||parsed.kind!==kind||v.directory!==local.directory||v.boot!==local.boot||v.namespace!==local.namespace||v.uid!==local.uid||
    !Number.isSafeInteger(v.pid)||v.pid<=0||!/^\d+$/.test(v.start)||typeof parsed.signature!=="string"||
    !/^[A-Za-z0-9_-]{86}$/.test(parsed.signature)||
    !verify(null,message(v,kind,parsed.context),publicKey,Buffer.from(parsed.signature,"base64url")))return refuse();
  const observed=readStart(v.pid);
  if(observed===v.start)return refuse();
  if(observed===null){
    let absent=false;
    try{process.kill(v.pid,0);}
    catch(error){if(typeof error==="object"&&error!==null&&"code" in error&&error.code==="ESRCH")absent=true;else throw error;}
    if(!absent)return refuse();
  }
  return {digest:createHash("sha256").update(raw).digest("hex"),context:parsed.context};
}
export function inspectDeadRecoveryLock(directory:string,kind:LockKind,publicKey:KeyObject){
  return inspectDeadLockFile(directory,join(directory,kind+".lock"),kind,publicKey);
}
export function inspectDeadWriter(directory:string,publicKey:KeyObject):string{
  return inspectDeadRecoveryLock(directory,"writer",publicKey).digest;
}
export function inspectDeadArchivedWriter(directory:string,nonce:string,publicKey:KeyObject):string{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(nonce))return refuse();
  return inspectDeadLockFile(directory,join(directory,"writer-retired-"+nonce+".json"),"writer",publicKey).digest;
}
// An existing archive may be reused ONLY if it is the identical authenticated
// record. Never overwrite, silently delete, or accept unauthenticated evidence.
export function archiveDeadRecoveryLock(directory:string,kind:LockKind,nonce:string,publicKey:KeyObject,expectedDigest:string,probe?:(window:string)=>void):void{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(nonce)||
    inspectDeadRecoveryLock(directory,kind,publicKey).digest!==expectedDigest)return refuse();
  const source=join(directory,kind+".lock"),archive=join(directory,kind+"-retired-"+nonce+".json");
  try{linkSync(source,archive);}
  catch(error){
    if(typeof error!=="object"||error===null||!("code" in error)||error.code!=="EEXIST"||
      inspectDeadLockFile(directory,archive,kind,publicKey).digest!==expectedDigest)throw error;
  }
  syncRecoveryDirectory(directory);probe?.("AFTER_"+kind.toUpperCase()+"_ARCHIVE");
  unlinkSync(source);syncRecoveryDirectory(directory);probe?.("AFTER_OLD_"+kind.toUpperCase()+"_UNLINK");
}
export function archiveDeadWriter(directory:string,nonce:string,publicKey:KeyObject,expectedDigest:string,probe?:(window:string)=>void):void{
  archiveDeadRecoveryLock(directory,"writer",nonce,publicKey,expectedDigest,probe);
}
