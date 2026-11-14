import { test, expect } from "@playwright/test";
import { readE2eState } from "../../scripts/lib/platform-reference-e2e";

const state = readE2eState();
if (!state) {
  throw new Error(
    "reference-app E2E state is missing; start the harness through playwright.platform-reference.config.ts",
  );
}

const staffHeaders = {
  authorization: `Bearer ${state.staffToken}`,
  "x-tenant-id": state.tenantAId,
};
const memberHeaders = {
  authorization: `Bearer ${state.memberToken}`,
  "x-tenant-id": state.tenantAId,
};
const tenantBHeaders = {
  authorization: `Bearer ${state.tenantBToken}`,
  "x-tenant-id": state.tenantBId,
};

test.describe("reference application over the network", () => {
  test("serves the public health route without credentials", async ({
    request,
  }) => {
    const response = await request.get("/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      application: state.applicationId,
    });
  });

  test("rejects an unauthenticated tenant route", async ({ request }) => {
    const response = await request.get("/crm/customers", {
      headers: { "x-tenant-id": state.tenantAId },
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  test("requires a tenant header for an authenticated principal", async ({
    request,
  }) => {
    const response = await request.get("/crm/customers", {
      headers: { authorization: `Bearer ${state.memberToken}` },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "tenant_required" },
    });
  });

  test("rejects a member principal on the staff write route", async ({
    request,
  }) => {
    const response = await request.post("/crm/customers", {
      headers: memberHeaders,
      data: { name: "Denied Ltd" },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "route_requires_staff" },
    });
  });

  test("rejects invalid customer input before opening a transaction", async ({
    request,
  }) => {
    const response = await request.post("/crm/customers", {
      headers: staffHeaders,
      data: { name: "" },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_input" },
    });
  });

  test("creates and lists a customer inside the staff tenant", async ({
    request,
  }) => {
    const created = await request.post("/crm/customers", {
      headers: staffHeaders,
      data: { name: "E2E Acme Ltd", email: "e2e@acme.test" },
    });
    expect(created.status()).toBe(200);
    const body = await created.json();
    expect(body).toMatchObject({
      name: "E2E Acme Ltd",
      email: "e2e@acme.test",
    });

    const listed = await request.get("/crm/customers", {
      headers: memberHeaders,
    });
    expect(listed.status()).toBe(200);
    const customers = (await listed.json()).customers as Array<{
      id: string;
      name: string;
    }>;
    expect(customers.map((customer) => customer.name)).toContain(
      "E2E Acme Ltd",
    );
    expect(customers.some((customer) => customer.id === body.id)).toBe(true);
  });

  test("denies a principal that is not entitled to the requested tenant", async ({
    request,
  }) => {
    const response = await request.get("/crm/customers", {
      headers: {
        authorization: `Bearer ${state.memberToken}`,
        "x-tenant-id": state.tenantBId,
      },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "scope_denied" },
    });
  });

  test("keeps the second tenant empty through RLS", async ({ request }) => {
    const response = await request.get("/crm/customers", {
      headers: tenantBHeaders,
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ customers: [] });
  });
});
