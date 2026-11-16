/**
 * W1-T06: run the real @vibress/queue BullMQ Queue/Worker integration in
 * short-lived Node processes with distinct Redis ACL credentials.
 *
 * The Python orchestrator supplies only disposable operator-generated env.
 * No credentials, signed URLs, payload data, or stack traces are emitted.
 * This is NOT the full domain-specific Worker main.ts entrypoint.
 */
import { createQueue, createWorker, assertJobScope, QUEUE_NAMES,
  getQueueIsolationOptions } from "@vibress/queue";
import { closeRedisClient } from "@vibress/cache";
import { WebhookDeliveryWorker } from "../../../apps/worker/src/processors/webhook-delivery-worker";
import type { Worker } from "@vibress/queue";

type TestData = {
  scope: "publication";
  publicationId: string;
  installationId: string;
  kind: "normal" | "retry" | "poison";
  deliveryId: string;
  endpointId: string;
};
const mode = process.argv[2];
const installation = process.env.VIBRESS_INSTALLATION_ID || "";
const id = process.env.T06_JOB_ID || "";
const kind = process.env.T06_JOB_KIND || "normal";
const prefix = getQueueIsolationOptions().prefix;
const queueName = QUEUE_NAMES.WEBHOOK_DELIVERY;
const result = (status: string, extra: Record<string, unknown> = {}) =>
  process.stdout.write(JSON.stringify({ status, ...extra }) + "\n");

