import { describe, it, expect, beforeAll } from "vitest";
import Stripe from "stripe";
import { StripeBillingProvider } from "../src/infrastructure/stripe/stripe-provider";

const WEBHOOK_SECRET = "whsec_contract_test";

function makeSignedEvent(
  type: string,
  object: Record<string, unknown>,
): { payload: string; header: string } {
  const payload = JSON.stringify({
    id: `evt_${type.replace(/[^a-z0-9]/g, "_")}`,
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

describe("StripeBillingProvider webhook contract", () => {
  const provider = new StripeBillingProvider({
    secretKey: "sk_test_dummy",
    webhookSecret: WEBHOOK_SECRET,
  });

  it("verifies a valid signed payload", async () => {
    const { payload, header } = makeSignedEvent(
      "customer.subscription.updated",
      { id: "sub_1", status: "active" },
    );
    expect(await provider.verifyWebhookSignature(payload, header)).toBe(true);
  });

  it("verifies a valid signed Buffer payload (raw body)", async () => {
    const { payload, header } = makeSignedEvent(
      "customer.subscription.updated",
      { id: "sub_1", status: "active" },
    );
    expect(
      await provider.verifyWebhookSignature(Buffer.from(payload), header),
    ).toBe(true);
  });

  it("rejects an invalid signature", async () => {
    const { payload } = makeSignedEvent("customer.subscription.updated", {
      id: "sub_1",
    });
    expect(await provider.verifyWebhookSignature(payload, "t=1,v1=bogus")).toBe(
      false,
    );
  });

  it("rejects a missing signature header", async () => {
    const { payload } = makeSignedEvent("customer.subscription.updated", {
      id: "sub_1",
    });
    expect(await provider.verifyWebhookSignature(payload, null)).toBe(false);
  });

  it("rejects a signature with an unknown webhook secret", async () => {
    const { payload } = makeSignedEvent("customer.subscription.updated", {
      id: "sub_1",
    });
    const wrongProvider = new StripeBillingProvider({
      secretKey: "sk_test_dummy",
      webhookSecret: "whsec_wrong",
    });
    expect(
      await wrongProvider.verifyWebhookSignature(
        payload,
        Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: "whsec_other",
        }),
      ),
    ).toBe(false);
  });

  it("parses a webhook event into provider-neutral shape", async () => {
    const { payload } = makeSignedEvent("checkout.session.completed", {
      id: "cs_1",
      status: "complete",
    });
    const event = await provider.parseWebhookEvent(payload);
    expect(event.id).toBe("evt_checkout_session_completed");
    expect(event.type).toBe("checkout.session.completed");
    expect(typeof event.created).toBe("number");
    expect((event.data as Record<string, unknown>).id).toBe("cs_1");
  });

  it("maps provider errors to stable Vibress error codes", async () => {
    // Invalid request (missing price) should map to BILLING_CONFIGURATION_ERROR
    // A network failure is represented by the StripeConnectionError class directly.
    const connError = new Stripe.errors.StripeConnectionError({
      message: "timeout",
      headers: {},
      raw: {},
      errorType: "StripeConnectionError",
      statusCode: 502,
      requestId: "req_1",
    });
    await expect(
      provider.createCustomer({ email: "a@b.com" }),
    ).rejects.toMatchObject({ code: "BILLING_PROVIDER_UNAVAILABLE" });
  });
});
