import { test, expect } from "@playwright/test";

const API = "http://localhost:7777";

test.describe("Batch 13 Intelligence E2E Suite", () => {
  async function loginAsStaff(request: any) {
    await request.post(`${API}/api/admin/v1/auth/login`, {
      headers: { "Content-Type": "application/json", Origin: API },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
  }

  async function createPublishedPost(
    request: any,
    title: string,
    visibility = "public",
  ): Promise<string> {
    const me = await (await request.get(`${API}/api/admin/v1/auth/me`)).json();
    const ownerId = me.user?.id;
    const createRes = await request.post(`${API}/api/admin/v1/posts`, {
      headers: { Origin: API, "Content-Type": "application/json" },
      data: {
        title,
        slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
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
                    text: title + " body content",
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
        visibility,
        primaryAuthorId: ownerId,
      },
    });
    expect(createRes.status()).toBe(201);
    const postId = (await createRes.json()).post.id;
    const pubRes = await request.post(
      `${API}/api/admin/v1/posts/${postId}/publish`,
      { headers: { Origin: API } },
    );
    expect(pubRes.status()).toBe(200);
    return postId;
  }

  async function waitFor(
    fn: () => Promise<boolean>,
    timeoutMs = 30000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Timed out waiting for condition");
  }

  test("[Search] published Post becomes searchable; unpublished disappears", async ({
    request,
  }) => {
    await loginAsStaff(request);

    // Create + publish a post
    const title = `Searchable E2E Post ${Date.now()}`;
    const postId = await createPublishedPost(request, title);

    // Wait for the search indexer to pick up the publish event
    await waitFor(async () => {
      const res = await request.get(
        `${API}/api/content/v1/search?q=${encodeURIComponent(title)}`,
      );
      if (res.status() !== 200) return false;
      const body = await res.json();
      return body.results.some((r: any) => r.entityId === postId);
    });
    expect(true).toBe(true); // reached via waitFor

    // Unpublish → removed from search
    const unpubRes = await request.post(
      `${API}/api/admin/v1/posts/${postId}/unpublish`,
      { headers: { Origin: API } },
    );
    expect(unpubRes.status()).toBe(200);

    await waitFor(async () => {
      const res = await request.get(
        `${API}/api/content/v1/search?q=${encodeURIComponent(title)}`,
      );
      const body = await res.json();
      return !body.results.some((r: any) => r.entityId === postId);
    });
  });

  test("[Search] restricted (members) content is never searchable", async ({
    request,
  }) => {
    await loginAsStaff(request);
    const title = `Members Only E2E ${Date.now()}`;
    await createPublishedPost(request, title, "members");

    // Wait a moment for indexing attempt, then verify it never appears
    await new Promise((r) => setTimeout(r, 3000));
    const res = await request.get(
      `${API}/api/content/v1/search?q=${encodeURIComponent("Members Only E2E")}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(
      body.results.some((r: any) => r.title.includes("Members Only E2E")),
    ).toBe(false);
  });

  test("[Search] query abuse protection (rate limit + length bound)", async ({
    request,
  }) => {
    await loginAsStaff(request);
    // Length bound
    const longRes = await request.get(
      `${API}/api/content/v1/search?q=${"x".repeat(200)}`,
    );
    expect(longRes.status()).toBe(400);
    expect((await longRes.json()).errors[0].code).toBe("QUERY_TOO_LONG");

    // Rate limit (200/min in test mode through the gateway; fire 250)
    let limited = false;
    for (let i = 0; i < 250; i++) {
      const res = await request.get(`${API}/api/content/v1/search?q=hello`);
      if (res.status() === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  test("[Analytics] member-created event reaches daily aggregation", async ({
    page,
    request,
  }) => {
    await loginAsStaff(request);

    // Create a member → member.created → member.signup analytics event
    const email = `e2e-analytics-${Date.now()}@example.com`;
    const reqRes = await request.post(`${API}/api/members/v1/auth/request`, {
      headers: { Origin: API },
      data: { email },
    });
    expect(reqRes.status()).toBe(200);

    // Wait for the analytics worker to ingest and aggregate
    await waitFor(async () => {
      const res = await request.get(
        `${API}/api/admin/v1/analytics/metrics?from=2020-01-01&to=2030-01-01&metricName=member.signup`,
      );
      if (res.status() !== 200) return false;
      const body = await res.json();
      return body.metrics.some(
        (m: any) => m.name === "member.signup" && m.count > 0,
      );
    });
  });
});

