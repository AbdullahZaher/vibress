/**
 * M8 Linux Bubblewrap Node IPC transport feasibility probe.
 * Uses bounded newline-framed JSON/HMAC over stdio; does NOT authorize the
 * production Tier 2 runtime or replace the existing authenticated IPC.
 */
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readlinkSync, existsSync } from "node:fs";

if (process.platform !== "linux" || !existsSync("/usr/bin/bwrap")) {
  console.error("M8 IPC acceptance BLOCKED: Bubblewrap on Linux is required.");
  process.exitCode = 1;
} else {
  const key = randomBytes(32).toString("hex");
  const body = { id: randomUUID(), op: "echo", value: "bounded-sandbox-stdio" };
  const sign = (value) => createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
  const worker = String.raw`
const { createHmac } = require("node:crypto");
const { readlinkSync } = require("node:fs");
const readline = require("node:readline");
const key = process.env.VIBRESS_TEST_CHANNEL_KEY;
let count = 0;
const sign = (body) => createHmac("sha256", key).update(JSON.stringify(body)).digest("hex");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (++count > 1 || line.length > 65536) process.exit(2);
  try {
    const request = JSON.parse(line);
    if (request.mac !== sign(request.body)) process.exit(3);
    if (request.body.op !== "echo") process.exit(4);
    const body = {
      id: request.body.id,
      echoed: request.body.value,
      netNamespace: readlinkSync("/proc/self/ns/net"),
    };
    process.stdout.write(JSON.stringify({ body, mac: sign(body) }) + "\\n");
  } catch {
    process.exit(5);
  }
});
`;

  const args = [
    "--unshare-all", "--unshare-net", "--new-session", "--die-with-parent",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind-try", "/lib", "/lib",
    "--ro-bind-try", "/lib64", "/lib64",
    "--ro-bind-try", "/bin", "/bin",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--dir", "/sandbox", "--ro-bind", process.execPath, "/sandbox/node",
    "--chdir", "/tmp",
    "--clearenv", "--setenv", "VIBRESS_TEST_CHANNEL_KEY", key,
    "/sandbox/node", "-e", worker,
  ];

  const child = spawn("/usr/bin/bwrap", args, {
    env: { PATH: "/usr/bin:/bin" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let overflow = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.length > 65536) { overflow = true; child.kill("SIGKILL"); }
  });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4096); });
  const hostNetworkNamespace = readlinkSync("/proc/self/ns/net");

  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Sandbox Node IPC transport timed out"));
    }, 10000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || overflow) reject(new Error(`Sandbox child exit ${code}: ${stderr}`));
      else resolve();
    });
  });
  child.stdin.end(JSON.stringify({ body, mac: sign(body) }) + "\n");
  try {
    await result;
    const lines = stdout.trim().split("\n");
    if (lines.length !== 1) throw new Error("Expected exactly one bounded IPC response");
    const reply = JSON.parse(lines[0]);
    if (reply.mac !== sign(reply.body) ||
        reply.body.id !== body.id ||
        reply.body.echoed !== body.value ||
        reply.body.netNamespace === hostNetworkNamespace) {
      throw new Error("Sandbox IPC response authentication or namespace check failed");
    }
    console.log("M8 Bubblewrap Node stdio IPC feasibility probe PASSED");
    console.log("This is NOT the production Tier 2 IPC adapter or an authorization to enable Marketplace.");
  } catch (error) {
    console.error("M8 IPC acceptance FAILED:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
