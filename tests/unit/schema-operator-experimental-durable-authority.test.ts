// @vitest-environment node
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DisposableDurableRecoveryAuthority, recoveryAdministrationMessage } from "../../packages/database/src/schema-operator-experimental-durable-authority";
import { FileExperimentalRecoveryAnchor, type ExperimentalRecoveryAnchor } from "../../packages/database/src/schema-operator-experimental-anchor";
import { ExperimentalD1Budget } from "../../packages/database/src/schema-operator-experimental-deadline";

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),"s03-authority-")),ledger=join(dir,"ledger"),anchorDir=join(dir,"anchor");
  mkdirSync(ledger);mkdirSync(anchorDir);
  const keys=generateKeyPairSync("ed25519"),admin=generateKeyPairSync("ed25519"),anchorKeys=generateKeyPairSync("ed25519");
  const anchor=new FileExperimentalRecoveryAnchor(anchorDir,anchorKeys.privateKey),epoch=randomUUID();
  const initialize=(adapter:ExperimentalRecoveryAnchor=anchor)=>DisposableDurableRecoveryAuthority.initialize(ledger,keys.privateKey,"s03-lab","vibress_s03_lab",epoch,adapter,admin.publicKey);
  const open=(adapter:ExperimentalRecoveryAnchor=anchor)=>DisposableDurableRecoveryAuthority.open(ledger,keys.privateKey,adapter,admin.publicKey);
  const attest=(a:DisposableDurableRecoveryAuthority,action:string,payload:unknown)=>sign(null,recoveryAdministrationMessage(a.snapshot(),action,payload),admin.privateKey).toString("base64url");
  return {dir,ledger,anchorDir,keys,admin,anchorKeys,anchor,epoch,initialize,open,attest};
}
describe("disposable durable recovery authority",()=>{
  it("persists intent and prohibits epoch reuse and unsigned or stale readiness",async()=>{
    const f=fixture();let a=f.initialize();
    try{
      expect(await a.proofAuthority(f.keys.publicKey).prove("s03-lab","vibress_s03_lab",new ExperimentalD1Budget())).toBe(f.epoch);
      expect(()=>f.open()).toThrow();
      a.beginRecovery();a.close();a=f.open();
      expect(a.snapshot().pending).toBe(true);
      await expect(a.proofAuthority(f.keys.publicKey).prove("s03-lab","vibress_s03_lab",new ExperimentalD1Budget())).rejects.toThrow();
      const q="a".repeat(64),next=randomUUID(),advance={epoch:next,quiescenceEvidenceDigest:q};
      expect(()=>a.advance(next,q)).toThrow();
      expect(()=>a.advance(f.epoch,q,f.attest(a,"ADVANCE",{epoch:f.epoch,quiescenceEvidenceDigest:q}))).toThrow();
      a.advance(next,q,f.attest(a,"ADVANCE",advance));
      const ready={epoch:next,catalogManifestDigest:q,readinessEvidenceDigest:"b".repeat(64),journal:[]};
      expect(()=>a.activate(ready)).toThrow();
      // Synthetic trusted test attestation, not real catalog or human approval.
      a.activate(ready,f.attest(a,"READY",ready));
      expect(await a.proofAuthority(f.keys.publicKey).prove("s03-lab","vibress_s03_lab",new ExperimentalD1Budget())).toBe(next);
      expect(a.snapshot().epochs).toEqual([f.epoch,next]);
      expect(a.snapshot().intent).toBeUndefined();
    }finally{a.close();rmSync(f.dir,{recursive:true,force:true});}
  });
  it("rejects old valid ledger, missing anchor, malformed/truncated ledger and wrong key",()=>{
    const f=fixture();const a=f.initialize();
    try{
      const file=join(f.ledger,"authority.jsonl"),old=readFileSync(file,"utf8");
      a.beginRecovery();a.close();const latest=readFileSync(file,"utf8");
      writeFileSync(file,old);expect(()=>f.open()).toThrow();
      writeFileSync(file,latest.slice(0,-1));expect(()=>f.open()).toThrow();
      writeFileSync(file,latest.replace('"INTENT"','"UNKNOWN"'));expect(()=>f.open()).toThrow();
      writeFileSync(file,latest);
      expect(()=>DisposableDurableRecoveryAuthority.open(f.ledger,generateKeyPairSync("ed25519").privateKey,f.anchor,f.admin.publicKey)).toThrow();
      unlinkSync(join(f.anchorDir,"head.json"));expect(()=>f.open()).toThrow();
    }finally{a.close();rmSync(f.dir,{recursive:true,force:true});}
  });
  it("fails closed when ledger fsync succeeds but anchor CAS fails",()=>{
    const f=fixture();let a=f.initialize();a.close();
    const fault:ExperimentalRecoveryAnchor={read:()=>f.anchor.read(),compareAndSet:()=>{throw Error("injected anchor failure");}};
    try{
      a=f.open(fault);expect(()=>a.beginRecovery()).toThrow();expect(()=>a.snapshot()).toThrow();
      a.close();expect(()=>f.open()).toThrow();
    }finally{a.close();rmSync(f.dir,{recursive:true,force:true});}
  });
  it("confirmed anchor advancement with lost response requires reopen, not reuse",()=>{
    const f=fixture();let a=f.initialize();a.close();
    const fault:ExperimentalRecoveryAnchor={read:()=>f.anchor.read(),compareAndSet:(p,n)=>{f.anchor.compareAndSet(p,n);throw Error("injected lost ACK");}};
    try{
      a=f.open(fault);expect(()=>a.beginRecovery()).toThrow();expect(()=>a.snapshot()).toThrow();
      a.close();a=f.open();expect(a.snapshot().pending).toBe(true);
    }finally{a.close();rmSync(f.dir,{recursive:true,force:true});}
  });
});

