import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// The ESM build pulls cron-parser through an incompatible export shape under
// this runtime; the CJS entry point is the supported package surface here.
const { Queue, Worker } = require("../../../packages/queue/node_modules/bullmq/dist/cjs/index.js") as {
  Queue: new (name: string, opts: unknown) => any;
  Worker: new (name: string, processor: (job: any) => Promise<unknown>, opts: unknown) => any;
};
type ConnectionOptions = Record<string, unknown>;
import {
  createWorkerEnvelope,
  verifyWorkerEnvelope,
  type WorkerEnvelopeInput,
} from "../../../packages/tenancy/src/worker-envelope.ts";

const EFFECTS_FILE = "/tmp/m02-bullmq-effects.log";
const NONCES_FILE = "/tmp/m02-bullmq-nonces.json";
const SECRET_A = "installation-a-key";
const SECRET_B = "installation-b-key";
const PORT_A = Number(process.env.M02_REDIS_A_PORT ?? 16390);
const PORT_B = Number(process.env.M02_REDIS_B_PORT ?? 16391);

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}
const results: Result[] = [];
function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}

function loadNonces(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(NONCES_FILE, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}
function saveNonces(nonces: Set<string>) {
  fs.writeFileSync(NONCES_FILE, JSON.stringify([...nonces]));
}
function appendEffect(value: string) {
  fs.appendFileSync(EFFECTS_FILE, `${value}\n`);
}
function effects(): string[] {
  try {
    return fs.readFileSync(EFFECTS_FILE, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
function connection(port: number, password: string): ConnectionOptions {
  return { host: "127.0.0.1", port, password, maxRetriesPerRequest: null };
}
function input(nonce: string, overrides: Partial<WorkerEnvelopeInput> = {}): WorkerEnvelopeInput {
  return {
    applicationId: "crm-app",
    installationId: "install-a",
    tenantId: "tenant-a",
    principalId: "principal-1",
    jobType: "deal.approve",
    schemaRevision: "rev-1",
    nonce,
    issuedAt: Math.floor(Date.now() / 1000),
    payload: { dealId: `deal-${nonce}` },
    ...overrides,
  };
}

async function main() {
  fs.rmSync(EFFECTS_FILE, { force: true });
  fs.rmSync(NONCES_FILE, { force: true });
  saveNonces(new Set());
  const queueA = new Queue("install-a-jobs", { connection: connection(PORT_A, "secret-a") });
  const queueB = new Queue("install-b-jobs", { connection: connection(PORT_B, "secret-b") });
  const seen = loadNonces();

  async function processor(job: any) {
    const envelope = job.data as ReturnType<typeof createWorkerEnvelope>;
    const receivedNonces = loadNonces();
    if (receivedNonces.has(envelope.nonce)) {
      throw new Error("REPLAY");
    }
    verifyWorkerEnvelope(envelope, {
      secret: SECRET_A,
      expectedApplicationId: "crm-app",
      expectedInstallationId: "install-a",
      now: Math.floor(Date.now() / 1000),
      maxAgeSeconds: 600,
      revokedPrincipalIds: new Set(["revoked-principal"]),
      seenNonces: receivedNonces,
    });
    receivedNonces.add(envelope.nonce);
    saveNonces(receivedNonces);
    appendEffect(`applied:${envelope.nonce}`);
    return { applied: envelope.nonce };
  }

  const workerA = new Worker("install-a-jobs", processor, {
    connection: connection(PORT_A, "secret-a"),
    concurrency: 4,
  });
  workerA.on("failed", (job, error) => {
    console.log(`JOB_FAILURE ${job?.id ?? "unknown"}: ${error?.message ?? String(error)}`);
  });
  await workerA.waitUntilReady();

  const addAndWait = async (
    queue: any,
    name: string,
    data: unknown,
    opts: Record<string, unknown> = {},
    timeoutMs = 8000,
  ): Promise<boolean> => {
    const settled = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false, true), timeoutMs);
      const finish = (value: boolean, timedOut = false) => {
        if (!timedOut) clearTimeout(timer);
        workerA.off("completed", onCompleted);
        workerA.off("failed", onFailed);
        resolve(value);
      };
      const onCompleted = () => finish(true);
      const onFailed = () => finish(false);
      workerA.on("completed", onCompleted);
      workerA.on("failed", onFailed);
    });
    await queue.add(name, data, opts);
    return settled;
  };

  try {
    record(
      "A processes its own authorized job",
      await addAndWait(queueA, "approve", createWorkerEnvelope(input("n1"), SECRET_A), {
        jobId: "job-n1",
      }),
    );

    const forged = createWorkerEnvelope(input("n2"), SECRET_A);
    record(
      "A rejects modified HMAC payload",
      (await addAndWait(queueA, "approve", { ...forged, payload: { dealId: "tampered" } }, {
        jobId: "job-n2",
      })) === false,
    );

    const wrongInstall = createWorkerEnvelope(input("n3", { installationId: "install-b" }), SECRET_B);
    record(
      "A rejects wrong installation envelope",
      (await addAndWait(queueA, "approve", wrongInstall, { jobId: "job-n3" })) === false,
    );

    const revoked = createWorkerEnvelope(
      input("n4", { principalId: "revoked-principal" }),
      SECRET_A,
    );
    record(
      "A rejects revoked worker principal",
      (await addAndWait(queueA, "approve", revoked, { jobId: "job-n4" })) === false,
    );

    record(
      "A rejects replayed envelope",
      (await addAndWait(queueA, "approve", createWorkerEnvelope(input("n1"), SECRET_A), {
        jobId: "job-n1-replay",
      })) === false,
    );

    record(
      "delayed job preserves binding",
      await addAndWait(
        queueA,
        "approve",
        createWorkerEnvelope(input("n5"), SECRET_A),
        { jobId: "job-n5", delay: 300 },
        12000,
      ),
    );

    const uniqueEffects = new Set(effects());
    record("protected side effect applied exactly once per nonce", uniqueEffects.size === effects().length && effects().length === 2, effects().join(","));
    record("replay set persisted across processor invocations", loadNonces().has("n1") && loadNonces().has("n5"));

    const bConnection = {
      ...connection(PORT_A, "wrong-b-credential"),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    };
    const crossQueue = new Queue("install-a-jobs", { connection: bConnection });
    let crossDenied = false;
    try {
      await crossQueue.add("approve", createWorkerEnvelope(input("n6"), SECRET_A), {
        jobId: "job-cross",
      });
    } catch {
      crossDenied = true;
    }
    record("B credentials cannot access A queue", crossDenied);
    await crossQueue.close();
    await queueB.close();
  } finally {
    await workerA.close();
    await queueA.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nBullMQ installation drill: ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length}/${results.length})`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
