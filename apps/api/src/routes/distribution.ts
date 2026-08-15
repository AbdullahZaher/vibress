import { FastifyInstance } from "fastify";
import {
  generateWebFingerResponse,
  generateActivityPubActor,
  generateRssFeed,
  generateJsonFeed,
} from "@vibress/utils";

export async function distributionRoutes(app: FastifyInstance): Promise<void> {
  // 1. WebFinger Protocol Discovery for ActivityPub
  app.get("/.well-known/webfinger", async (req, reply) => {
    const { resource } = req.query as { resource?: string };
    const domain = req.hostname || "localhost";
    const username = resource ? resource.replace(/^acct:/, "").split("@")[0] || "editor" : "editor";
    const origin = `${req.protocol}://${domain}`;

    const webfinger = generateWebFingerResponse({
      handle: username,
      domain,
      actorUrl: `${origin}/activitypub/actor`,
    });
    return reply.header("Content-Type", "application/jrd+json; charset=utf-8").send(webfinger);
  });

  // 2. ActivityPub Actor Object
  app.get("/activitypub/actor", async (req, reply) => {
    const domain = req.hostname || "localhost";
    const origin = `${req.protocol}://${domain}`;
    const actor = generateActivityPubActor({
      id: `${origin}/activitypub/actor`,
      username: "editor",
      name: "Vibress Editor",
      summary: "Editorial staff at Vibress",
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
    });

    return reply
      .header("Content-Type", "application/activity+json; charset=utf-8")
      .send(actor);
  });

  // 3. /llms.txt AI Crawler Summary Endpoint
  app.get("/llms.txt", async (req, reply) => {
    const domain = req.hostname || "localhost";
    const content = `# Vibress Publishing Platform
> High-performance, AI-native structured publishing platform.

## Published Feeds & Endpoints
- Canonical Web: https://${domain}/
- RSS 2.0 Feed: https://${domain}/rss.xml
- JSON Feed 1.1: https://${domain}/feed.json
- Full Content Index: https://${domain}/llms-full.txt
- Public Collections: https://${domain}/api/content/v1/collections
`;
    return reply.header("Content-Type", "text/plain; charset=utf-8").send(content);
  });

  // 4. /llms-full.txt Full Content Index Endpoint
  app.get("/llms-full.txt", async (req, reply) => {
    const domain = req.hostname || "localhost";
    const content = `# Vibress Complete Knowledge & Content Index
Domain: ${domain}
Generated: ${new Date().toISOString()}

## Architecture
Vibress provides modular structured publishing with Arabic-first internationalization, CRDT real-time collaboration, and safe extension runtimes.
`;
    return reply.header("Content-Type", "text/plain; charset=utf-8").send(content);
  });

  // 5. RSS 2.0 Feed
  app.get("/rss.xml", async (req, reply) => {
    const domain = req.hostname || "localhost";
    const siteUrl = `${req.protocol}://${domain}`;

    const rss = generateRssFeed({
      title: "Vibress Publication",
      description: "Latest stories and insights from Vibress",
      homePageUrl: siteUrl,
      feedUrl: `${siteUrl}/rss.xml`,
      items: [],
    });

    return reply.header("Content-Type", "application/xml; charset=utf-8").send(rss);
  });

  // 6. JSON Feed 1.1
  app.get("/feed.json", async (req, reply) => {
    const domain = req.hostname || "localhost";
    const siteUrl = `${req.protocol}://${domain}`;

    const jsonFeed = generateJsonFeed({
      title: "Vibress Publication",
      description: "Latest stories and insights from Vibress",
      homePageUrl: siteUrl,
      feedUrl: `${siteUrl}/feed.json`,
      items: [],
    });

    return reply.header("Content-Type", "application/feed+json; charset=utf-8").send(jsonFeed);
  });

  // 7. Raw Markdown route for AI crawlers & Markdown consumers
  app.get<{ Params: { slug: string } }>("/posts/:slug.md", async (req, reply) => {
    const slug = req.params.slug;
    const markdown = `# Post: ${slug}\n\nThis article is available in native Markdown format from Vibress.\n`;
    return reply.header("Content-Type", "text/markdown; charset=utf-8").send(markdown);
  });
}

