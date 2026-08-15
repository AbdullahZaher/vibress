import {
  Queue,
  Worker,
  QUEUE_NAMES,
  enqueueTraced,
  getBullMqRedisConnection,
} from "@vibress/queue";
import {
  AutomationsService,
  DrizzleAutomationRepository,
  AutomationAction,
} from "@vibress/automations";
import { tracedProcessor } from "./trace-helper";

export interface AutomationRunJob {
  runId: string;
  traceparent?: string;
}

export interface AutomationDelayedStepJob {
  runId: string;
  stepIndex: number;
  resumeAt: number;
  traceparent?: string;
}

const AUTOMATIONS_QUEUE_NAME = QUEUE_NAMES.AUTOMATIONS_RUN;

/**
 * Automation runner: executes run steps sequentially. Wait steps persist
 * run state ('waiting') and schedule a delayed queue job to resume —
 * durable across API/Worker restarts. No in-memory timers.
 */
export class AutomationRunnerWorker {
  private worker: Worker<AutomationRunJob> | null = null;
  private delayedWorker: Worker<AutomationDelayedStepJob> | null = null;
  private runQueue: Queue<AutomationRunJob> | null = null;
  private delayedQueue: Queue<AutomationDelayedStepJob> | null = null;
  private automationsService: AutomationsService;

  constructor(executor: {
    execute(
      action: AutomationAction,
      context: {
        runId: string;
        stepIndex: number;
        memberId?: string | null;
        eventPayload: Record<string, unknown> | null;
      },
    ): Promise<{ result: Record<string, unknown> }>;
  }) {
    const repo = new DrizzleAutomationRepository();
    const connection = getBullMqRedisConnection();
    this.runQueue = new Queue<AutomationRunJob>(AUTOMATIONS_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 2000,
      },
    });
    this.delayedQueue = new Queue<AutomationDelayedStepJob>(
      QUEUE_NAMES.AUTOMATIONS_DELAYED,
      {
        connection,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 2000,
        },
      },
    );
    this.automationsService = new AutomationsService(
      repo,
      {
        enqueueRun: (runId) => this.enqueueRun(runId),
        enqueueDelayedStep: (runId, stepIndex, delayMs) =>
          this.enqueueDelayed(runId, stepIndex, delayMs),
      },
      executor,
    );
  }

  async enqueueRun(runId: string): Promise<void> {
    await enqueueTraced(
      this.runQueue!,
      "run",
      { runId },
      { jobId: `run-${runId}` },
    );
  }

  private async enqueueDelayed(
    runId: string,
    stepIndex: number,
    delayMs: number,
  ): Promise<void> {
    await enqueueTraced(
      this.delayedQueue!,
      "resume",
      { runId, stepIndex, resumeAt: Date.now() + delayMs },
      {
        delay: delayMs,
        jobId: `resume-${runId}-${stepIndex}`,
      },
    );
  }

  async start(): Promise<void> {
    // Standard BullMQ Worker accepts a single queue name — use one per queue.
    this.worker = new Worker<AutomationRunJob>(
      AUTOMATIONS_QUEUE_NAME,
      tracedProcessor("worker.job.automation-run", async (job) => {
        await this.automationsService.executeRun(job.data.runId);
      }),
      { connection: getBullMqRedisConnection(), concurrency: 2 },
    );

    this.delayedWorker = new Worker<AutomationDelayedStepJob>(
      QUEUE_NAMES.AUTOMATIONS_DELAYED,
      tracedProcessor("worker.job.automation-resume", async (job) => {
        await this.automationsService.resumeRun(job.data.runId);
      }),
      { connection: getBullMqRedisConnection(), concurrency: 2 },
    );

    this.worker.on("failed", (job, err) => {
      console.error(`[AutomationRunner] Job ${job?.id} failed:`, err.message);
    });
    this.delayedWorker.on("failed", (job, err) => {
      console.error(
        `[AutomationRunner] Delayed job ${job?.id} failed:`,
        err.message,
      );
    });
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.delayedWorker) {
      await this.delayedWorker.close();
      this.delayedWorker = null;
    }
    if (this.runQueue) await this.runQueue.close();
    if (this.delayedQueue) await this.delayedQueue.close();
    this.runQueue = null;
    this.delayedQueue = null;
  }
}

export { AUTOMATIONS_QUEUE_NAME };
