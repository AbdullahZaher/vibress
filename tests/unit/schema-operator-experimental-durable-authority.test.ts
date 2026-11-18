// @vitest-environment node
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DisposableDurableRecoveryAuthority } from "../../packages/database/src/schema-operator-experimental-durable-authority";
import { ExperimentalD1Budget } from "../../packages/database/src/schema-operator-experimental-deadline";

describe("disposable durable recovery authority",()=>{
  it("persists recovery intent and nonreuse across restart; rejects premature readiness",async()=>{
    const dir=mkdtempSync(join(tmpdir(),"s03-authority-"));
    const keys=generateKeyPairSync("ed25519");
    const epoch=randomUUID();
    let a=DisposableDurableRecoveryAuthority.initialize(dir,keys.privateKey,"s03-lab","vibress_s03_lab",epoch);
    try{
      expect(await a.proofAuthority(keys.publicKey).prove("s03-lab","vibress_s03_lab",new ExperimentalD1Budget())).toBe(epoch);
      expect(()=>DisposableDurableRecoveryAuthority.open(dir,keys.privateKey,a.snapshot().head)).toThrow();
      a.beginRecovery();
      const head=a.snapshot().head;a.close();
      a=DisposableDurableRecoveryAuthority.open(dir,keys.privateKey,head);
      expect(a.snapshot().pending).toBe(true);
      await expect(a.proofAuthority(keys.publicKey).prove("s03-lab","vibress_s03_lab",new ExperimentalD1Budget())).rejects.toThrow();
      expect(()=>a.advance(epoch,"a".repeat(64))).toThrow();
      expect(()=>a.activate({epoch,catalogManifestDigest:"a".repeat(64),readinessEvidenceDigest:"b".repeat(64),journal:[]})).toThrow();
      const next=randomUUID();a.advance(next,"a".repeat(64));
      a.activate({epoch:next,catalogManifestDigest:"a".repeat(64),readinessEvidenceDigest:"b".repeat(64),journal:[]});
      expect(await a.proofAuthority(keys.publicKey).prove("s03-lab","vibress_s03_lab",new ExperimentalD1Budget())).toBe(next);
      expect(a.snapshot().epochs).toEqual([epoch,next]);
    }finally{a.close();rmSync(dir,{recursive:true,force:true});}
  });
  it("rejects truncated history and detects a valid rewind using an independently retained head",()=>{
    const dir=mkdtempSync(join(tmpdir(),"s03-authority-"));
    const keys=generateKeyPairSync("ed25519");
    const a=DisposableDurableRecoveryAuthority.initialize(dir,keys.privateKey,"s03-lab","vibress_s03_lab");
    try{
      const file=join(dir,"authority.jsonl"),old=readFileSync(file,"utf8");
      a.beginRecovery();const head=a.snapshot().head;a.close();
      writeFileSync(file,old);
      expect(()=>DisposableDurableRecoveryAuthority.open(dir,keys.privateKey,head)).toThrow();
      writeFileSync(file,old.slice(0,-1));
      expect(()=>DisposableDurableRecoveryAuthority.open(dir,keys.privateKey,head)).toThrow();
    }finally{a.close();rmSync(dir,{recursive:true,force:true});}
  });
});
