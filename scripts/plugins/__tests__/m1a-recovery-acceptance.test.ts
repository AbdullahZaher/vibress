import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve(process.cwd(), "scripts/plugins/run-m1a-recovery-acceptance.sh");
const receiptArgs = [
  "api:api-a=/isolated/api-a.json", "api:api-b=/isolated/api-b.json",
  "worker:worker-a=/isolated/worker-a.json", "worker:worker-b=/isolated/worker-b.json",
];
const safeEnv = {
  VIBRESS_PLUGIN_RECOVERY_MAINTENANCE: "1",
  VIBRESS_PLUGIN_SECRET_ROTATION_MAINTENANCE: "1",
  VIBRESS_PLUGIN_DRILL_ISOLATED_CLONE_ACK: "1",
  VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY: "strict",
  VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE: "1",
  VIBRESS_TRUSTED_PLUGIN_LOCKFILE: "/isolated/trusted.json",
  VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256: "a".repeat(64),
  VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256: "b".repeat(64),
  VIBRESS_PLUGIN_SECRET_ACTIVE_KEY_ID: "rotation_1",
  VIBRESS_PLUGIN_SECRET_KEYS_JSON: JSON.stringify({ rotation_1: "c".repeat(64) }),
};
describe("M1A operator-only isolated recovery acceptance orchestration", () => {
  let dir: string;
  let trace: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vibress-plugin-drill-"));
    trace = join(dir, "trace");
    // Explicit mock PATH: never invoke any real DB/Redis/restore command.
    const stub = join(dir, "pnpm");
    writeFileSync(stub, `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_TRACE"
case "$*" in
  *"$FAIL_ON"*) [ -z "$FAIL_ON" ] || exit 1 ;;
esac
exit 0
`);
    chmodSync(stub, 0o700);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function run(
    overrides: Record<string, string> = {},
    args = receiptArgs,
  ) {
    const env = {
      ...process.env, ...safeEnv, ...overrides, PATH: `${dir}:${process.env.PATH ?? ""}`,
      FAKE_TRACE: trace,
      FAIL_ON: overrides.FAIL_ON ?? "",
    };
    return spawnSync("bash", [script, ...args], {
      cwd: process.cwd(), env, encoding: "utf8", timeout: 10_000,
    });
  }
  function traceLines(): string[] {
    try { return readFileSync(trace, "utf8").trim().split("\n"); }
    catch { return []; }
  }

  it("runs all existing read-only gates once in fixed order with four receipts", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("READ_ONLY_CHECKS_PASSED");
    expect(traceLines()).toEqual([
      "exec tsx scripts/plugins/check-restore.ts",
      "exec tsx scripts/plugins/check-queue-recovery.ts",
      "exec tsx scripts/plugins/rotate-secrets.ts",
      `exec tsx scripts/plugins/check-replica-receipts.ts ${receiptArgs.join(" ")}`,
      "exec tsx scripts/plugins/check-receipt-health.ts",
    ]);
    expect(r.stdout).not.toContain(safeEnv.VIBRESS_PLUGIN_SECRET_KEYS_JSON);
  });

  it("refuses missing clone acknowledgment, strict signer or keyring before any check", () => {
    for (const overrides of [
      { VIBRESS_PLUGIN_DRILL_ISOLATED_CLONE_ACK: "0" },
      { VIBRESS_PLUGIN_RECOVERY_MAINTENANCE: "0" },
      { VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY: "legacy" },
      { VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE: "0" },
      { VIBRESS_PLUGIN_SECRET_KEYS_JSON: "" },
    ]) {
      const r = run(overrides);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("PLUGIN_M1A_ACCEPTANCE_BLOCKED");
      expect(traceLines()).toEqual([]);
    }
  });

  it("never passes untrusted receipt flags or relative paths to a child", () => {
    for (const bad of [
      ["api:api-a=relative.json", ...receiptArgs.slice(1)],
      ["--apply", ...receiptArgs],
      receiptArgs.slice(0, 3),
    ]) {
      const r = run({}, bad);
      expect(r.status).not.toBe(0);
      expect(traceLines()).toEqual([]);
    }
  });

  it("stops at the first failed prerequisite without running later checks", () => {
    const r = run({ FAIL_ON: "check-queue-recovery.ts" });
    expect(r.status).not.toBe(0);
    expect(traceLines()).toEqual([
      "exec tsx scripts/plugins/check-restore.ts",
      "exec tsx scripts/plugins/check-queue-recovery.ts",
    ]);
    expect(r.stdout).not.toContain("READ_ONLY_CHECKS_PASSED");
    expect(r.stderr).not.toContain(safeEnv.VIBRESS_PLUGIN_SECRET_KEYS_JSON);
  });
});
