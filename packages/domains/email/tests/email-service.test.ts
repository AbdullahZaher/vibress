import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { SmtpEmailProvider } from "../src/infrastructure/smtp/smtp-provider";
import {
  EmailService,
  ProviderEventRepository,
} from "../src/application/email-service";
import {
  EmailRecipientRepository,
  EmailEventRepository,
  EmailSuppressionRepository,
} from "../src/domain/recipient";

const WEBHOOK_SECRET = "whsec_email_contract";

function sign(payload: string): string {
  return `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
}

function makeEvent(payload: object): string {
  return JSON.stringify({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: "delivered",
    messageId: "msg_1",
    email: "a@example.com",
    timestamp: Math.floor(Date.now() / 1000),
    ...payload,
  });
}

describe("SmtpEmailProvider webhook contract", () => {
  const provider = new SmtpEmailProvider({
    host: "127.0.0.1",
    port: 1025,
    webhookSecret: WEBHOOK_SECRET,
  });

  it("verifies a valid signed payload", async () => {
    const payload = makeEvent({});
    expect(await provider.verifyWebhookSignature(payload, sign(payload))).toBe(
      true,
    );
  });

  it("verifies a valid signed Buffer payload (raw body)", async () => {
    const payload = makeEvent({});
    expect(
      await provider.verifyWebhookSignature(
        Buffer.from(payload),
        sign(payload),
      ),
    ).toBe(true);
  });

  it("rejects an invalid signature", async () => {
    const payload = makeEvent({});
    expect(await provider.verifyWebhookSignature(payload, "sha256=bogus")).toBe(
      false,
    );
  });

  it("rejects a missing signature header", async () => {
    const payload = makeEvent({});
    expect(await provider.verifyWebhookSignature(payload, null)).toBe(false);
  });

  it("normalizes event types to Vibress states", async () => {
    const providerWithEvent = new SmtpEmailProvider({
      host: "127.0.0.1",
      port: 1025,
      webhookSecret: WEBHOOK_SECRET,
    });
    const event = await providerWithEvent.parseWebhookEvent(
      makeEvent({ type: "bounce", detail: "hard bounce" }),
    );
    expect(event.type).toBe("bounced");
    expect(event.recipientEmail).toBe("a@example.com");
    expect(event.messageId).toBe("msg_1");
    expect(typeof event.timestamp).toBe("number");
  });

  it("rejects malformed events", async () => {
    const providerWithEvent = new SmtpEmailProvider({
      host: "127.0.0.1",
      port: 1025,
      webhookSecret: WEBHOOK_SECRET,
    });
    await expect(
      providerWithEvent.parseWebhookEvent('{"no":"id"}'),
    ).rejects.toMatchObject({ code: "INVALID_WEBHOOK_EVENT" });
  });
});

describe("EmailService suppression policy", () => {
  const recipientRepo: EmailRecipientRepository = {
    createMany: vi.fn(async () => 0),
    findPending: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    findByMessageId: vi.fn(async () => null),
    findByEmailAndSend: vi.fn(async () => null),
    markSent: vi.fn(),
    markFailed: vi.fn(async (id) => ({ id }) as any),
    markDelivered: vi.fn(),
    markOpened: vi.fn(),
    markClicked: vi.fn(),
    countByStatus: vi.fn(async () => ({})),
  };
  const eventRepo: EmailEventRepository = {
    record: vi.fn(async () => ({ id: "e" }) as any),
  };
  const suppressionRepo: EmailSuppressionRepository = {
    add: vi.fn(async () => undefined),
    isSuppressed: vi.fn(async () => false),
    findByEmail: vi.fn(async () => null),
    list: vi.fn(async () => ({ suppressions: [], total: 0 })),
    remove: vi.fn(async () => undefined),
  };
  const providerEventRepo: ProviderEventRepository = {
    create: vi.fn(async (d) => ({
      id: "pe",
      ...d,
      status: "received",
      attemptCount: 0,
      lastError: null,
      receivedAt: new Date(),
      processedAt: null,
    })),
    findByProviderEventId: vi.fn(async () => null),
    markProcessed: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  };
  const provider = new SmtpEmailProvider({
    host: "127.0.0.1",
    port: 1025,
    webhookSecret: WEBHOOK_SECRET,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeService(overrides: Record<string, unknown> = {}) {
    return new EmailService({
      provider,
      recipientRepo,
      eventRepo,
      suppressionRepo,
      providerEventRepo,
      ...overrides,
    } as any);
  }

  it("rejects an invalid webhook signature", async () => {
    const service = makeService();
    const res = await service.handleWebhook(
      "smtp",
      '{"id":"x"}',
      "sha256=bogus",
    );
    expect(res.status).toBe(400);
    expect(res.processed).toBe(false);
  });

  it("deduplicates provider events by event id", async () => {
    const existing = {
      id: "pe-1",
      provider: "smtp",
      providerEventId: "evt_dup",
      eventType: "delivered",
      status: "processed",
      attemptCount: 0,
      lastError: null,
      payloadHash: "h",
      receivedAt: new Date(),
      processedAt: new Date(),
    };
    const dedupRepo: ProviderEventRepository = {
      ...providerEventRepo,
      findByProviderEventId: vi.fn(async () => existing),
    };
    const service = makeService({ providerEventRepo: dedupRepo });
    const payload = makeEvent({ id: "evt_dup" });
    const res = await service.handleWebhook("smtp", payload, sign(payload));
    expect(res.status).toBe(200);
    expect(res.processed).toBe(false); // duplicate → not re-processed
    expect(dedupRepo.create).not.toHaveBeenCalled();
  });

  it("hard bounce marks recipient failed and adds a suppression", async () => {
    const recipient = {
      id: "r1",
      sendId: "s1",
      memberId: "m1",
      email: "bounce@example.com",
      name: null,
      status: "sent",
      providerMessageId: "msg_b1",
      unsubscribeToken: "t",
      attemptCount: 0,
      lastError: null,
      sentAt: new Date(),
      deliveredAt: null,
      openedAt: null,
      clickedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const recipientRepoWith: EmailRecipientRepository = {
      ...recipientRepo,
      findByMessageId: vi.fn(async () => recipient),
      markFailed: vi.fn(async (id, error) => ({
        ...recipient,
        status: "failed",
      })),
    };
    const service = makeService({ recipientRepo: recipientRepoWith });
    const payload = makeEvent({
      id: "evt_b1",
      type: "bounce",
      messageId: "msg_b1",
      email: "bounce@example.com",
      detail: "hard bounce",
    });
    const res = await service.handleWebhook("smtp", payload, sign(payload));
    expect(res.status).toBe(200);
    expect(suppressionRepo.add).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "bounce@example.com",
        reason: "hard_bounce",
      }),
    );
    expect(recipientRepoWith.markFailed).toHaveBeenCalled();
  });

  it("complaint adds a spam_complaint suppression", async () => {
    const recipient = {
      id: "r2",
      sendId: "s1",
      memberId: "m2",
      email: "c@example.com",
      name: null,
      status: "sent",
      providerMessageId: "msg_c1",
      unsubscribeToken: "t",
      attemptCount: 0,
      lastError: null,
      sentAt: new Date(),
      deliveredAt: null,
      openedAt: null,
      clickedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const recipientRepoWith: EmailRecipientRepository = {
      ...recipientRepo,
      findByMessageId: vi.fn(async () => recipient),
    };
    const service = makeService({ recipientRepo: recipientRepoWith });
    const payload = makeEvent({
      id: "evt_c1",
      type: "complaint",
      messageId: "msg_c1",
      email: "c@example.com",
    });
    const res = await service.handleWebhook("smtp", payload, sign(payload));
    expect(res.status).toBe(200);
    expect(suppressionRepo.add).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "c@example.com",
        reason: "spam_complaint",
      }),
    );
  });

  it("delivery does not suppress", async () => {
    const recipient = {
      id: "r3",
      sendId: "s1",
      memberId: "m3",
      email: "d@example.com",
      name: null,
      status: "sent",
      providerMessageId: "msg_d1",
      unsubscribeToken: "t",
      attemptCount: 0,
      lastError: null,
      sentAt: new Date(),
      deliveredAt: null,
      openedAt: null,
      clickedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const recipientRepoWith: EmailRecipientRepository = {
      ...recipientRepo,
      findByMessageId: vi.fn(async () => recipient),
    };
    const service = makeService({ recipientRepo: recipientRepoWith });
    const payload = makeEvent({
      id: "evt_d1",
      type: "delivered",
      messageId: "msg_d1",
    });
    const res = await service.handleWebhook("smtp", payload, sign(payload));
    expect(res.status).toBe(200);
    expect(suppressionRepo.add).not.toHaveBeenCalled();
  });

  it("unmatched events are recorded but do not crash", async () => {
    const service = makeService();
    const payload = makeEvent({
      id: "evt_unknown",
      type: "opened",
      messageId: "msg_nope",
    });
    const res = await service.handleWebhook("smtp", payload, sign(payload));
    expect(res.status).toBe(200);
  });
});
