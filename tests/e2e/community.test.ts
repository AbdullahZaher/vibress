import { test, expect } from "@playwright/test";

const API = "http://localhost:7777";

test.describe("Batch 11 Community E2E Suite", () => {
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

  async function ensurePost(request: any): Promise<string> {
    // Get the owner ID from the authenticated session
    const me = await (await request.get(`${API}/api/admin/v1/auth/me`)).json();
    const ownerId = me.user?.id;
    expect(ownerId).toBeTruthy();

    // Create the post via admin API (draft)
    const createRes = await request.post(`${API}/api/admin/v1/posts`, {
      headers: { Origin: API, "Content-Type": "application/json" },
      data: {
        title: "Community E2E Post",
        slug: `community-e2e-post-${Date.now()}`,
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
                    text: "E2E test post for comments",
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
        visibility: "public",
        primaryAuthorId: ownerId,
      },
    });
    expect(createRes.status()).toBe(201);
    const createBody = await createRes.json();
    expect(createBody.post?.id).toBeTruthy();
    const postId = createBody.post.id;

    // Publish it
    const publishRes = await request.post(
      `${API}/api/admin/v1/posts/${postId}/publish`,
      {
        headers: { Origin: API },
      },
    );
    expect(publishRes.status()).toBe(200);
    return postId;
  }

  test("[Comments + Notifications + Recommendations] Full flow", async ({
    page,
    request,
  }) => {
    await loginAsStaff(request);
    const postId = await ensurePost(request);
    const suffix = `${Date.now()}`;

    // Two members sign up
    const emailA = `e2e-comm-a-${suffix}@example.com`;
    const emailB = `e2e-comm-b-${suffix}@example.com`;
    await signupMember(page, emailA);

    // Member A posts a comment
    const commentRes = await page.request.post(
      `${API}/api/members/v1/comments`,
      {
        headers: { Origin: API },
        data: { postId, body: "Great article!" },
      },
    );
    expect(commentRes.status()).toBe(201);
    const commentA = (await commentRes.json()).comment.id;

    // Member B signs up (separate context)
    const ctxB = await page.context().browser()!.newContext();
    const pageB = await ctxB.newPage();
    await signupMember(pageB, emailB);

    // Member B replies to A's comment
    const replyRes = await pageB.request.post(
      `${API}/api/members/v1/comments`,
      {
        headers: { Origin: API },
        data: { postId, parentId: commentA, body: "I agree!" },
      },
    );
    expect(replyRes.status()).toBe(201);

    // Member A gets a reply notification
    const notifRes = await page.request.get(
      `${API}/api/members/v1/notifications`,
    );
    expect(notifRes.status()).toBe(200);
    const notifs = (await notifRes.json()).notifications;
    const replyNotif = notifs.find((n: any) => n.type === "comment.reply");
    expect(replyNotif).toBeTruthy();
    expect(replyNotif.readAt).toBeNull();

    // Mark notification as read
    const readRes = await page.request.post(
      `${API}/api/members/v1/notifications/${replyNotif.id}/read`,
      {
        headers: { Origin: API },
      },
    );
    expect(readRes.status()).toBe(200);

    // Member B cannot edit A's comment (IDOR)
    const editRes = await pageB.request.patch(
      `${API}/api/members/v1/comments/${commentA}`,
      {
        headers: { Origin: API },
        data: { body: "hacked" },
      },
    );
    expect(editRes.status()).toBe(403);

    // Member B likes A's comment
    const likeRes = await pageB.request.post(
      `${API}/api/members/v1/comments/${commentA}/like`,
      {
        headers: { Origin: API },
      },
    );
    expect(likeRes.status()).toBe(200);
    expect((await likeRes.json()).liked).toBe(true);

    // Member B reports A's comment
    const reportRes = await pageB.request.post(
      `${API}/api/members/v1/comments/${commentA}/report`,
      {
        headers: { Origin: API },
        data: { reason: "spam" },
      },
    );
    expect(reportRes.status()).toBe(201);

    // Public API shows the comments
    const publicRes = await request.get(
      `${API}/api/content/v1/posts/${postId}/comments`,
    );
    expect(publicRes.status()).toBe(200);
    const publicComments = (await publicRes.json()).comments;
    expect(publicComments.some((c: any) => c.id === commentA)).toBe(true);

    // Staff hides A's comment
    const hideRes = await request.post(
      `${API}/api/admin/v1/comments/${commentA}/hide`,
      {
        headers: { Origin: API },
      },
    );
    expect(hideRes.status()).toBe(200);

    // Hidden comment disappears from public API
    const publicRes2 = await request.get(
      `${API}/api/content/v1/posts/${postId}/comments`,
    );
    const publicComments2 = (await publicRes2.json()).comments;
    expect(publicComments2.some((c: any) => c.id === commentA)).toBe(false);

    // Staff restores
    const restoreRes = await request.post(
      `${API}/api/admin/v1/comments/${commentA}/restore`,
      {
        headers: { Origin: API },
      },
    );
    expect(restoreRes.status()).toBe(200);

    // Comment reappears
    const publicRes3 = await request.get(
      `${API}/api/content/v1/posts/${postId}/comments`,
    );
    const publicComments3 = (await publicRes3.json()).comments;
    expect(publicComments3.some((c: any) => c.id === commentA)).toBe(true);

    await ctxB.close();
  });

  test("[Recommendations] click tracking + SSRF blocking", async ({
    request,
  }) => {
    await loginAsStaff(request);

    // Create a safe recommendation
    const createRes = await request.post(
      `${API}/api/admin/v1/recommendations`,
      {
        headers: { Origin: API },
        data: {
          url: "https://example.com/great-resource",
          title: "Great Resource",
        },
      },
    );
    expect(createRes.status()).toBe(201);
    const recId = (await createRes.json()).recommendation.id;

    // Public can see it
    const listRes = await request.get(`${API}/api/content/v1/recommendations`);
    expect(listRes.status()).toBe(200);
    expect(
      (await listRes.json()).recommendations.some((r: any) => r.id === recId),
    ).toBe(true);

    // Record a click
    const clickRes = await request.post(
      `${API}/api/content/v1/recommendations/${recId}/click`,
      {
        data: { sessionId: "e2e-session" },
      },
    );
    expect(clickRes.status()).toBe(200);

    // Click count visible to admin
    const statsRes = await request.get(
      `${API}/api/admin/v1/recommendations/${recId}/stats`,
    );
    expect(statsRes.status()).toBe(200);
    expect((await statsRes.json()).stats.click).toBeGreaterThanOrEqual(1);

    // SSRF: localhost URL blocked
    const ssrfRes = await request.post(`${API}/api/admin/v1/recommendations`, {
      headers: { Origin: API },
      data: { url: "http://localhost:3000/admin", title: "Internal" },
    });
    expect(ssrfRes.status()).toBe(400);
    expect((await ssrfRes.json()).errors[0].code).toBe("UNSAFE_URL");

    // SSRF: private IP blocked
    const ssrfRes2 = await request.post(`${API}/api/admin/v1/recommendations`, {
      headers: { Origin: API },
      data: { url: "http://10.0.0.1/internal", title: "Private" },
    });
    expect(ssrfRes2.status()).toBe(400);
    expect((await ssrfRes2.json()).errors[0].code).toBe("UNSAFE_URL");
  });
});
