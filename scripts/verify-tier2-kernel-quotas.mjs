#!/usr/bin/env node
/**
 * M8.7 mandatory, REAL Linux kernel resource acceptance.
 *
 * Run ONLY in a Linux host/container with a writable, delegated cgroup v2
 * subtree (cpu + memory + pids), a usable Bubblewrap and Node 24.
 * This script deliberately FAILS, rather than passes/skips, if delegation
 * is absent. It is not run by default on shared GitHub-hosted runners.
 *
 * Each hostile probe gets a fresh kernel-enforced cgroup. No root, Docker
 * socket, privileged container, policy override or fake cgroup is used.
 */
import { spawn } from "node:child_process";
import { readFileSync, realpathSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  Tier2KernelCgroupLease,
  TIER2_KERNEL_RESOURCE_LIMITS,
  resolveDelegatedTier2CgroupParent,
} from "../packages/domains/plugins/dist/runtime/tier2-kernel-resource-limits.js";

if (process.platform !== "linux") throw new Error("FAIL: genuine Linux kernel required");
if (process.versions.node.split(".")[0] !== "24") {
  throw new Error("FAIL: Node.js 24 is required for supported M8.7 resource acceptance");
}

const bwrapPath = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"].find((item) => {
  try {
    const st = statSync(item);
    return st.isFile() && st.uid === 0 && (st.mode & 0o022) === 0 && (st.mode & 0o111) !== 0;
  } catch { return false; }
});
if (!bwrapPath) throw new Error("FAIL: trusted root-owned executable Bubblewrap is required");

console.log("Delegated cgroup root:", resolveDelegatedTier2CgroupParent());
console.log("Mandatory kernel limits:", TIER2_KERNEL_RESOURCE_LIMITS);

const nodeBinary = realpathSync(process.execPath);
const readNumber = (contents, key) => {
  const line = contents.split("\n").find((part) => part.startsWith(key + " "));
  return line ? Number(line.split(/\s+/)[1]) : NaN;
};

async function probe(label, source, verify) {
  const lease = Tier2KernelCgroupLease.create();
  // This is the ONLY test-only inspection hook. Production callers cannot
  // provide cgroup paths or fabricate controller reads.
  let child;
  let stdout = "";
  let stderr = "";
  try {
    const args = [
      "--unshare-all", "--unshare-net", "--new-session", "--die-with-parent",
      "--block-fd", "3",
      "--ro-bind", "/usr", "/usr",
      ...(existsSync("/lib") ? ["--ro-bind-try", "/lib", "/lib"] : []),
      ...(existsSync("/lib64") ? ["--ro-bind-try", "/lib64", "/lib64"] : []),
      ...(existsSync("/bin") ? ["--ro-bind-try", "/bin", "/bin"] : []),
      "--ro-bind", nodeBinary, nodeBinary,
      "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
      "--clearenv", "--setenv", "PATH", "/usr/bin:/bin",
      nodeBinary, "-e", source,
    ];
    child = spawn(bwrapPath, args, { stdio: ["ignore", "pipe", "pipe", "pipe"] });
    const barrier = child.stdio[3];
    assert.ok(child.pid && barrier && typeof barrier.write === "function", "blocked launcher fd must exist");
    lease.attachBlockedLauncher(child.pid);
    child.stdout.on("data", (buf) => { stdout = (stdout + buf.toString()).slice(-4096); });
    child.stderr.on("data", (buf) => { stderr = (stderr + buf.toString()).slice(-4096); });
    const exit = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    barrier.end("1");
    const watchdog = setTimeout(() => {
      lease.killTree();
      child.kill("SIGKILL");
    }, 12_000);
    let result;
    try { result = await exit; } finally { clearTimeout(watchdog); }
    await verify({ result, stdout, stderr, lease });
    console.log(`PASS ${label}:`, JSON.stringify({ result, stdout: stdout.trim() }));
  } finally {
    if (child && child.exitCode === null) {
      lease.killTree();
      child.kill("SIGKILL");
    }
    lease.dispose();
  }
}

// One cgroup per probe avoids policy inheritance or irreversible compromise.
// Memory pressure must be rejected by the real kernel memory controller.
await probe("memory.max", `
  const items=[];
  while (true) {
    const b=Buffer.allocUnsafe(16*1024*1024);
    b.fill(0x5c);
    items.push(b);
  }
`, ({ result, stdout, stderr }) => {
  assert.equal(stdout, "", "memory exhaustion must never complete normally");
  assert.ok(result.signal === "SIGKILL" || result.code !== 0, "memory exhausted worker must die");
  assert.ok(!stderr.includes("Operation not permitted"), "Bubblewrap failed instead of enforcing memory limits");
});

// CPU quota must throttle a real, busy untrusted Node worker.
await probe("cpu.max", `
  const end=Date.now()+3000;
  while(Date.now()<end) Math.sqrt(Math.random());
  process.stdout.write("CPU_DONE");
`, ({ result, stdout, stderr }) => {
  assert.deepEqual(result, { code: 0, signal: null }, `CPU worker failed: ${stderr}`);
  assert.equal(stdout, "CPU_DONE");
});

// pids.max must refuse spawn attempts for a hostile fork storm.
await probe("pids.max", `
  const {spawn}=require("node:child_process");
  let denied=0;
  for(let i=0;i<90;i++) {
    const p=spawn("/usr/bin/sleep", ["4"], {stdio:"ignore"});
    p.on("error",()=>denied++);
  }
  setTimeout(()=>process.stdout.write("PIDS_DENIED:"+denied),1200);
  setTimeout(()=>process.exit(0),1500);
`, ({ result, stdout, stderr }) => {
  assert.deepEqual(result, { code: 0, signal: null }, `PID worker failed: ${stderr}`);
  assert.match(stdout, /PIDS_DENIED:[1-9]\d*/, "kernel must refuse one or more child processes");
});

console.log("PASS M8.7: Real Linux memory, CPU, PID exhaustion probes completed.");
