import { test, expect } from "@playwright/test";

test.describe("Batch 6 Public Web, SEO & Discovery E2E Suite", () => {
  let postSlug: string;
  let draftSlug: string;
  let schedSlug: string;
  let pageSlug: string;
  let tagSlug: string;
  let authorSlug: string;
  let unpubPostId: string;
  let unpubPostSlug: string;

  test.beforeAll(async ({ request }) => {
    // 1. Login as owner to get session for API seeding
    const loginRes = await request.post(
      "http://localhost:7777/api/admin/v1/auth/login",
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
        },
        data: { email: "owner@example.com", password: "OwnerPass123!" },
      },
    );
    const loginData = await loginRes.json();
    const ownerId = loginData.user.id;
    authorSlug = loginData.user.slug || "e2e-owner";

    // Ensure Default theme is active
    await request.post(
      "http://localhost:7777/api/admin/v1/themes/vibress-default/activate",
      {
        headers: { Origin: "http://localhost:7777" },
      },
    );

    // 2. Create Tag
    const tagRes = await request.post(
      "http://localhost:7777/api/admin/v1/tags",
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
        },
        data: {
          name: `E2E Public Tag ${Date.now()}`,
          slug: `e2e-tag-${Date.now()}`,
        },
      },
    );
    const tagData = await tagRes.json();
    tagSlug = tagData.tag.slug;
    const tagId = tagData.tag.id;

    // 3. Create & Publish Post
    const postRes = await request.post(
      "http://localhost:7777/api/admin/v1/posts",
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
        },
        data: {
          title: "E2E Public Published Post Title",
          slug: `e2e-pub-post-${Date.now()}`,
          excerpt: "An explicit summary excerpt for public post.",
          metaTitle: "SEO Title Override for Post",
          metaDescription: "SEO Description Override for Post",
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
                      text: "Public E2E content body in Vibress Studio.",
                    },
                  ],
                },
              ],
            },
          },
          primaryAuthorId: ownerId,
          tagIds: [tagId],
        },
      },
    );
    const postData = await postRes.json();
    const postId = postData.post.id;
    postSlug = postData.post.slug;

    await request.post(
      `http://localhost:7777/api/admin/v1/posts/${postId}/publish`,
      {
        headers: { Origin: "http://localhost:7777" },
      },
    );

    // 4. Create Draft Post
    const draftRes = await request.post(
      "http://localhost:7777/api/admin/v1/posts",
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
        },
        data: {
          title: "E2E Draft Post Title",
          slug: `e2e-draft-post-${Date.now()}`,
          excerpt: "Draft excerpt",
          content: {
            schema: "vibress-studio",
            version: 1,
            root: { type: "root", children: [] },
          },
          primaryAuthorId: ownerId,
        },
      },
    );
    const draftData = await draftRes.json();
    draftSlug = draftData.post.slug;

    // 5. Create Future Scheduled Post
    const futureDate = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const schedRes = await request.post(
      "http://localhost:7777/api/admin/v1/posts",
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
        },
        data: {
          title: "E2E Scheduled Post Title",
          slug: `e2e-sched-post-${Date.now()}`,
          content: {
            schema: "vibress-studio",
            version: 1,
            root: { type: "root", children: [] },
          },
          primaryAuthorId: ownerId,
        },
      },
    );
    const schedData = await schedRes.json();
    schedSlug = schedData.post.slug;

    await request.post(
      `http://localhost:7777/api/admin/v1/posts/${schedData.post.id}/schedule`,
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
        },
        data: { scheduledAt: futureDate },
      },
    );

    // 6. Create & Publish Page
    const pageRes = await request.post(
      "http://localhost:7777/api/admin/v1/pages",
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
        },
        data: {
          title: "E2E Published Terms Page",
          slug: `e2e-page-${Date.now()}`,
          content: {
            schema: "vibress-studio",
            version: 1,
            root: {
              type: "root",
              children: [
                {
                  type: "paragraph",
                  children: [
                    { type: "text", text: "Terms of service page content." },
                  ],
                },
              ],
            },
          },
          primaryAuthorId: ownerId,
        },
      },
    );
    const pageData = await pageRes.json();
    pageSlug = pageData.page.slug;
    await request.post(
      `http://localhost:7777/api/admin/v1/pages/${pageData.page.id}/publish`,
      {
        headers: { Origin: "http://localhost:7777" },
      },
    );

    // 7. Create Post for Unpublish Test
    const unpubRes = await request.post(
      "http://localhost:7777/api/admin/v1/posts",
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
        },
        data: {
          title: "Post To Unpublish E2E",
          slug: `e2e-unpub-post-${Date.now()}`,
          content: {
            schema: "vibress-studio",
            version: 1,
            root: { type: "root", children: [] },
          },
          primaryAuthorId: ownerId,
        },
      },
    );
    const unpubData = await unpubRes.json();
    unpubPostId = unpubData.post.id;
    unpubPostSlug = unpubData.post.slug;
    await request.post(
      `http://localhost:7777/api/admin/v1/posts/${unpubPostId}/publish`,
      {
        headers: { Origin: "http://localhost:7777" },
      },
    );
  });

  test("[Public Post] Visit published post page & verify SSR HTML, title, content", async ({
    page,
  }) => {
    const res = await page.goto(`http://localhost:7777/posts/${postSlug}`);
    expect(res?.status()).toBe(200);

    await expect(page.locator("h1.article-title")).toContainText(
      "E2E Public Published Post Title",
    );
    await expect(page.locator(".studio-html-content")).toContainText(
      "Public E2E content body in Vibress Studio.",
    );
  });

  test("[SEO Metadata] Inspect document title, meta description, canonical, OG, Twitter & JSON-LD", async ({
    page,
  }) => {
    await page.goto(`http://localhost:7777/posts/${postSlug}`);

    // Title
    expect(await page.title()).toContain("SEO Title Override for Post");

    // Meta description
    const metaDesc = page.locator('meta[name="description"]');
    await expect(metaDesc).toHaveAttribute(
      "content",
      "SEO Description Override for Post",
    );

    // Canonical link
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute(
      "href",
      `http://localhost:7777/posts/${postSlug}`,
    );

    // Open Graph & Twitter
    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toHaveAttribute(
      "content",
      "SEO Title Override for Post",
    );

    const twitterCard = page.locator('meta[name="twitter:card"]');
    await expect(twitterCard).toHaveAttribute("content", "summary");

    // JSON-LD
    const jsonLdScript = page.locator('script[type="application/ld+json"]');
    await expect(jsonLdScript).toBeAttached();
    const jsonText = await jsonLdScript.textContent();
    expect(jsonText).toBeTruthy();

    const parsedLd = JSON.parse(jsonText!);
    expect(parsedLd["@type"]).toBe("BlogPosting");
    expect(parsedLd.headline).toBe("E2E Public Published Post Title");
    expect(parsedLd.mainEntityOfPage["@id"]).toBe(
      `http://localhost:7777/posts/${postSlug}`,
    );
  });

  test("[Draft & Scheduled 404] Draft and scheduled future posts return 404 on Web", async ({
    page,
  }) => {
    const draftRes = await page.goto(
      `http://localhost:7777/posts/${draftSlug}`,
    );
    expect(draftRes?.status()).toBe(404);

    const schedRes = await page.goto(
      `http://localhost:7777/posts/${schedSlug}`,
    );
    expect(schedRes?.status()).toBe(404);
  });

  test("[Unpublish Flow] Published post returns 200 then 404 after unpublish", async ({
    request,
  }) => {
    const initRes = await request.get(
      `http://localhost:7777/posts/${unpubPostSlug}`,
    );
    expect(initRes.status()).toBe(200);

    // Login to obtain session for unpublish API call
    await request.post("http://localhost:7777/api/admin/v1/auth/login", {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });

    // Unpublish via API
    const unpubApiRes = await request.post(
      `http://localhost:7777/api/admin/v1/posts/${unpubPostId}/unpublish`,
      {
        headers: { Origin: "http://localhost:7777" },
      },
    );
    expect(unpubApiRes.status()).toBe(200);

    const unpubRes = await request.get(
      `http://localhost:7777/posts/${unpubPostSlug}`,
    );
    expect(unpubRes.status()).toBe(404);
  });

  test("[Public Page] Visit published page & verify title and content", async ({
    page,
  }) => {
    const res = await page.goto(`http://localhost:7777/pages/${pageSlug}`);
    expect(res?.status()).toBe(200);

    await expect(page.locator("h1.article-title")).toContainText(
      "E2E Published Terms Page",
    );
    await expect(page.locator(".studio-html-content")).toContainText(
      "Terms of service page content.",
    );
  });

  test("[Tag Archive] Visit tag page & verify tagged published posts list", async ({
    page,
  }) => {
    const res = await page.goto(`http://localhost:7777/tags/${tagSlug}`);
    expect(res?.status()).toBe(200);

    await expect(page.locator("h1.article-title")).toContainText(
      "E2E Public Tag",
    );
    await expect(page.locator(".posts-list")).toContainText(
      "E2E Public Published Post Title",
    );
  });

  test("[Author Archive] Visit author page & verify authored published posts list", async ({
    page,
  }) => {
    const res = await page.goto(`http://localhost:7777/authors/${authorSlug}`);
    expect(res?.status()).toBe(200);

    await expect(page.locator(".posts-list")).toContainText(
      "E2E Public Published Post Title",
    );
  });

  test("[Discovery Routes] Verify sitemap.xml, robots.txt, and rss.xml", async ({
    request,
  }) => {
    // 1. Sitemap XML
    const sitemapRes = await request.get("http://localhost:7777/sitemap.xml");
    expect(sitemapRes.status()).toBe(200);
    expect(sitemapRes.headers()["content-type"]).toContain("xml");
    const sitemapXml = await sitemapRes.text();
    expect(sitemapXml).toContain(
      `<loc>http://localhost:7777/posts/${postSlug}</loc>`,
    );
    expect(sitemapXml).toContain(
      `<loc>http://localhost:7777/pages/${pageSlug}</loc>`,
    );
    expect(sitemapXml).not.toContain(draftSlug);
    expect(sitemapXml).not.toContain(schedSlug);

    // 2. Robots TXT
    const robotsRes = await request.get("http://localhost:7777/robots.txt");
    expect(robotsRes.status()).toBe(200);
    const robotsTxt = await robotsRes.text();
    expect(robotsTxt).toContain("Disallow: /admin");
    expect(robotsTxt).toContain("Sitemap: http://localhost:7777/sitemap.xml");

    // 3. RSS XML
    const rssRes = await request.get("http://localhost:7777/rss.xml");
    expect(rssRes.status()).toBe(200);
    expect(rssRes.headers()["content-type"]).toContain("xml");
    const rssXml = await rssRes.text();
    expect(rssXml).toContain(
      `<link>http://localhost:7777/posts/${postSlug}</link>`,
    );
    expect(rssXml).not.toContain(draftSlug);
  });
});
