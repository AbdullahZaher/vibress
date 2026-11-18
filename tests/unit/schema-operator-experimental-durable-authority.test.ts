// @vitest-environment node
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
  return {dir,ledger,anchorDir,keys,admin,anchor,epoch,initialize,open,attest};
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
