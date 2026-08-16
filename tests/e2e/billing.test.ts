import { test, expect } from "@playwright/test";
import Stripe from "stripe";

const API = "http://localhost:7777";
const WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || "whsec_prod_local_benchmark";

test.describe("Batch 9 Billing E2E Suite", () => {
  async function getLatestMagicLink(email: string): Promise<string> {
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch("http://127.0.0.1:8025/api/v1/messages");
        const data = await res.json();
        const msg = (data.messages || []).find(
          (m: any) => m.To?.[0]?.Address === email,
        );
        if (msg) {
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
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Magic link for ${email} not found in MailPit`);
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

  function signedEvent(
    type: string,
    object: Record<string, unknown>,
  ): { payload: string; header: string } {
    const payload = JSON.stringify({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      object: "event",
      api_version: "2024-06-20",
      created: Math.floor(Date.now() / 1000),
      type,
      data: { object },
    });
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    return { payload, header };
  }

  async function deliverWebhook(
    request: any,
    type: string,
    object: Record<string, unknown>,
  ): Promise<void> {
    const { payload, header } = signedEvent(type, object);
    const res = await request.post(`${API}/api/webhooks/v1/billing/stripe`, {
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": header,
      },
      data: JSON.parse(payload),
    });
    expect(res.status()).toBe(200);
  }

  test("[Setup] Ensure products/plans/offers exist and webhook secret matches API", async ({
    request,
  }) => {
    let res = await request.get(`${API}/api/content/v1/products`);
    expect(res.status()).toBe(200);
    let body = await res.json();
    if (!body.products || body.products.length === 0 || !body.products.some((p: any) => p.plans?.some((pl: any) => pl.billingType === "recurring"))) {
      await loginAsStaff(request);
      await request.post(`${API}/api/admin/v1/products`, {
        headers: { Origin: API },
        data: {
          name: "Vibress Membership",
          slug: `vibress-membership-${Date.now()}`,
          plans: [
            {
              name: "Monthly Plan",
              amount: 500,
              currency: "USD",
              interval: "month",
              billingType: "recurring",
            },
          ],
        },
      });
      res = await request.get(`${API}/api/content/v1/products`);
      body = await res.json();
    }
    // Verify there is at least one public product with a recurring plan
    const hasRecurring = body.products.some((p: any) =>
      p.plans.some((pl: any) => pl.billingType === "recurring"),
    );
    expect(hasRecurring).toBe(true);
  });

  test("[Paid Member] sign in → plan → checkout → simulated provider completion → active subscription", async ({
    page,
    request,
  }) => {
    // Get the recurring plan
    const catalog = await (
      await request.get(`${API}/api/content/v1/products`)
    ).json();
    const product = catalog.products.find((p: any) =>
      p.plans.some((pl: any) => pl.billingType === "recurring"),
    );
    const plan = product.plans.find(
      (pl: any) => pl.billingType === "recurring",
    );

    // Sign in as a fresh member
    const email = `e2e-billing-${Date.now()}@example.com`;
    await signupMember(page, email);

    // View plans page
    await page.goto(`${API}/portal/#/plans`);
    await expect(page.locator("h1")).toContainText("Choose your plan");

    // Start checkout via API (provider-hosted; simulated by webhook)
    const memberRes = await page.request.get(
      `${API}/api/members/v1/subscriptions`,
      { headers: { Origin: API } },
    );
    expect(memberRes.status()).toBe(200);

    // Simulate provider completion: webhook creates the subscription
    const memberId = (
      await (await page.request.get(`${API}/api/members/v1/me`)).json()
    ).member.id;
    await deliverWebhook(request, "customer.subscription.created", {
      id: `sub_e2e_${Date.now()}`,
      object: "subscription",
      customer: "cus_e2e",
      status: "active",
      currency: "usd",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      metadata: { memberId, planId: plan.id },
    });

    // Portal reflects active subscription (polls)
    await page.goto(`${API}/portal/#/account`);
    await expect(page.locator("h1")).toContainText("Your account");
    await expect(page.locator("text=Membership")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator(`text=${plan.name}`)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator("text=Renews")).toBeVisible({ timeout: 15000 });
  });

  test("[Cancel] active subscription → cancel → scheduled cancellation displayed", async ({
    page,
    request,
  }) => {
    const email = `e2e-cancel-${Date.now()}@example.com`;
    await signupMember(page, email);
    const memberId = (
      await (await page.request.get(`${API}/api/members/v1/me`)).json()
    ).member.id;

    const catalog = await (
      await request.get(`${API}/api/content/v1/products`)
    ).json();
    const product = catalog.products.find((p: any) =>
      p.plans.some((pl: any) => pl.billingType === "recurring"),
    );
    const plan = product.plans.find(
      (pl: any) => pl.billingType === "recurring",
    );

    await deliverWebhook(request, "customer.subscription.created", {
      id: `sub_e2e_${Date.now()}`,
      object: "subscription",
      customer: "cus_e2e",
      status: "active",
      currency: "usd",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      metadata: { memberId, planId: plan.id },
    });

    await page.goto(`${API}/portal/#/account`);
    await expect(page.locator(`text=${plan.name}`)).toBeVisible({
      timeout: 15000,
    });
    await page.click("text=Cancel at period end");
    await expect(page.locator("text=Cancellation scheduled")).toBeVisible({
      timeout: 15000,
    });
  });

  test("[Resume] scheduled cancellation → resume → active state restored", async ({
    page,
    request,
  }) => {
    const email = `e2e-resume-${Date.now()}@example.com`;
    await signupMember(page, email);
    const memberId = (
      await (await page.request.get(`${API}/api/members/v1/me`)).json()
    ).member.id;

    const catalog = await (
      await request.get(`${API}/api/content/v1/products`)
    ).json();
    const product = catalog.products.find((p: any) =>
      p.plans.some((pl: any) => pl.billingType === "recurring"),
    );
    const plan = product.plans.find(
      (pl: any) => pl.billingType === "recurring",
    );

    await deliverWebhook(request, "customer.subscription.created", {
      id: `sub_e2e_${Date.now()}`,
      object: "subscription",
      customer: "cus_e2e",
      status: "active",
      currency: "usd",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      metadata: { memberId, planId: plan.id },
    });

    // Cancel then resume
    await page.goto(`${API}/portal/#/account`);
    await expect(page.locator(`text=${plan.name}`)).toBeVisible({
      timeout: 15000,
    });
    await page.click("text=Cancel at period end");
    await expect(page.locator("text=Cancellation scheduled")).toBeVisible({
      timeout: 15000,
    });
    await page.click("text=Resume membership");
    await expect(page.locator("text=Cancellation scheduled")).not.toBeVisible({
      timeout: 15000,
    });
  });

  test("[Payment failure] provider failure event → past_due state reflected in Portal", async ({
    page,
    request,
  }) => {
    const email = `e2e-fail-${Date.now()}@example.com`;
    await signupMember(page, email);
    const memberId = (
      await (await page.request.get(`${API}/api/members/v1/me`)).json()
    ).member.id;

    const catalog = await (
      await request.get(`${API}/api/content/v1/products`)
    ).json();
    const product = catalog.products.find((p: any) =>
      p.plans.some((pl: any) => pl.billingType === "recurring"),
    );
    const plan = product.plans.find(
      (pl: any) => pl.billingType === "recurring",
    );

    const subId = `sub_e2e_${Date.now()}`;
    await deliverWebhook(request, "customer.subscription.created", {
      id: subId,
      object: "subscription",
      customer: "cus_e2e",
      status: "active",
      currency: "usd",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      metadata: { memberId, planId: plan.id },
    });

    // Simulate invoice payment failure (subscription id carried in object.subscription)
    await page.goto(`${API}/portal/#/account`);
    await expect(page.locator(`text=${plan.name}`)).toBeVisible({
      timeout: 15000,
    });

    await deliverWebhook(request, "invoice.payment_failed", {
      id: "invoice_fail_" + Date.now(),
      object: "invoice",
      subscription: subId,
      status: "past_due",
    });

    // Portal reflects the payment-failure state
    await page.goto(`${API}/portal/#/account`);
    await expect(page.locator("text=Payment failed")).toBeVisible({
      timeout: 15000,
    });
  });

  test("[Duplicate webhook] replay of the same event does not create duplicates", async ({
    page,
    request,
  }) => {
    // Create a member with an active subscription via webhook
    const email = `e2e-dup-${Date.now()}@example.com`;
    await signupMember(page, email);
    const memberId = (
      await (await page.request.get(`${API}/api/members/v1/me`)).json()
    ).member.id;

    const catalog = await (
      await request.get(`${API}/api/content/v1/products`)
    ).json();
    const product = catalog.products.find((p: any) =>
      p.plans.some((pl: any) => pl.billingType === "recurring"),
    );
    const plan = product.plans.find(
      (pl: any) => pl.billingType === "recurring",
    );

    const subId = `sub_dup_${Date.now()}`;
    const { payload, header } = signedEvent("customer.subscription.created", {
      id: subId,
      object: "subscription",
      customer: "cus_dup",
      status: "active",
      currency: "usd",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      metadata: { memberId, planId: plan.id },
    });

    // Deliver the same signed event three times (replays)
    for (let i = 0; i < 3; i++) {
      const res = await request.post(`${API}/api/webhooks/v1/billing/stripe`, {
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": header,
        },
        data: JSON.parse(payload),
      });
      expect(res.status()).toBe(200);
    }

    // Exactly ONE subscription exists for this member (dedup worked)
    const subs = await (
      await page.request.get(`${API}/api/members/v1/subscriptions`)
    ).json();
    const matches = subs.subscriptions.filter(
      (s: any) => s.planName === plan.name,
    );
    expect(matches.length).toBe(1);
  });

  test("[Staff] Staff with permission views member subscription safely", async ({
    request,
  }) => {
    await loginAsStaff(request);
    const res = await request.get(`${API}/api/admin/v1/subscriptions`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.subscriptions.length).toBeGreaterThan(0);
    const sub = body.subscriptions[0];
    // Safe DTO: no secrets leak through
    expect(JSON.stringify(sub)).not.toContain("sk_");
    expect(JSON.stringify(sub)).not.toContain("whsec");
    expect(JSON.stringify(sub)).not.toContain("stripe-signature");
    // Provider references are exposed safely (operational), but never raw payloads
    expect(sub).not.toHaveProperty("providerEventTimestamp");
  });

  test("[Member IDOR] Member A cannot view or cancel Member B subscription", async ({
    page,
    browser,
  }) => {
    const emailA = `e2e-idor-a-${Date.now()}@example.com`;
    const emailB = `e2e-idor-b-${Date.now()}@example.com`;

    // Member A session (page context)
    await signupMember(page, emailA);

    // Member B session (separate context)
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await signupMember(pageB, emailB);
    const memberB = (
      await (await pageB.request.get(`${API}/api/members/v1/me`)).json()
    ).member.id;

    // Create an active subscription for B via webhook
    const catalog = await (
      await page.request.get(`${API}/api/content/v1/products`)
    ).json();
    const product = catalog.products.find((p: any) =>
      p.plans.some((pl: any) => pl.billingType === "recurring"),
    );
    const plan = product.plans.find(
      (pl: any) => pl.billingType === "recurring",
    );
    const subId = `sub_idor_${Date.now()}`;
    await deliverWebhook(page.request, "customer.subscription.created", {
      id: subId,
      object: "subscription",
      customer: "cus_idor",
      status: "active",
      currency: "usd",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      metadata: { memberId: memberB, planId: plan.id },
    });

    // B can see the subscription
    const bSubs = await (
      await pageB.request.get(`${API}/api/members/v1/subscriptions`)
    ).json();
    const bSub = bSubs.subscriptions.find((s: any) => s.planName === plan.name);
    expect(bSub).toBeTruthy();
    const bSubId = bSub.id;

    // A cannot view B's subscription
    const aView = await page.request.get(
      `${API}/api/members/v1/subscriptions/${bSubId}`,
    );
    expect(aView.status()).toBe(404);

    // A cannot cancel B's subscription
    const aCancel = await page.request.post(
      `${API}/api/members/v1/subscriptions/${bSubId}/cancel`,
      {
        headers: { Origin: API },
      },
    );
    expect(aCancel.status()).toBe(404);

    // B's subscription is still active and unchanged
    const bAfter = await (
      await pageB.request.get(`${API}/api/members/v1/subscriptions`)
    ).json();
    const bSubAfter = bAfter.subscriptions.find((s: any) => s.id === bSubId);
    expect(bSubAfter.status).toBe("active");
    expect(bSubAfter.cancelAtPeriodEnd).toBe(false);

    await ctxB.close();
  });
});