describe("offline authority crash diagnostics",()=>{
  it.each(["BEFORE_CAS","AFTER_CAS","BEFORE_INTENT_WRITE","AFTER_INTENT_WRITE","AFTER_INTENT_FSYNC",
    "AFTER_ANCHOR_TEMP_FSYNC","AFTER_ANCHOR_RENAME","AFTER_ANCHOR_DIR_FSYNC"] as const)("actual child SIGKILL %s preserves lock and classifies chain",window=>{
    const f=fixture();const a=f.initialize();a.close();
    try{
      writeFileSync(join(f.dir,"ledger-key.pem"),f.keys.privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600});
      writeFileSync(join(f.dir,"anchor-key.pem"),f.anchorKeys.privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600});
      writeFileSync(join(f.dir,"admin-key.pem"),f.admin.publicKey.export({type:"spki",format:"pem"}),{mode:0o600});
      const child=spawnSync(process.execPath,["--import","tsx","scripts/platform/m03-s03-fault/crash-authority.ts",f.dir,window],
        {env:{...process.env,NODE_ENV:"test"},timeout:15000});
      expect(child.signal).toBe("SIGKILL");
      const result=DisposableDurableRecoveryAuthority.inspectOffline(f.ledger,f.anchor);
      const beforeWrite=window==="BEFORE_INTENT_WRITE";
      const matched=beforeWrite||["AFTER_CAS","AFTER_ANCHOR_RENAME","AFTER_ANCHOR_DIR_FSYNC"].includes(window);
      expect(result).toMatchObject({disposition:matched?"MATCHED":"LEDGER_AHEAD",pending:!beforeWrite,sequence:beforeWrite?1:2});
      expect(()=>f.open()).toThrow();
      if(process.platform==="linux"&&window==="AFTER_CAS"){
        const writerPath=join(f.ledger,"writer.lock"),writer=readFileSync(writerPath,"utf8");
        writeFileSync(writerPath,writer.replace(/"signature":"[^"]+"/,'"signature":"'+"A".repeat(86)+'"'));
        expect(()=>DisposableDurableRecoveryAuthority.inspectOfflineTakeover(f.ledger,f.keys.privateKey,f.anchor,f.admin.publicKey)).toThrow();
        writeFileSync(writerPath,writer);
        const view=DisposableDurableRecoveryAuthority.inspectOfflineTakeover(f.ledger,f.keys.privateKey,f.anchor,f.admin.publicKey);
        const payload={nonce:randomUUID(),writerDigest:view.writerDigest};
        const take=(signature:string)=>DisposableDurableRecoveryAuthority.takeoverMatchedPending(f.ledger,f.keys.privateKey,f.anchor,f.admin.publicKey,{...payload,signature});
        expect(()=>take("A".repeat(86))).toThrow();
        const signature=sign(null,recoveryAdministrationMessage(view,"OFFLINE_TAKEOVER",payload),f.admin.privateKey).toString("base64url");
        const recovered=take(signature);
        try{
          expect(recovered.snapshot()).toMatchObject({pending:true,sequence:3});
          expect(readFileSync(join(f.ledger,"writer-retired-"+payload.nonce+".json"),"utf8")).toContain('"pid":'+child.pid);
          expect(()=>DisposableDurableRecoveryAuthority.inspectOfflineTakeover(f.ledger,f.keys.privateKey,f.anchor,f.admin.publicKey)).toThrow();
          expect(()=>take(signature)).toThrow();
        }finally{recovered.close();}
        const reopened=f.open();try{expect(reopened.snapshot().pending).toBe(true);}finally{reopened.close();}
      }else if(process.platform==="linux"&&!matched){
        expect(()=>DisposableDurableRecoveryAuthority.inspectOfflineTakeover(f.ledger,f.keys.privateKey,f.anchor,f.admin.publicKey)).toThrow();
      }
    }finally{rmSync(f.dir,{recursive:true,force:true});}
  },20000);
  it("independently retained monotonic anchor rejects coordinated rollback of ledger and local anchor copy",()=>{
    const f=fixture();const a=f.initialize();
    try{
      const file=join(f.ledger,"authority.jsonl"),headFile=join(f.anchorDir,"head.json");
      const old=readFileSync(file),oldHead=readFileSync(headFile);
      a.beginRecovery();a.close();
      const retainedDir=join(f.dir,"retained-anchor");mkdirSync(retainedDir);
      writeFileSync(join(retainedDir,"head.json"),readFileSync(headFile),{mode:0o600});
      const retained=new FileExperimentalRecoveryAnchor(retainedDir,f.anchorKeys.privateKey);
      writeFileSync(file,old);writeFileSync(headFile,oldHead);
      expect(DisposableDurableRecoveryAuthority.inspectOffline(f.ledger,retained).disposition).toBe("ANCHOR_NOT_IN_CHAIN");
      expect(()=>f.open(retained)).toThrow();
      // This test models retained trust; local copied files are NOT an
      // independent hardware/service rollback-resistant boundary.
    }finally{a.close();rmSync(f.dir,{recursive:true,force:true});}
  });
});


