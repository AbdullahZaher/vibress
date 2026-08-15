import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../main";

describe("Distribution, GEO & Social Web Endpoints", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves ActivityPub WebFinger discovery on /.well-known/webfinger", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/.well-known/webfinger?resource=acct:editor@vibress.local",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.subject).toBe("acct:editor@localhost");
    expect(body.links).toBeDefined();
    expect(body.links[0]?.rel).toBe("self");
    expect(body.links[0]?.type).toBe("application/activity+json");
  });

  it("serves ActivityPub Actor object on /activitypub/actor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/activitypub/actor",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.type).toBe("Person");
    expect(body.preferredUsername).toBe("editor");
    expect(body.inbox).toBeDefined();
    expect(body.outbox).toBeDefined();
    expect(body.publicKey).toBeDefined();
  });

  it("serves AI crawler discovery markdown on /llms.txt and /llms-full.txt", async () => {
    const resShort = await app.inject({ method: "GET", url: "/llms.txt" });
    expect(resShort.statusCode).toBe(200);
    expect(resShort.body).toContain("# Vibress Publishing Platform");
    expect(resShort.body).toContain("/llms-full.txt");

    const resFull = await app.inject({ method: "GET", url: "/llms-full.txt" });
    expect(resFull.statusCode).toBe(200);
    expect(resFull.body).toContain("# Vibress Complete Knowledge & Content Index");
  });

  it("serves standard RSS 2.0 XML on /rss.xml", async () => {
    const res = await app.inject({ method: "GET", url: "/rss.xml" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.body).toContain("<rss version=\"2.0\"");
    expect(res.body).toContain("Vibress Publication");
  });

  it("serves JSON Feed 1.1 on /feed.json", async () => {
    const res = await app.inject({ method: "GET", url: "/feed.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/feed+json");
    const feed = JSON.parse(res.body);
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.title).toBe("Vibress Publication");
  });

  it("serves raw markdown on /posts/:slug.md", async () => {
    const res = await app.inject({ method: "GET", url: "/posts/my-story.md" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.body).toContain("# Post: my-story");
  });
});

