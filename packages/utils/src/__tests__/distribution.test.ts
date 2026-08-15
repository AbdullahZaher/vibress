import { describe, it, expect } from "vitest";
import {
  generateArticleJsonLd,
  generateBreadcrumbsJsonLd,
  generateRssFeed,
  generateJsonFeed,
  generateWebFingerResponse,
  generateActivityPubActor,
} from "../index";

describe("Distribution, GEO & Social Web Tools", () => {
  it("generates valid Schema.org Article JSON-LD", () => {
    const jsonLd = generateArticleJsonLd({
      title: "Building Modern Publishing Systems",
      url: "https://publication.com/posts/modern-publishing",
      description: "A deep dive into architecture and headless CMS.",
      datePublished: "2026-08-15T12:00:00Z",
      authorName: "Jane Doe",
      publisherName: "Tech Times",
    });

    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("Article");
    expect(jsonLd.headline).toBe("Building Modern Publishing Systems");
    expect((jsonLd.author as { name: string }).name).toBe("Jane Doe");
  });

  it("generates valid Schema.org BreadcrumbList JSON-LD", () => {
    const breadcrumbs = generateBreadcrumbsJsonLd([
      { name: "Home", url: "https://publication.com" },
      { name: "Tech", url: "https://publication.com/tag/tech" },
      { name: "Article", url: "https://publication.com/posts/item" },
    ]);

    expect(breadcrumbs["@type"]).toBe("BreadcrumbList");
    expect(Array.isArray(breadcrumbs.itemListElement)).toBe(true);
    expect((breadcrumbs.itemListElement as unknown[]).length).toBe(3);
  });

  it("generates valid RSS 2.0 XML with enclosures and Dublin Core tags", () => {
    const xml = generateRssFeed({
      title: "Tech Times Feed",
      description: "Latest news",
      homePageUrl: "https://publication.com",
      feedUrl: "https://publication.com/rss",
      items: [
        {
          id: "item-1",
          title: "First Post",
          url: "https://publication.com/posts/first",
          summary: "Introduction",
          contentHtml: "<p>Full content</p>",
          datePublished: new Date("2026-08-15T10:00:00Z"),
          authorName: "Jane Doe",
        },
      ],
    });

    expect(xml).toContain("<rss version=\"2.0\"");
    expect(xml).toContain("<title><![CDATA[Tech Times Feed]]></title>");
    expect(xml).toContain("<title><![CDATA[First Post]]></title>");
    expect(xml).toContain("<dc:creator><![CDATA[Jane Doe]]></dc:creator>");
  });

  it("generates valid JSON Feed v1.1", () => {
    const jsonFeed = generateJsonFeed({
      title: "Tech Times",
      description: "Latest news",
      homePageUrl: "https://publication.com",
      feedUrl: "https://publication.com/feed.json",
      items: [
        {
          id: "item-1",
          title: "First Post",
          url: "https://publication.com/posts/first",
          datePublished: new Date("2026-08-15T10:00:00Z"),
        },
      ],
    });

    expect(jsonFeed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(Array.isArray(jsonFeed.items)).toBe(true);
    expect((jsonFeed.items as unknown[]).length).toBe(1);
  });

  it("generates standard ActivityPub WebFinger and Actor records", () => {
    const webfinger = generateWebFingerResponse({
      handle: "editor",
      domain: "publication.com",
      actorUrl: "https://publication.com/users/editor",
    });

    expect(webfinger.subject).toBe("acct:editor@publication.com");

    const actor = generateActivityPubActor({
      id: "https://publication.com/users/editor",
      username: "editor",
      name: "Editor in Chief",
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END PUBLIC KEY-----",
    });

    expect(actor.type).toBe("Person");
    expect(actor.inbox).toBe("https://publication.com/users/editor/inbox");
  });

  it("builds ActivityPub Delete activity with Tombstone object", async () => {
    const { buildActivityPubDelete } = await import("../distribution/activitypub");
    const del = buildActivityPubDelete({
      id: "https://publication.com/activities/del-1",
      actorId: "https://publication.com/users/editor",
      objectId: "https://publication.com/posts/old-post",
    });

    expect(del.type).toBe("Delete");
    expect((del.object as { type: string }).type).toBe("Tombstone");
    expect((del.object as { id: string }).id).toBe("https://publication.com/posts/old-post");
  });

  it("enforces ActivityPub payload size limits and blocks restricted federated domains", async () => {
    const { validateActivityPubPayloadSize, isDomainBlocked } = await import("../distribution/activitypub");

    const smallPayload = { type: "Note", content: "Hello fediverse" };
    const checkValid = validateActivityPubPayloadSize(smallPayload, 1024);
    expect(checkValid.valid).toBe(true);

    const hugePayload = { type: "Note", content: "A".repeat(2000) };
    const checkTooLarge = validateActivityPubPayloadSize(hugePayload, 1024);
    expect(checkTooLarge.valid).toBe(false);
    expect(checkTooLarge.error).toContain("exceeds maximum limit");

    const blockedList = ["spam-instance.xyz", "malicious.net"];
    expect(isDomainBlocked("https://spam-instance.xyz/users/bot", blockedList)).toBe(true);
    expect(isDomainBlocked("https://sub.spam-instance.xyz/users/bot", blockedList)).toBe(true);
    expect(isDomainBlocked("https://mastodon.social/users/legit", blockedList)).toBe(false);
  });
});
