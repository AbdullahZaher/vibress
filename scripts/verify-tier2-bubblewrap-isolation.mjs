/**
 * M8 Linux kernel-isolation acceptance probe.
 * Validates a standalone Bubblewrap namespace boundary, NOT Tier 2 IPC,
 * admission, cgroup resource quotas or production authorization.
 * Unsupported environments fail (never silently skip).
 */
import { execFile, execFileSync } from "node:child_process";
import { createServer, createConnection } from "node:net";
import { chmodSync, existsSync, mkdtempSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PYTHON = "/usr/bin/python3";
const bwrapCandidates = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"];
const bwrap = bwrapCandidates.find((item) => {
  try {
    const st = statSync(item);
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
});

if (process.platform !== "linux" || !bwrap || !existsSync(PYTHON)) {
  console.error("M8 kernel acceptance BLOCKED: Linux, executable Bubblewrap and /usr/bin/python3 are required.");
  process.exitCode = 1;
} else {
  const secretDir = mkdtempSync(join(tmpdir(), "vibress-tier2-host-only-"));
  const secretPath = join(secretDir, "host-secret.txt");
  const secretValue = "SENSITIVE_HOST_ONLY_VALUE_DO_NOT_READ";
  writeFileSync(secretPath, secretValue, { mode: 0o600 });
  chmodSync(secretDir, 0o700);

  const server = createServer((socket) => {
    // The positive-control client may disconnect after connect: avoid an
    // unhandled ECONNRESET on the server-side fixture socket.
    socket.on("error", () => {});
    socket.end("HOST_NETWORK_REACHABLE");
  });
  try {
    execFileSync(bwrap, ["--version"], { timeout: 2000, stdio: "ignore" });
    const hostNetNamespace = readlinkSync("/proc/self/ns/net");
    const hostPidNamespace = readlinkSync("/proc/self/ns/pid");
    const hostMountNamespace = readlinkSync("/proc/self/ns/mnt");
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Cannot establish host network fixture");
    const port = address.port;

    // Positive control: the address is reachable from the Host.
    await new Promise((resolve, reject) => {
      const client = createConnection({ host: "127.0.0.1", port });
      client.setTimeout(2000, () => { client.destroy(); reject(new Error("Host positive control timed out")); });
      client.once("connect", () => { client.destroy(); resolve(); });
      client.once("error", reject);
    });

    const pythonProbe = String.raw`
import json, os, socket, sys
secret_path = sys.argv[1]
port = int(sys.argv[2])
connected = False
try:
    with socket.create_connection(('127.0.0.1', port), timeout=1):
        connected = True
except OSError:
    pass
print(json.dumps({
  'hostSecretReadable': os.access(secret_path, os.R_OK),
  'hostSecretVisible': os.path.exists(secret_path),
  'hostEnvValue': os.environ.get('VIBRESS_HOST_ONLY_TEST_SECRET'),
  'connectedToHostLoopback': connected,
  'netNamespace': os.readlink('/proc/self/ns/net'),
  'pidNamespace': os.readlink('/proc/self/ns/pid'),
  'mountNamespace': os.readlink('/proc/self/ns/mnt'),
}))`;

    const args = [
      "--unshare-all", "--unshare-net", "--new-session", "--die-with-parent",
      "--ro-bind", "/usr", "/usr",
      "--ro-bind-try", "/lib", "/lib",
      "--ro-bind-try", "/lib64", "/lib64",
      "--ro-bind-try", "/bin", "/bin",
      "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
      "--dir", "/home", "--chdir", "/tmp",
      "--clearenv", "--setenv", "PATH", "/usr/bin:/bin",
      PYTHON, "-c", pythonProbe, secretPath, String(port),
    ];
    const { stdout, stderr } = await exec(bwrap, args, {
      timeout: 12000,
      maxBuffer: 64 * 1024,
      env: { PATH: "/usr/bin:/bin", VIBRESS_HOST_ONLY_TEST_SECRET: secretValue },
    });
    if (stderr.trim()) console.error("Bubblewrap stderr:", stderr.trim().slice(0, 300));
    const evidence = JSON.parse(stdout.trim());
    const assert = (condition, message) => {
      if (!condition) throw new Error("M8 isolation failure: " + message);
    };
    assert(evidence.hostSecretReadable === false, "Host secret file remained readable");
    assert(evidence.hostSecretVisible === false, "Host secret file was visible");
    assert(evidence.hostEnvValue === null, "Host secret environment variable propagated");
    assert(evidence.connectedToHostLoopback === false, "Host loopback server reachable from sandbox");
    assert(evidence.netNamespace !== hostNetNamespace, "Network namespace shared with Host");
    assert(evidence.pidNamespace !== hostPidNamespace, "PID namespace shared with Host");
    assert(evidence.mountNamespace !== hostMountNamespace, "Mount namespace shared with Host");
    console.log("M8 Linux Bubblewrap kernel isolation probe PASSED");
    console.log(JSON.stringify({
      hostFileIsolated: true,
      hostEnvironmentIsolated: true,
      hostNetworkIsolated: true,
      pidNamespaceIsolated: true,
      mountNamespaceIsolated: true,
      note: "Does NOT certify runtime IPC, CPU/memory/PID quotas, artifact integrity or marketplace execution.",
    }));
  } catch (error) {
    console.error("M8 kernel acceptance FAILED:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    rmSync(secretDir, { recursive: true, force: true });
  }
}
