// Disposable Linux same-boot, same-PID-namespace writer-death evidence.
// Directory ownership and cooperating version-pinned processes are trust roots.
import { createHash, sign, verify, type KeyObject } from "node:crypto";
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
const message=(v:Identity)=>Buffer.from(JSON.stringify(["VIBRESS-S03-WRITER-V1",v.directory,v.boot,v.namespace,v.uid,v.pid,v.start]));
export function syncRecoveryDirectory(directory:string):void{
  const fd=openSync(directory,"r");try{fsyncSync(fd);}finally{closeSync(fd);}
}
export function persistWriterIdentity(fd:number,directory:string,key:KeyObject):void{
  if(process.platform!=="linux")return;
  const identity=localIdentity(directory);
  writeFileSync(fd,JSON.stringify({identity,signature:sign(null,message(identity),key).toString("base64url")}),"utf8");
  fsyncSync(fd);syncRecoveryDirectory(directory);
}
export function inspectDeadWriter(directory:string,publicKey:KeyObject):string{
  const raw=readFileSync(join(directory,"writer.lock"),"utf8");
  if(raw.length>4096||!raw)return refuse();
  const parsed=JSON.parse(raw) as {identity:Identity;signature:string};
  const local=localIdentity(directory),v=parsed.identity;
  if(!v||v.directory!==local.directory||v.boot!==local.boot||v.namespace!==local.namespace||v.uid!==local.uid||
    !Number.isSafeInteger(v.pid)||v.pid<=0||!/^\d+$/.test(v.start)||typeof parsed.signature!=="string"||
    !/^[A-Za-z0-9_-]{86}$/.test(parsed.signature)||
    !verify(null,message(v),publicKey,Buffer.from(parsed.signature,"base64url")))return refuse();
  const observed=readStart(v.pid);
  if(observed===v.start)return refuse();
  if(observed===null){
    // procfs invisibility (hidepid, permissions) is not proof of death.
    // Signal zero performs only an existence/permission check. No signal
    // is delivered. Require ESRCH; EPERM/success/other errors refuse.
    let absent=false;
    try{process.kill(v.pid,0);}
    catch(error){if(typeof error==="object"&&error!==null&&"code" in error&&error.code==="ESRCH")absent=true;else throw error;}
    if(!absent)return refuse();
  }
  return createHash("sha256").update(raw).digest("hex");
}
export function archiveDeadWriter(directory:string,nonce:string,publicKey:KeyObject,expectedDigest:string):void{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(nonce)||
    inspectDeadWriter(directory,publicKey)!==expectedDigest)return refuse();
  const source=join(directory,"writer.lock");
  // No overwrite. Keep the exact old signed lock as evidence before unlink.
  linkSync(source,join(directory,"writer-retired-"+nonce+".json"));
  syncRecoveryDirectory(directory);
  unlinkSync(source);syncRecoveryDirectory(directory);
}