it("file anchor CAS conformance: stale sequence, wrong identity, forged data and wrong key refuse",()=>{
  const f=fixture();const a=f.initialize();
  try{
    const h=f.anchor.read();if(!h)throw Error("missing head");
    const next={...h,sequence:h.sequence+1,head:"a".repeat(64)};
    expect(()=>f.anchor.compareAndSet(null,next)).toThrow();
    expect(()=>f.anchor.compareAndSet(h,{...next,sequence:h.sequence+2})).toThrow();
    expect(()=>f.anchor.compareAndSet(h,{...next,ledgerId:randomUUID()})).toThrow();
    expect(()=>f.anchor.compareAndSet(h,{...next,installationId:"other-installation"})).toThrow();
    expect(()=>f.anchor.compareAndSet(h,{...next,signingIdentity:"b".repeat(64)})).toThrow();
    expect(f.anchor.read()).toEqual(h);
    const wrong=new FileExperimentalRecoveryAnchor(f.anchorDir,generateKeyPairSync("ed25519").privateKey);
    expect(()=>wrong.read()).toThrow();
    const headFile=join(f.anchorDir,"head.json"),raw=readFileSync(headFile,"utf8");
    writeFileSync(headFile,raw.replace(h.head,"f".repeat(64)));
    expect(()=>f.anchor.read()).toThrow();
    writeFileSync(headFile,raw);
    f.anchor.compareAndSet(h,next);
    expect(()=>f.anchor.compareAndSet(h,next)).toThrow();
    expect(f.anchor.read()).toEqual(next);
  }finally{a.close();rmSync(f.dir,{recursive:true,force:true});}
});
