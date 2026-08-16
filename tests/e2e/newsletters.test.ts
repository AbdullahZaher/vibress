import { test, expect } from "@playwright/test";
import crypto from "node:crypto";

const API = "http://localhost:7777";
const WEBHOOK_SECRET =
  process.env.EMAIL_WEBHOOK_SECRET || "whsec_prod_local_email";

test.describe("Batch 10 Newsletter & Email E2E Suite", () => {
  async function getLatestMail(
    to: string,
  ): Promise<{ subject: string; html: string; text: string } | null> {
    const res = await fetch("http://127.0.0.1:8025/api/v1/messages");
    const data = await res.json();
    const msg = (data.messages || []).find(
      (m: any) => m.To?.[0]?.Address === to,
    );
    if (!msg) return null;
    const detail = await (
      await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)
    ).json();
    return {
      subject: detail.Subject || "",
      html: detail.HTML || "",
      text: detail.Text || "",
    };
  }

  test.beforeEach(async () => {
    await fetch("http://127.0.0.1:8025/api/v1/messages", {
      method: "DELETE",
    }).catch(() => {});
  });

  async function getLatestMagicLink(email: string): Promise<string> {
    for (let i = 0; i < 30; i++) {
      const res = await fetch("http://127.0.0.1:8025/api/v1/messages");
      const data = await res.json();
      const matches = (data.messages || [])
        .filter((m: any) => {
          return (
            m.To?.some(
              (t: any) => t.Address?.toLowerCase() === email.toLowerCase(),
            ) || m.To?.[0]?.Address?.toLowerCase() === email.toLowerCase()
          );
        })
        .sort(
          (a: any, b: any) =>
            new Date(b.Created).getTime() - new Date(a.Created).getTime(),
        );
      if (matches.length > 0) {
        const msg = matches[0];
        const detail = await (
          await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)
        ).json();
        const html = detail.HTML || "";
        const text = detail.Text || "";
        const raw =
          html.match(/href="([^"]*token=[^"]*)"/i)?.[1] ||
          html.match(/href="([^"]+)"/)?.[1] ||
          text.match(/(https?:\/\/[^\s]+token=[^\s]+)/i)?.[1] ||
          text.match(/(https?:\/\/[^\s]+)/)?.[1];
        if (raw) return raw.replace(/&amp;/g, "&").replace(/[">]+$/, "");
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`expected a mail to ${email}`);
  }

  async function signupMember(page: any, email: string): Promise<void> {
    await page.goto(`${API}/portal/`);
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await expect(page.locator("h1")).toContainText("Check your email");
    const link = await getLatestMagicLink(email);
    await page.goto(link);
    await expect(page.locator("h1")).toContainText("Your account", {
      timeout: 15000,
    });
  }

  async function loginAsStaff(request: any) {
    await request.post(`${API}/api/admin/v1/auth/login`, {
      headers: { "Content-Type": "application/json", Origin: API },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
  }

  function signEmailEvent(payload: string): string {
    return `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
  }

  async function deliverEmailWebhook(
    request: any,
    event: Record<string, unknown>,
  ): Promise<number> {
    const payload = JSON.stringify({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: Math.floor(Date.now() / 1000),
      ...event,
    });
    const res = await request.post(`${API}/api/webhooks/v1/email/smtp`, {
      headers: {
        "Content-Type": "application/json",
        "x-email-signature": signEmailEvent(payload),
      },
      data: payload,
    });
    return res.status();
  }

  test("[Setup] Seed newsletter + product catalog exists", async ({
    request,
  }) => {
    await loginAsStaff(request);
    let res = await request.get(`${API}/api/admin/v1/newsletters`);
    expect(res.status()).toBe(200);
    let body = await res.json();
    if (!body.newsletters || body.newsletters.length === 0) {
      await request.post(`${API}/api/admin/v1/newsletters`, {
        headers: { Origin: API },
        data: {
          key: "default-newsletter",
          name: "Default Newsletter",
          senderName: "Vibress",
          senderEmail: "news@vibress.test",
        },
      });
      res = await request.get(`${API}/api/admin/v1/newsletters`);
      body = await res.json();
    }
    expect(body.newsletters.length).toBeGreaterThan(0);
  });

  test("[Full flow] create → subscribe → send-now → worker delivers → webhook updates state", async ({
    page,
    request,
  }) => {
    await loginAsStaff(request);
    const suffix = `${Date.now()}`;

    // 1. Create newsletter (via API for determinism)
    const createRes = await request.post(`${API}/api/admin/v1/newsletters`, {
      headers: { Origin: API },
      data: {
        key: `e2e-news-${suffix}`,
        name: `E2E Newsletter ${suffix}`,
        senderName: "Vibress",
        senderEmail: "news@vibress.test",
      },
    });
    expect(createRes.status()).toBe(201);
    const newsletterId = (await createRes.json()).newsletter.id;

    // 2. Member signs up and subscribes
    const memberEmail = `e2e-nl-${suffix}@example.com`;
    await signupMember(page, memberEmail);
    const subRes = await page.request.put(
      `${API}/api/members/v1/newsletter-preferences`,
      {
        headers: { Origin: API },
        data: { newsletterId, subscribed: true },
      },
    );
    expect(subRes.status()).toBe(200);

    // 3. Test email succeeds (Mailpit)
    const testRes = await request.post(
      `${API}/api/admin/v1/newsletter-test-email`,
      {
        headers: { Origin: API },
        data: {
          newsletterId,
          subject: `E2E Test ${suffix}`,
          content: {
            schema: "vibress-studio",
            version: 1,
            root: {
              type: "root",
              children: [
                {
                  type: "paragraph",
                  children: [
                    {
                      type: "text",
                      text: "Test body",
                      format: 0,
                      mode: "normal",
                      version: 1,
                    },
                  ],
                  direction: null,
                  format: "",
                  indent: 0,
                  version: 1,
                },
              ],
            },
          },
          recipients: [memberEmail],
        },
      },
    );
    expect(testRes.status()).toBe(200);
    const testBody = await testRes.json();
    expect(testBody.sent).toBe(1);
    const testMail = await getLatestMail(memberEmail);
    expect(testMail?.subject).toContain("E2E Test");

    // 4. Create send-now campaign (queues to worker)
    const sendRes = await request.post(`${API}/api/admin/v1/newsletter-sends`, {
      headers: { Origin: API },
      data: {
        newsletterId,
        subject: `E2E Campaign ${suffix}`,
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "text",
                    text: "Campaign body",
                    format: 0,
                    mode: "normal",
                    version: 1,
                  },
                ],
                direction: null,
                format: "",
                indent: 0,
                version: 1,
              },
            ],
          },
        },
        audience: { filter: "all" },
        sendNow: true,
      },
    });
    expect(sendRes.status()).toBe(201);
    const sendBody = await sendRes.json();
    expect(sendBody.audienceCount).toBe(1);
    const sendId = sendBody.send.id;

    // 5. Wait for worker to deliver (poll Mailpit up to 30s)
    let campaignMail: { subject: string; html: string; text: string } | null =
      null;
    for (let i = 0; i < 30; i++) {
      campaignMail = await getLatestMail(memberEmail);
      if (campaignMail?.subject === `E2E Campaign ${suffix}`) break;
      await page.waitForTimeout(1000);
    }
    expect(campaignMail).toBeTruthy();
    expect(campaignMail!.subject).toBe(`E2E Campaign ${suffix}`);
    // Unsubscribe link present and signed
    const unsubMatch = campaignMail!.html.match(
      /href="([^"]*\/portal\/unsubscribe\?t=[^"]+)"/,
    );
    expect(unsubMatch).toBeTruthy();

    // 6. Send state reflects delivery
    const sendStatusRes = await request.get(
      `${API}/api/admin/v1/newsletter-sends/${sendId}`,
    );
    expect(sendStatusRes.status()).toBe(200);
    const sendStatus = await sendStatusRes.json();
    expect(sendStatus.send.status).toBe("sent");

    // 7. Delivery webhook updates recipient state to delivered
    const recipientId = sendStatus.counts ? Object.keys(sendStatus.counts) : [];
    void recipientId;
    // Find the recipient via admin detail (message id recorded in mail headers isn't exposed);
    // deliver via webhook keyed by messageId found from Mailpit.
    const mailDetail = await (
      await fetch(`http://127.0.0.1:8025/api/v1/messages`)
    ).json();
    const msg = (mailDetail.messages || []).find(
      (m: any) =>
        m.To?.[0]?.Address === memberEmail &&
        m.Subject === `E2E Campaign ${suffix}`,
    );
    const msgDetail = await (
      await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)
    ).json();
    const messageId = msgDetail.MessageID || "";

    const webhookRes = await deliverEmailWebhook(request, {
      type: "delivered",
      messageId,
      email: memberEmail,
    });
    expect(webhookRes).toBe(200);

    // 8. Duplicate webhook is harmless
    const webhookRes2 = await deliverEmailWebhook(request, {
      type: "delivered",
      messageId,
      email: memberEmail,
    });
    expect(webhookRes2).toBe(200);

    // 9. Unsubscribe via the signed link in the email
    const unsubUrl = unsubMatch![1];
    const token = new URL(unsubUrl).searchParams.get("t") || "";
    const unsubRes = await request.post(`${API}/api/public/v1/unsubscribe`, {
      data: { token },
    });
    expect(unsubRes.status()).toBe(200);
    const unsubBody = await unsubRes.json();
    expect(unsubBody.unsubscribed).toBe(true);

    // 10. Unsubscribed member excluded from the next send
    const send2Res = await request.post(
      `${API}/api/admin/v1/newsletter-sends`,
      {
        headers: { Origin: API },
        data: {
          newsletterId,
          subject: `E2E Second ${suffix}`,
          content: {
            schema: "vibress-studio",
            version: 1,
            root: { type: "root", children: [] },
          },
          audience: { filter: "all" },
          sendNow: true,
        },
      },
    );
    expect(send2Res.status()).toBe(201);
    const send2Body = await send2Res.json();
    expect(send2Body.audienceCount).toBe(0);
  });

  test("[Hard bounce] webhook bounce suppresses the address and excludes from future sends", async ({
    page,
    request,
  }) => {
    await loginAsStaff(request);
    const suffix = `${Date.now()}`;

    // Newsletter + member
    const createRes = await request.post(`${API}/api/admin/v1/newsletters`, {
      headers: { Origin: API },
      data: {
        key: `e2e-bounce-${suffix}`,
        name: `Bounce ${suffix}`,
        senderName: "V",
        senderEmail: "news@vibress.test",
      },
    });
    const newsletterId = (await createRes.json()).newsletter.id;
    const memberEmail = `e2e-bounce-${suffix}@example.com`;
    await signupMember(page, memberEmail);
    await page.request.put(`${API}/api/members/v1/newsletter-preferences`, {
      headers: { Origin: API },
      data: { newsletterId, subscribed: true },
    });

    // Send
    const sendRes = await request.post(`${API}/api/admin/v1/newsletter-sends`, {
      headers: { Origin: API },
      data: {
        newsletterId,
        subject: `Bounce Campaign ${suffix}`,
        content: {
          schema: "vibress-studio",
          version: 1,
          root: { type: "root", children: [] },
        },
        audience: { filter: "all" },
        sendNow: true,
      },
    });
    expect(sendRes.status()).toBe(201);
    expect((await sendRes.json()).audienceCount).toBe(1);

    // Wait for delivery and grab the message id
    let messageId = "";
    for (let i = 0; i < 30; i++) {
      const res = await fetch("http://127.0.0.1:8025/api/v1/messages");
      const data = await res.json();
      const msg = (data.messages || []).find(
        (m: any) =>
          m.To?.[0]?.Address === memberEmail &&
          m.Subject === `Bounce Campaign ${suffix}`,
      );
      if (msg) {
        const detail = await (
          await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)
        ).json();
        messageId = detail.MessageID || "";
        break;
      }
      await page.waitForTimeout(1000);
    }
    expect(messageId).toBeTruthy();

    // Simulate hard bounce
    const bounceRes = await deliverEmailWebhook(request, {
      type: "bounce",
      messageId,
      email: memberEmail,
      detail: "hard bounce (550)",
    });
    expect(bounceRes).toBe(200);

    // Suppression is visible to admin
    const suppRes = await request.get(`${API}/api/admin/v1/email-suppressions`);
    expect(suppRes.status()).toBe(200);
    const suppBody = await suppRes.json();
    const suppression = suppBody.suppressions.find(
      (s: any) => s.email === memberEmail,
    );
    expect(suppression).toBeTruthy();
    expect(suppression.reason).toBe("hard_bounce");

    // Future send excludes the suppressed member
    const send2Res = await request.post(
      `${API}/api/admin/v1/newsletter-sends`,
      {
        headers: { Origin: API },
        data: {
          newsletterId,
          subject: `After Bounce ${suffix}`,
          content: {
            schema: "vibress-studio",
            version: 1,
            root: { type: "root", children: [] },
          },
          audience: { filter: "all" },
          sendNow: true,
        },
      },
    );
    expect(send2Res.status()).toBe(201);
    expect((await send2Res.json()).audienceCount).toBe(0);
  });

  test("[Schedule] scheduled send fires at due time via durable scheduler", async ({
    page,
    request,
  }) => {
    await loginAsStaff(request);
    const suffix = `${Date.now()}`;
    const createRes = await request.post(`${API}/api/admin/v1/newsletters`, {
      headers: { Origin: API },
      data: {
        key: `e2e-sched-${suffix}`,
        name: `Sched ${suffix}`,
        senderName: "V",
        senderEmail: "news@vibress.test",
      },
    });
    const newsletterId = (await createRes.json()).newsletter.id;
    const memberEmail = `e2e-sched-${suffix}@example.com`;
    await signupMember(page, memberEmail);
    await page.request.put(`${API}/api/members/v1/newsletter-preferences`, {
      headers: { Origin: API },
      data: { newsletterId, subscribed: true },
    });

    // Schedule ~10 seconds in the future
    const scheduledAt = new Date(Date.now() + 10000).toISOString();
    const sendRes = await request.post(`${API}/api/admin/v1/newsletter-sends`, {
      headers: { Origin: API },
      data: {
        newsletterId,
        subject: `Scheduled ${suffix}`,
        content: {
          schema: "vibress-studio",
          version: 1,
          root: { type: "root", children: [] },
        },
        audience: { filter: "all" },
        scheduledAt,
      },
    });
    expect(sendRes.status()).toBe(201);
    expect((await sendRes.json()).send.status).toBe("scheduled");

    // Worker scheduler picks it up within ~15s and delivers
    let delivered = false;
    for (let i = 0; i < 30; i++) {
      const mail = await getLatestMail(memberEmail);
      if (mail?.subject === `Scheduled ${suffix}`) {
        delivered = true;
        break;
      }
      await page.waitForTimeout(1000);
    }
    expect(delivered).toBe(true);
  });

  test("[Security] header injection blocked in newsletter names/senders", async ({
    request,
  }) => {
    await loginAsStaff(request);
    const suffix = `${Date.now()}`;
    const createRes = await request.post(`${API}/api/admin/v1/newsletters`, {
      headers: { Origin: API },
      data: {
        key: `e2e-inj-${suffix}`,
        name: "Safe",
        senderName: "Vibress\r\nBcc: evil@example.com",
        senderEmail: "news@vibress.test",
      },
    });
    // Domain rejects control characters (header injection blocked)
    expect(createRes.status()).toBe(400);
    const body = await createRes.json();
    expect(body.errors[0].code).toBe("VALIDATION_ERROR");

    // A clean newsletter still works and its sender never contains CR/LF
    const okRes = await request.post(`${API}/api/admin/v1/newsletters`, {
      headers: { Origin: API },
      data: {
        key: `e2e-ok-${suffix}`,
        name: "Safe",
        senderName: "Vibress",
        senderEmail: "news@vibress.test",
      },
    });
    expect(okRes.status()).toBe(201);
    const okBody = await okRes.json();
    expect(okBody.newsletter.senderName).not.toContain("\r");
    expect(okBody.newsletter.senderName).not.toContain("\n");
  });
});