async function execute(): Promise<void> {
  if (!prefix || !installation || !id || !process.env.REDIS_URL ||
      process.env.VIBRESS_REQUIRE_INSTALLATION_ISOLATION !== "1") {
    throw new Error("Isolated worker process config required");
  }

  // Exercise the concrete Vibress WebhookDeliveryWorker startup and event
  // processing path, replacing only its external webhook delivery side effect
  // with a sentinel. No mail/HTTP delivery, PG writes or production secrets.
  if (mode === "domain-worker") {
    const domain = new WebhookDeliveryWorker();
    let delivered = 0;
    const replacement = domain as unknown as {
      webhooksService: { deliver: (deliveryId: string) => Promise<void> };
      worker: Worker<TestData> | null;
    };
    replacement.webhooksService = {
      deliver: async (deliveryId: string) => {
        if (deliveryId !== id) throw new Error("unmatched delivery identity");
        delivered += 1;
      },
    };
    await domain.start();
    try {
      const internal = replacement.worker;
      if (!internal) throw new Error("domain worker did not start");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("domain worker timeout")), 12000);
        internal.on("completed", job => {
          if (job.id === id) {
            clearTimeout(timer);
            resolve();
          }
        });
        internal.on("error", () => { /* do not log sensitive errors */ });
      });
      if (delivered !== 1) throw new Error("incorrect domain Worker side effects");
      result("DOMAIN_CONSUMED", { deliveries: delivered });
    } finally {
      await domain.stop();
    }
    return;
  }

  if (mode === "worker-denied") {
    const worker = createWorker<TestData>(queueName, async () => {
      throw new Error("unauthorized worker executed a job");
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("missing ACL denial")), 7000);
        worker.on("error", (error: Error) => {
          if (/NOPERM|permission denied/i.test(error.message)) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      result("WORKER_NOPERM");
    } finally {
      await worker.close(true);
    }
    return;
  }

  const queue = createQueue<TestData>(queueName, {
    attempts: kind === "retry" ? 2 : 1,
    backoff: { type: "fixed", delay: 100 },
    removeOnComplete: false,
    removeOnFail: false,
  });
  try {
    if (mode === "producer" || mode === "producer-denied") {
      const data: TestData = {
        scope: "publication",
        publicationId: "isolated-pub",
        installationId: kind === "poison" ? "foreign-installation" : installation,
        kind: kind === "retry" || kind === "poison" ? kind : "normal",
        deliveryId: id,
        endpointId: "isolated-test-endpoint",
      };
      try {
        const job = await queue.add("deliver", data, { jobId: id });
        if (mode === "producer-denied") {
          throw new Error("cross-installation enqueue unexpectedly allowed");
        }
        if (job.id !== id) throw new Error("unexpected job id");
        result("ENQUEUED", { jobId: job.id });
      } catch (error) {
        if (mode === "producer-denied" &&
            /NOPERM|permission denied/i.test((error as Error).message)) {
          result("ENQUEUE_NOPERM");
          return;
        }
        const message = error instanceof Error ? error.message : "";
        // Classify only known Redis errors; never emit the original message.
        if (/NOPERM|ACL failure in script|permission denied/i.test(message)) {
          const cause = /\bchannel\b/i.test(message) ? "ACL_CHANNEL" :
            /no permissions? to access a key|\bkey\b/i.test(message) ? "ACL_KEY" :
            /command or subcommand|has no permissions? to run|\bcommand\b/i.test(message) ? "ACL_COMMAND" :
            /ACL failure in script|\bscript\b/i.test(message) ? "ACL_SCRIPT" :
            "ACL_OTHER";
          throw new Error(cause);
        }
        if (/NOAUTH|WRONGPASS|invalid username-password/i.test(message)) {
          throw new Error("REDIS_AUTH_FAILURE");
        }
        if (/queue|job|lock|script|eval/i.test(message)) {
          throw new Error("QUEUE_SCRIPT_FAILURE");
        }
        throw new Error("producer job operation failed");
      }
      return;
    }

    if (mode === "inspect" || mode === "inspect-denied") {
      try {
        const job = await queue.getJob(id);
        if (!job) throw new Error("job missing");
        const state = await job.getState();
        if (mode === "inspect-denied") {
          throw new Error("foreign queue inspection unexpectedly allowed");
        }
        result("INSPECTED", {
          state, attemptsMade: job.attemptsMade,
          jobId: job.id,
        });
      } catch (error) {
        if (mode === "inspect-denied" &&
            /NOPERM|permission denied/i.test((error as Error).message)) {
          result("INSPECT_NOPERM");
          return;
        }
        throw new Error("queue inspection failed");
      }
      return;
    }

    if (mode === "worker") {
      let sideEffects = 0;
      let times = 0;
      const worker = createWorker<TestData>(queueName, async (job) => {
        // The production workers' assertJobScope is used, rather than a
        // synthetic Redis key parser. Domain admission is still independently
        // unverified (see W1-T06 report).
        assertJobScope(job.data);
        if (job.data.installationId !== installation) {
          throw new Error("INSTALLATION_JOB_SCOPE_DENIED");
        }
        times += 1;
        if (job.data.kind === "poison") {
          throw new Error("POISON_JOB_DENIED");
        }
        if (job.data.kind === "retry" && times === 1) {
          throw new Error("TRANSIENT_RETRY");
        }
        sideEffects += 1;
      }, { concurrency: 1 });
      try {
        const outcome = await new Promise<"completed" | "failed">((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("worker timeout")), 12000);
          worker.on("completed", job => {
            if (job.id === id) {
              clearTimeout(timer);
              resolve("completed");
            }
          });
          worker.on("failed", job => {
            if (job?.id === id &&
                (kind === "poison" || job.attemptsMade >= 2)) {
              clearTimeout(timer);
              resolve("failed");
            }
          });
          worker.on("error", () => {
            // Sensitive Redis error strings deliberately not logged.
          });
        });
        if (kind === "poison") {
          if (outcome !== "failed" || sideEffects !== 0) {
            throw new Error("poison job was not isolated");
          }
          result("POISON_BLOCKED", { sideEffects });
        } else {
          if (outcome !== "completed" || sideEffects !== 1 ||
              (kind === "retry" && times !== 2)) {
            throw new Error("worker execution did not meet expectations");
          }
          result("CONSUMED", { sideEffects, attempts: times });
        }
      } finally {
        await worker.close(true);
      }
      return;
    }

    throw new Error("unknown test mode");
  } finally {
    await queue.close();
  }
}

execute().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : "";
  const category =
    /ACL_CHANNEL/.test(msg) ? "ACL_CHANNEL" :
    /ACL_KEY/.test(msg) ? "ACL_KEY" :
    /ACL_COMMAND/.test(msg) ? "ACL_COMMAND" :
    /ACL_SCRIPT/.test(msg) ? "ACL_SCRIPT" :
    /ACL_OTHER/.test(msg) ? "ACL_OTHER" :
    /module not found|cannot find module|ERR_MODULE_NOT_FOUND/i.test(msg) ? "MODULE_RESOLUTION" :
    /NOAUTH|WRONGPASS|invalid username-password/i.test(msg) ? "REDIS_AUTH" :
    /NOPERM|permission denied/i.test(msg) ? "ACL_DENIAL" :
    /connect|ECONNREFUSED|timeout/i.test(msg) ? "CONNECTION" :
    /unexpected|missing|did not|failed/i.test(msg) ? "ASSERTION" :
    "UNKNOWN";
  // Controlled error category only; raw errors may contain credentials.
  result("FAILED", { category });
  process.exitCode = 2;
}).finally(() => closeRedisClient().catch(() => {
  process.exitCode = 2;
}));
