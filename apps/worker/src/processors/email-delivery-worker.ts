import {
  Worker,
  Job,
  QUEUE_NAMES,
  EmailDeliveryJob,
  getBullMqRedisConnection,
} from "@vibress/queue";
import { tracedProcessor } from "./trace-helper";
import {
  DrizzleEmailRecipientRepository,
  DrizzleEmailEventRepository,
  DrizzleEmailSuppressionRepository,
  SmtpEmailProvider,
  EmailMessage,
} from "@vibress/email";
import {
  DrizzleNewsletterPreferenceRepository,
  DrizzleSendRepository,
  NewslettersService,
  MemberAudienceRepository,
  NewsletterSend,
} from "@vibress/newsletters";
import { getConfig } from "@vibress/config";

const MAX_ATTEMPTS_PER_RECIPIENT = 3;

class NoopAudienceRepository implements MemberAudienceRepository {
  async listAudienceMembers(): Promise<never[]> {
    return [];
  }
}

function getSmtpProvider(): SmtpEmailProvider {
  const { smtp } = getConfig();
  return new SmtpEmailProvider({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    user: smtp.user,
    pass: smtp.pass,
  });
}

const appConfig = getConfig();

export class EmailDeliveryWorker {
  private worker: Worker<EmailDeliveryJob> | null = null;
  private recipientRepo = new DrizzleEmailRecipientRepository();
  private eventRepo = new DrizzleEmailEventRepository();
  private suppressionRepo = new DrizzleEmailSuppressionRepository();
  private sendRepo = new DrizzleSendRepository();
  private newslettersService = new NewslettersService({
    newsletterRepo: undefined as never,
    preferenceRepo: new DrizzleNewsletterPreferenceRepository(),
    sendRepo: this.sendRepo,
    audienceRepo: new NoopAudienceRepository(),
    isMemberSuppressed: (email) => this.suppressionRepo.isSuppressed(email),
    unsubscribeSecret:
      appConfig.newsletters.unsubscribeSecret || "dev-unsub-secret",
    portalUrl: appConfig.site.portalUrl,
  });
  private provider = getSmtpProvider();

  async start(): Promise<void> {
    this.worker = new Worker<EmailDeliveryJob>(
      QUEUE_NAMES.EMAIL_DELIVERY,
      tracedProcessor("worker.job.email-delivery", (job) =>
        this.processJob(job),
      ),
      {
        connection: getBullMqRedisConnection(),
        concurrency: 4,
      },
    );

    this.worker.on("failed", (job, err) => {
      console.error(
        `[EmailWorker] Job ${job?.id} failed after retries:`,
        err.message,
      );
      this.markJobFailed(job).catch(() => undefined);
    });

    this.worker.on("completed", (job) => {
      console.log(`[EmailWorker] Job ${job.id} completed`);
    });
  }

  private async processJob(job: Job<EmailDeliveryJob>): Promise<void> {
    const { sendId, recipientIds } = job.data;
    if (!sendId || !Array.isArray(recipientIds) || recipientIds.length === 0) {
      return;
    }

    const send = await this.sendRepo.findById(sendId);
    if (
      !send ||
      send.status === "sent" ||
      send.status === "failed" ||
      send.status === "cancelled"
    ) {
      // Idempotent no-op: terminal sends are not re-delivered.
      return;
    }

    for (const recipientId of recipientIds) {
      await this.sendOne(sendId, recipientId, send);
    }

    // Update send counters from recipient statuses
    const counts = await this.recipientRepo.countByStatus(sendId);
    const sent = (counts.sent || 0) + (counts.delivered || 0);
    const failed = counts.failed || 0;
    await this.sendRepo.updateStatus(sendId, send.status, {
      sentRecipients: sent,
      failedRecipients: failed,
    });

    if (send.totalRecipients > 0 && sent + failed >= send.totalRecipients) {
      await this.newslettersService.completeSend(sendId);
    }
  }

  private async sendOne(
    sendId: string,
    recipientId: string,
    send: NewsletterSend,
  ): Promise<void> {
    const recipient = await this.recipientRepo.findById(recipientId);
    if (!recipient) return;
    // Idempotency: only pending recipients are sent.
    if (recipient.status !== "pending") return;
    if (recipient.attemptCount >= MAX_ATTEMPTS_PER_RECIPIENT) return;

    // Suppression policy check at delivery time (Email domain owns policy)
    if (await this.suppressionRepo.isSuppressed(recipient.email)) {
      await this.recipientRepo.markFailed(
        recipientId,
        "suppressed",
        recipient.attemptCount + 1,
      );
      return;
    }

    const { html, text } = this.newslettersService.renderEmailHtml(
      send,
      recipient.memberId || "",
      recipient.unsubscribeToken,
    );

    const message: EmailMessage = {
      to: recipient.email,
      toName: recipient.name,
      from: send.senderEmail,
      fromName: send.senderName,
      replyTo: send.replyTo,
      subject: send.subject,
      html,
      text,
      headers: { "X-Vibress-Send": sendId, "X-Vibress-Recipient": recipientId },
      metadata: { sendId, recipientId },
    };

    const result = await this.provider.send(message);
    await this.recipientRepo.markSent(
      recipientId,
      result.messageId,
      new Date(),
    );
    await this.eventRepo.record({
      recipientId,
      sendId,
      memberId: recipient.memberId,
      type: "email.sent",
      provider: this.provider.name,
      data: { messageId: result.messageId },
    });
  }

  private async markJobFailed(
    job: Job<EmailDeliveryJob> | undefined,
  ): Promise<void> {
    if (!job?.data?.recipientIds) return;
    for (const recipientId of job.data.recipientIds) {
      const recipient = await this.recipientRepo.findById(recipientId);
      if (recipient && recipient.status === "pending") {
        await this.recipientRepo.markFailed(
          recipientId,
          "delivery job failed after retries",
          recipient.attemptCount + 1,
        );
      }
    }
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}
