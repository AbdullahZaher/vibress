import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../content-api-client", () => ({
  ContentApiClient: {
    getPosts: vi.fn().mockResolvedValue({
      posts: [
        {
          id: "post-1",
          title: "First Post & More",
          slug: "first-post",
          excerpt: "Excerpt with <tags> & symbols",
          publishedAt: "2026-08-15T12:00:00.000Z",
        },
      ],
      total: 1,
    }),
  },
}));

import { generateRssFeed } from "../rss";

describe("RSS Feed Generator", () => {
  beforeEach(() => {
    process.env.SITE_URL = "https://vibress.example.com";
    process.env.SITE_NAME = "Vibress Publication";
    process.env.SITE_DESCRIPTION = "Cutting-edge journalism";
  });

  it("generates compliant XML feed with escaped special characters", async () => {
    const res = await generateRssFeed();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");

    const xml = await res.text();
    expect(xml).toContain("<title>First Post &amp; More</title>");
    expect(xml).toContain("<link>https://vibress.example.com/posts/first-post</link>");
    expect(xml).toContain("<description>Excerpt with &lt;tags&gt; &amp; symbols</description>");
    expect(xml).toContain("<title>Vibress Publication</title>");
  });
});
