import { domainEvents, DomainEvent } from "@vibress/events";
import {
  Queue,
  QUEUE_NAMES,
  enqueueTraced,
  getBullMqRedisConnection,
  AnalyticsQueueJob,
  SearchQueueJob,
} from "@vibress/queue";
import { IngestEventData } from "@vibress/analytics";
import { SearchDocumentInput } from "@vibress/search";
import { DrizzlePostRepository } from "@vibress/posts";
import { DrizzlePageRepository } from "@vibress/pages";
import { DrizzleTagRepository } from "@vibress/tags";
import { renderStudioDocumentToPlainText } from "@vibress/studio-renderer";
import { getSiteUrl } from "./helpers/public-content-helpers";
import { getConfig } from "@vibress/config";

const ANALYTICS_QUEUE = QUEUE_NAMES.ANALYTICS;
const SEARCH_QUEUE = QUEUE_NAMES.SEARCH;

let analyticsQueue: Queue<AnalyticsQueueJob> | null = null;
let searchQueue: Queue<SearchQueueJob> | null = null;

function getAnalyticsQueue(): Queue<AnalyticsQueueJob> {
  if (!analyticsQueue) {
    analyticsQueue = new Queue<AnalyticsQueueJob>(ANALYTICS_QUEUE, {
      connection: getBullMqRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }
  return analyticsQueue;
}

function getSearchQueue(): Queue<SearchQueueJob> {
  if (!searchQueue) {
    searchQueue = new Queue<SearchQueueJob>(SEARCH_QUEUE, {
      connection: getBullMqRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }
  return searchQueue;
}

const TRIGGER_MAP: Record<string, string> = {
  "member.created": "member.signup",
  "subscription.activated": "subscription.started",
  "subscription.cancelled": "subscription.cancelled",
  "newsletter.sent": "newsletter.sent",
  "comment.created": "comment.created",
  "recommendation.clicked": "recommendation.clicked",
};

/**
 * Async side-effect bridge. Analytics/search ingestion must never block or
 * break core operations — failures are swallowed (logged) and dropped.
 */
export function startAsyncBridge(): void {
  // ---------------- Analytics ingestion ----------------
  for (const [domainEvent, analyticsEvent] of Object.entries(TRIGGER_MAP)) {
    domainEvents.on(domainEvent, (event: DomainEvent) => {
      const payload = (event.payload || {}) as Record<string, unknown>;
      const analyticsData: IngestEventData = {
        eventId: `${domainEvent}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        eventName: analyticsEvent,
        occurredAt: event.timestamp || new Date(),
        actorType: typeof payload.memberId === "string" ? "member" : null,
        actorId: typeof payload.memberId === "string" ? payload.memberId : null,
        entityType: inferEntityType(domainEvent),
        entityId:
          typeof payload.entityId === "string"
            ? payload.entityId
            : typeof payload.postId === "string"
              ? payload.postId
              : null,
        properties: sanitizeForAnalytics(payload),
      };
      const pubId = (payload.publicationId as string) || "pub_default";
      analyticsData.publicationId = pubId;
      enqueueTraced(getAnalyticsQueue(), "ingest", {
        scope: "publication",
        publicationId: pubId,
        event: analyticsData,
      }).catch(() => undefined);
    });
  }

  // ---------------- Search indexing ----------------
  // EVENT_DELIVERY_MODE=direct opts into the legacy in-process relay. The
  // default (outbox) mode delivers search events durably via the worker's
  // outbox dispatcher; registering here would duplicate relay work.
  if (getConfig().outbox.deliveryMode === "direct") {
    domainEvents.on("post.published", (event: DomainEvent) => {
      const payload = (event.payload || {}) as Record<string, unknown>;
      const postId = payload.postId;
      const title = typeof payload.title === "string" ? payload.title : "";
      const slug = typeof payload.slug === "string" ? payload.slug : "";
      const pubId = (payload.publicationId as string) || "pub_default";
      if (typeof postId === "string") {
        enqueueTraced(getSearchQueue(), "index", {
          scope: "publication",
          publicationId: pubId,
          op: "upsert",
          doc: { entityType: "post", entityId: postId, title, slug, publicationId: pubId },
        }).catch(() => undefined);
      }
    });
    domainEvents.on("post.unpublished", (event: DomainEvent) => {
      const payload = (event.payload || {}) as Record<string, unknown>;
      const postId = payload.postId;
      const pubId = (payload.publicationId as string) || "pub_default";
      if (typeof postId === "string") {
        enqueueTraced(getSearchQueue(), "remove", {
          scope: "publication",
          publicationId: pubId,
          op: "remove",
          entityType: "post",
          entityId: postId,
        }).catch(() => undefined);
      }
    });
    domainEvents.on("post.deleted", (event: DomainEvent) => {
      const payload = (event.payload || {}) as Record<string, unknown>;
      const postId = payload.postId;
      const pubId = (payload.publicationId as string) || "pub_default";
      if (typeof postId === "string") {
        enqueueTraced(getSearchQueue(), "remove", {
          scope: "publication",
          publicationId: pubId,
          op: "remove",
          entityType: "post",
          entityId: postId,
        }).catch(() => undefined);
      }
    });
  }
}

export async function enqueueSearchRebuild(publicationId?: string): Promise<void> {
  const pubId = publicationId || "pub_default";
  await enqueueTraced(getSearchQueue(), "rebuild", {
    scope: "publication",
    publicationId: pubId,
    op: "rebuild",
  });
}

export async function enqueueSearchUpsert(
  doc: SearchDocumentInput,
): Promise<void> {
  const pubId = doc.publicationId || "pub_default";
  await enqueueTraced(getSearchQueue(), "index", {
    scope: "publication",
    publicationId: pubId,
    op: "upsert",
    doc: { ...doc, publicationId: pubId },
  });
}

function inferEntityType(eventName: string): string | null {
  if (eventName.startsWith("post")) return "post";
  if (eventName.startsWith("page")) return "page";
  if (eventName.startsWith("subscription")) return "subscription";
  if (eventName.startsWith("newsletter")) return "newsletter";
  if (eventName.startsWith("comment")) return "comment";
  if (eventName.startsWith("recommendation")) return "recommendation";
  return null;
}

/**
 * PII minimization: only allowlist scalar properties; drop emails, tokens,
 * and nested objects. Values are length-bounded.
 */
function sanitizeForAnalytics(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const ALLOWED_KEYS = [
    "memberId",
    "postId",
    "productId",
    "planId",
    "sendId",
    "newsletterId",
    "commentId",
    "recommendationId",
    "status",
  ];
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    const value = payload[key];
    if (typeof value === "string") out[key] = value.slice(0, 100);
    else if (typeof value === "number") out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/**
 * Content source for the search index rebuild: only published, public
 * posts/pages/tags are indexed. Restricted content is never indexed.
 */
import { getDb, contentTranslations, eq, and } from "@vibress/database";
import { publicationLocaleService } from "./services";
import {
  canonicalPublicationLocale,
  PublicationLocaleConfiguration,
} from "@vibress/settings";

export class SearchRebuildContentSource {
  private postRepo = new DrizzlePostRepository();
  private pageRepo = new DrizzlePageRepository();
  private tagRepo = new DrizzleTagRepository();

  async listIndexableContent(publicationId?: string): Promise<SearchDocumentInput[]> {
    const docs: SearchDocumentInput[] = [];
    const siteUrl = getSiteUrl();
    const db = getDb();

    const configCache = new Map<string, PublicationLocaleConfiguration>();
    const getLocaleConfig = async (pubId?: string | null): Promise<PublicationLocaleConfiguration> => {
      const targetId = pubId || publicationId || "pub_default";
      const cached = configCache.get(targetId);
      if (cached) return cached;
      const config = await publicationLocaleService.getConfiguration(targetId);
      configCache.set(targetId, config);
      return config;
    };

    // Upfront fail-closed verification of target publication locale configuration
    if (publicationId) {
      await getLocaleConfig(publicationId);
    }

    // Posts: published + public only
    const { posts } = await this.postRepo.list({
      publishedOnly: true,
      limit: 10000,
      ...(publicationId ? { publicationId } : {}),
    });
    for (const post of posts) {
      if (post.visibility !== "public") continue;
      const config = await getLocaleConfig(post.publicationId);
      const postLocale = config.primaryLocale;
      const bodyText = renderStudioDocumentToPlainText(post.content).slice(
        0,
        2000,
      );
      docs.push({
        entityType: "post",
        entityId: post.id,
        locale: postLocale,
        title: post.title,
        bodyText,
        slug: post.slug,
        url: `${siteUrl}/posts/${post.slug}`,
        publicationId: post.publicationId,
      });

      // Index published translations for this post
      const postTranslations = await db
        .select()
        .from(contentTranslations)
        .where(
          and(
            eq(contentTranslations.contentType, "post"),
            eq(contentTranslations.contentId, post.id),
            eq(contentTranslations.status, "published"),
            ...(publicationId ? [eq(contentTranslations.publicationId, publicationId)] : []),
          ),
        );

      for (const tr of postTranslations) {
        const canonicalLocale = canonicalPublicationLocale(tr.targetLocale);
        if (!config.enabledLocales.includes(canonicalLocale)) continue;
        docs.push({
          entityType: "post",
          entityId: post.id,
          locale: canonicalLocale,
          title: tr.title,
          bodyText: renderStudioDocumentToPlainText(
            tr.content as unknown as Parameters<typeof renderStudioDocumentToPlainText>[0],
          ).slice(0, 2000),
          slug: tr.slug,
          url: `${siteUrl}/${canonicalLocale}/posts/${tr.slug}`,
          publicationId: tr.publicationId,
        });
      }
    }

    // Pages: published + public only
    const { pages } = await this.pageRepo.list({
      publishedOnly: true,
      limit: 10000,
      ...(publicationId ? { publicationId } : {}),
    });
    for (const page of pages) {
      if (page.visibility !== "public") continue;
      const config = await getLocaleConfig(page.publicationId);
      const pageLocale = config.primaryLocale;
      const bodyText = renderStudioDocumentToPlainText(page.content).slice(
        0,
        2000,
      );
      docs.push({
        entityType: "page",
        entityId: page.id,
        locale: pageLocale,
        title: page.title,
        bodyText,
        slug: page.slug,
        url: `${siteUrl}/${page.slug}`,
        publicationId: page.publicationId,
      });

      // Index published translations for this page
      const pageTranslations = await db
        .select()
        .from(contentTranslations)
        .where(
          and(
            eq(contentTranslations.contentType, "page"),
            eq(contentTranslations.contentId, page.id),
            eq(contentTranslations.status, "published"),
            ...(publicationId ? [eq(contentTranslations.publicationId, publicationId)] : []),
          ),
        );

      for (const tr of pageTranslations) {
        const canonicalLocale = canonicalPublicationLocale(tr.targetLocale);
        if (!config.enabledLocales.includes(canonicalLocale)) continue;
        docs.push({
          entityType: "page",
          entityId: page.id,
          locale: canonicalLocale,
          title: tr.title,
          bodyText: renderStudioDocumentToPlainText(
            tr.content as unknown as Parameters<typeof renderStudioDocumentToPlainText>[0],
          ).slice(0, 2000),
          slug: tr.slug,
          url: `${siteUrl}/${canonicalLocale}/pages/${tr.slug}`,
          publicationId: tr.publicationId,
        });
      }
    }

    // Tags
    const tags = await this.tagRepo.listAll(publicationId);
    for (const tag of tags) {
      const config = await getLocaleConfig(tag.publicationId);
      docs.push({
        entityType: "tag",
        entityId: tag.id,
        locale: config.primaryLocale,
        title: tag.name,
        slug: tag.slug,
        url: `${siteUrl}/tags/${tag.slug}`,
        publicationId: tag.publicationId,
      });
    }

    return docs;
  }
}
