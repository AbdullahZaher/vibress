import { open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import {
  assertPluginReplicaConsensus, type PluginReplicaReceipt,
} from "./replica-receipt-consistency";

const MAX_RECEIPT_BYTES = 256 * 1024;

/**
 * Offline, read-only multi-replica acceptance helper. Operators must collect
 * signed release admission receipts INDEPENDENTLY from each live image/mount.
 * This tool only compares them against externally configured trust pins.
 *
 * Usage: tsx scripts/plugins/check-replica-receipts.ts \
 *   api:api-a=/secure/api-a.json api:api-b=/secure/api-b.json \
 *   worker:worker-a=/secure/worker-a.json worker:worker-b=/secure/worker-b.json
 */
async function readReceipt(filename: string): Promise<unknown> {
  if (!path.isAbsolute(filename)) throw new Error("INVALID_RECEIPT_PATH");
  const file = await open(filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await file.stat();
    if (!stats.isFile() || stats.size > MAX_RECEIPT_BYTES) {
      throw new Error("INVALID_RECEIPT_FILE");
    }
    const bytes = await file.readFile();
    if (bytes.length > MAX_RECEIPT_BYTES) throw new Error("INVALID_RECEIPT_FILE");
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } finally {
    await file.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 4 || args.length > 128) throw new Error("INVALID_RECEIPT_ARGS");
  const expected = {
    lockfileSha256: process.env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256 ?? "",
    publicKeySha256: process.env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256 ?? "",
  };
  const inputs: PluginReplicaReceipt[] = [];
  for (const arg of args) {
    const match = /^(api|worker):([a-zA-Z0-9][a-zA-Z0-9_.-]{0,63})=(.+)$/.exec(arg);
    if (!match) throw new Error("INVALID_RECEIPT_ARGS");
    const role = match[1] === "api" ? "api" : "worker";
    inputs.push({
      role,
      replica: match[2] ?? "",
      receipt: await readReceipt(match[3] ?? ""),
    });
  }
  const consensus = assertPluginReplicaConsensus(inputs, expected);
  // No filesystem paths, secret keys, plugin payloads or tenant identifiers.
  process.stdout.write(JSON.stringify(consensus) + "\n");
}
void main().catch(() => {
  console.error("Plugin replica receipts disagree or are invalid; block rollout");
  process.exitCode = 1;
});
