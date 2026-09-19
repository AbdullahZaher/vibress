import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import {
  getDb,
  users,
  userRoles,
  roles,
  publications,
  publicationMemberships,
  workspaces,
} from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { hashPassword } from "@vibress/security";

const PUB_A = "pub_adv_test_a";
const PUB_B = "pub_adv_test_b";
const WS_ID = "ws_adv_test";

async function setupStaffUser(
  app: FastifyInstance,
  email: string,
  name: string,
  publicationId: string,
): Promise<{ userId: string; cookie: string }> {
  const db = getDb();
  let userId: string;
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing[0]) {
    userId = existing[0].id;
  } else {
    userId = crypto.randomUUID();
    const hash = await hashPassword("AdvPassword123!");
    await db.insert(users).values({
      id: userId,
      email,
      name,
      slug: `user-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      passwordHash: hash,
      status: "active",
    });

    const ownerRole = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, "owner"))
      .limit(1);
    if (ownerRole[0]) {
      await db.insert(userRoles).values({
        userId,
        roleId: ownerRole[0].id,
      });
    }
  }

  // Ensure publication membership
  await db
    .insert(publicationMemberships)
    .values({
      id: `pm_${userId}_${publicationId}`,
      publicationId,
      userId,
      role: "owner",
    })
    .onConflictDoNothing();

  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: { email, password: "AdvPassword123!" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = ((res.headers["set-cookie"] as unknown as string) || "").split(";")[0] ?? "";
  return { userId, cookie };
}

describe("Content Modeler Adversarial Publication Isolation & Security Certification", () => {
  let app: FastifyInstance;
  let cookieA: string;
  let cookieB: string;

  let modelAId: string;
  const modelASlug = `alpha-model-${Date.now()}`;
  let entryAId: string;
  const entryASlug = "alpha-first-entry";

  let modelBId: string;
  const modelBSlug = `beta-model-${Date.now()}`;
  let entryBId: string;
  const entryBSlug = "beta-first-entry";

  beforeAll(async () => {
    const db = getDb();

    // Create workspace
    await db
      .insert(workspaces)
      .values({
        id: WS_ID,
        name: "Adversarial Test Workspace",
        slug: `adv-ws-${Date.now()}`,
      })
      .onConflictDoNothing();

    // Create Publication A with domain
    await db
      .insert(publications)
      .values({
        id: PUB_A,
        workspaceId: WS_ID,
        name: "Adversarial Publication Alpha",
        slug: `adv-alpha-${Date.now()}`,
        domain: "alpha.adv.local",
        primaryLocale: "en",
      })
      .onConflictDoNothing();

    await db
      .update(publications)
      .set({ domain: "alpha.adv.local" })
      .where(eq(publications.id, PUB_A));

    // Create Publication B with domain
    await db
      .insert(publications)
      .values({
        id: PUB_B,
        workspaceId: WS_ID,
        name: "Adversarial Publication Beta",
        slug: `adv-beta-${Date.now()}`,
        domain: "beta.adv.local",
        primaryLocale: "ar",
      })
      .onConflictDoNothing();

    await db
      .update(publications)
      .set({ domain: "beta.adv.local" })
      .where(eq(publications.id, PUB_B));

    app = buildApp();
    await app.ready();

    const userA = await setupStaffUser(app, "adv-user-a@vibress.local", "User Alpha", PUB_A);
    const userB = await setupStaffUser(app, "adv-user-b@vibress.local", "User Beta", PUB_B);

    cookieA = userA.cookie;
    cookieB = userB.cookie;
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. Creates models in Publication A and Publication B with strict isolation", async () => {
    // Create Model in Pub A
    const resA = await app.inject({
      method: "POST",
      url: "/api/admin/v1/content-models",
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
      payload: {
        name: "Alpha Products",
        slug: modelASlug,
        fields: [
          { id: "f1", name: "Product Name", key: "name", type: "text", required: true, apiVisibility: "public" },
          { id: "f2", name: "Wholesale Secret", key: "secretCode", type: "text", apiVisibility: "private" },
          { id: "f3", name: "Member Price", key: "memberPrice", type: "number", apiVisibility: "authenticated" },
        ],
      },
    });
    expect(resA.statusCode).toBe(201);
    const bodyA = resA.json();
    modelAId = bodyA.data.id;
    expect(bodyA.data.publicationId).toBe(PUB_A);

    // Create Model in Pub B
    const resB = await app.inject({
      method: "POST",
      url: "/api/admin/v1/content-models",
      headers: { cookie: cookieB, "x-publication-id": PUB_B },
      payload: {
        name: "Beta Projects",
        slug: modelBSlug,
        fields: [
          { id: "fb1", name: "Project Title", key: "title", type: "text", required: true, apiVisibility: "public" },
        ],
      },
    });
    expect(resB.statusCode).toBe(201);
    const bodyB = resB.json();
    modelBId = bodyB.data.id;
    expect(bodyB.data.publicationId).toBe(PUB_B);
  });

  it("2. Adversarial: Publication A cannot list or read Publication B models", async () => {
    // List models under Pub A
    const listRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/content-models",
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
    });
    expect(listRes.statusCode).toBe(200);
    const modelsInA = listRes.json().data;
    expect(modelsInA.some((m: any) => m.id === modelAId)).toBe(true);
    expect(modelsInA.some((m: any) => m.id === modelBId)).toBe(false);

    // Direct read of B model by ID while in Pub A context
    const getRes = await app.inject({
      method: "GET",
      url: `/api/admin/v1/content-models/${modelBId}`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
    });
    expect(getRes.statusCode).toBe(404);

    // Direct read of B model by slug while in Pub A context
    const getSlugRes = await app.inject({
      method: "GET",
      url: `/api/admin/v1/content-models/${modelBSlug}`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
    });
    expect(getSlugRes.statusCode).toBe(404);
  });

  it("3. Adversarial: Publication A cannot update (PUT / PATCH) or delete Publication B models", async () => {
    // PUT attempt
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/admin/v1/content-models/${modelBId}`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
      payload: { name: "Hacked by A via PUT" },
    });
    expect(putRes.statusCode).toBe(404);

    // PATCH attempt
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/admin/v1/content-models/${modelBId}`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
      payload: { name: "Hacked by A via PATCH" },
    });
    expect(patchRes.statusCode).toBe(404);

    // DELETE attempt
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/admin/v1/content-models/${modelBId}`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
    });
    expect(delRes.statusCode).toBe(404);
  });

  it("4. Creates entries in Publication A and Publication B with full lifecycle", async () => {
    // Create in Pub A
    const resA = await app.inject({
      method: "POST",
      url: `/api/admin/v1/content-models/${modelASlug}/entries`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
      payload: {
        title: "Alpha Entry One",
        slug: entryASlug,
        data: {
          name: "Alpha Entry One",
          secretCode: "CLASSIFIED_A_999",
          memberPrice: 49.99,
        },
        status: "published",
      },
    });
    expect(resA.statusCode).toBe(201);
    entryAId = resA.json().data.id;

    // Create in Pub B
    const resB = await app.inject({
      method: "POST",
      url: `/api/admin/v1/content-models/${modelBSlug}/entries`,
      headers: { cookie: cookieB, "x-publication-id": PUB_B },
      payload: {
        title: "Beta Entry One",
        slug: entryBSlug,
        data: {
          title: "Beta Entry One",
        },
        status: "published",
      },
    });
    expect(resB.statusCode).toBe(201);
    entryBId = resB.json().data.id;
  });

  it("5. Adversarial: Publication A cannot read, create, update, or delete Publication B entries", async () => {
    // List entries of model B from Pub A context -> Model B not found in Pub A
    const listRes = await app.inject({
      method: "GET",
      url: `/api/admin/v1/content-models/${modelBSlug}/entries`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
    });
    expect(listRes.statusCode).toBe(404);

    // Get entry B directly using Pub A context
    const getRes = await app.inject({
      method: "GET",
      url: `/api/admin/v1/content-models/${modelBSlug}/entries/${entryBId}`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
    });
    expect(getRes.statusCode).toBe(404);

    // Create entry in Model B using Pub A context
    const createRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/content-models/${modelBSlug}/entries`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
      payload: {
        title: "Injected Entry",
        slug: "injected",
        data: {},
      },
    });
    expect(createRes.statusCode).toBe(400);

    // PATCH update entry B using Pub A context
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/admin/v1/content-models/${modelBSlug}/entries/${entryBId}`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
      payload: { title: "Compromised by A" },
    });
    expect(patchRes.statusCode).toBe(400);

    // Publish entry B using Pub A context
    const pubActionRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/content-models/${modelBSlug}/entries/${entryBId}/publish`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
    });
    expect(pubActionRes.statusCode).toBe(400);

    // DELETE entry B using Pub A context
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/admin/v1/content-models/${modelBSlug}/entries/${entryBId}`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
    });
    expect(delRes.statusCode).toBe(400);
  });

  it("6. Public API Security: Never leaks private or authenticated fields to public callers", async () => {
    // Public List Collection using Host Header
    const pubListRes = await app.inject({
      method: "GET",
      url: `/api/content/v1/collections/${modelASlug}`,
      headers: { host: "alpha.adv.local" },
    });
    expect(pubListRes.statusCode).toBe(200);
    const listBody = pubListRes.json();
    expect(listBody.data.length).toBeGreaterThan(0);
    const pubEntry = listBody.data[0];

    // Assert public field is present
    expect(pubEntry.data.name).toBe("Alpha Entry One");

    // CRITICAL: Assert private field and authenticated field are NEVER returned to public caller!
    expect(pubEntry.data.secretCode).toBeUndefined();
    expect(pubEntry.data.memberPrice).toBeUndefined();

    // Public Single Entry Endpoint
    const pubSingleRes = await app.inject({
      method: "GET",
      url: `/api/content/v1/collections/${modelASlug}/${entryASlug}`,
      headers: { host: "alpha.adv.local" },
    });
    expect(pubSingleRes.statusCode).toBe(200);
    const singleBody = pubSingleRes.json();

    expect(singleBody.data.data.name).toBe("Alpha Entry One");
    expect(singleBody.data.data.secretCode).toBeUndefined();
    expect(singleBody.data.data.memberPrice).toBeUndefined();
  });

  it("7. Public API Isolation: Publication A cannot view Publication B collection via public API", async () => {
    // Querying Beta Model under Pub A host returns 404
    const res = await app.inject({
      method: "GET",
      url: `/api/content/v1/collections/${modelBSlug}`,
      headers: { host: "alpha.adv.local" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("8. Schema Evolution Preview: returns diff analysis without mutating data", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/admin/v1/content-models/${modelAId}/schema-evolution-preview`,
      headers: { cookie: cookieA, "x-publication-id": PUB_A },
      payload: {
        fields: [
          { id: "f1", name: "Product Name", key: "name", type: "text", required: true },
          { id: "f4", name: "Discount", key: "discount", type: "number", required: false },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.changes).toBeInstanceOf(Array);
    expect(body.data.changes.some((c: any) => c.key === "discount" && c.action === "added")).toBe(true);
    expect(body.data.changes.some((c: any) => c.key === "secretCode" && c.action === "removed")).toBe(true);
  });
});
