import { domainEvents } from '@vibress/events';
import { Queue, QUEUE_NAMES, getBullMqRedisConnection } from '@vibress/queue';
import { IngestEventData } from '@vibress/analytics';
import { SearchDocumentInput } from '@vibress/search';
import { DrizzlePostRepository } from '@vibress/posts';
import { DrizzlePageRepository } from '@vibress/pages';
import { DrizzleTagRepository } from '@vibress/tags';
import { renderStudioDocumentToPlainText } from '@vibress/studio-renderer';
import { getSiteUrl } from './helpers/public-content-helpers';
import { automationsService } from './services';
import { getConfig } from '@vibress/config';

const ANALYTICS_QUEUE = QUEUE_NAMES.ANALYTICS;
const SEARCH_QUEUE = QUEUE_NAMES.SEARCH;

interface AnalyticsQueueJob { event: IngestEventData }
interface SearchQueueJob {
  op: 'upsert' | 'remove' | 'rebuild';
  doc?: SearchDocumentInput;
  entityType?: string;
  entityId?: string;
}

let analyticsQueue: Queue<AnalyticsQueueJob> | null = null;
let searchQueue: Queue<SearchQueueJob> | null = null;

function getAnalyticsQueue(): Queue<AnalyticsQueueJob> {
  if (!analyticsQueue) {
    analyticsQueue = new Queue<AnalyticsQueueJob>(ANALYTICS_QUEUE, {
      connection: getBullMqRedisConnection(),
      defaultJobOptions: { attempts: 3, removeOnComplete: 500, removeOnFail: 1000 },
    });
  }
  return analyticsQueue;
}

function getSearchQueue(): Queue<SearchQueueJob> {
  if (!searchQueue) {
    searchQueue = new Queue<SearchQueueJob>(SEARCH_QUEUE, {
      connection: getBullMqRedisConnection(),
      defaultJobOptions: { attempts: 3, removeOnComplete: 500, removeOnFail: 1000 },
    });
  }
  return searchQueue;
}

const TRIGGER_MAP: Record<string, string> = {
  'member.created': 'member.signup',
  'subscription.activated': 'subscription.started',
  'subscription.cancelled': 'subscription.cancelled',
  'newsletter.sent': 'newsletter.sent',
  'comment.created': 'comment.created',
  'recommendation.clicked': 'recommendation.clicked',
};

/**
 * Async side-effect bridge. Analytics/search ingestion must never block or
 * break core operations — failures are swallowed (logged) and dropped.
 */
export function startAsyncBridge(): void {
  // ---------------- Analytics ingestion ----------------
  for (const [domainEvent, analyticsEvent] of Object.entries(TRIGGER_MAP)) {
    domainEvents.on(domainEvent, (event: any) => {
      const payload = event.payload || {};
      const analyticsData: IngestEventData = {
        eventId: `${domainEvent}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        eventName: analyticsEvent,
        occurredAt: event.timestamp || new Date(),
        actorType: typeof payload.memberId === 'string' ? 'member' : null,
        actorId: typeof payload.memberId === 'string' ? payload.memberId : null,
        entityType: inferEntityType(domainEvent),
        entityId: typeof payload.entityId === 'string' ? payload.entityId : (typeof payload.postId === 'string' ? payload.postId : null),
        properties: sanitizeForAnalytics(payload),
      };
      getAnalyticsQueue().add('ingest', { event: analyticsData }).catch(() => undefined);
    });
  }

  // ---------------- Search indexing ----------------
  // EVENT_DELIVERY_MODE=direct opts into the legacy in-process relay. The
  // default (outbox) mode delivers search events durably via the worker's
  // outbox dispatcher; registering here would duplicate relay work.
  if (getConfig().outbox.deliveryMode === 'direct') {
    domainEvents.on('post.published', (event: any) => {
      const postId = event.payload?.postId;
      if (postId) {
        getSearchQueue().add('index', { op: 'upsert', doc: { entityType: 'post', entityId: postId, title: event.payload?.title || '', slug: event.payload?.slug || '' } }).catch(() => undefined);
      }
    });
    domainEvents.on('post.unpublished', (event: any) => {
      const postId = event.payload?.postId;
      if (postId) {
        getSearchQueue().add('remove', { op: 'remove', entityType: 'post', entityId: postId }).catch(() => undefined);
      }
    });
    domainEvents.on('post.deleted', (event: any) => {
      const postId = event.payload?.postId;
      if (postId) {
        getSearchQueue().add('remove', { op: 'remove', entityType: 'post', entityId: postId }).catch(() => undefined);
      }
    });
  }

  // ---------------- Automations ----------------
  for (const trigger of ['member.created', 'subscription.activated', 'subscription.cancelled', 'newsletter.sent', 'comment.created']) {
    domainEvents.on(trigger, (event: any) => {
      automationsService.handleEvent(trigger, event.payload || {})
        .catch((err: unknown) => console.error(`[AutomationBridge] ${trigger} dispatch failed:`, err instanceof Error ? err.message : String(err)));
    });
  }
}

export async function enqueueSearchRebuild(): Promise<void> {
  await getSearchQueue().add('rebuild', { op: 'rebuild' });
}

export async function enqueueSearchUpsert(doc: SearchDocumentInput): Promise<void> {
  await getSearchQueue().add('index', { op: 'upsert', doc });
}

function inferEntityType(eventName: string): string | null {
  if (eventName.startsWith('post')) return 'post';
  if (eventName.startsWith('page')) return 'page';
  if (eventName.startsWith('subscription')) return 'subscription';
  if (eventName.startsWith('newsletter')) return 'newsletter';
  if (eventName.startsWith('comment')) return 'comment';
  if (eventName.startsWith('recommendation')) return 'recommendation';
  return null;
}

/**
 * PII minimization: only allowlist scalar properties; drop emails, tokens,
 * and nested objects. Values are length-bounded.
 */
function sanitizeForAnalytics(payload: Record<string, unknown>): Record<string, unknown> {
  const ALLOWED_KEYS = ['memberId', 'postId', 'productId', 'planId', 'sendId', 'newsletterId', 'commentId', 'recommendationId', 'status'];
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    const value = payload[key];
    if (typeof value === 'string') out[key] = value.slice(0, 100);
    else if (typeof value === 'number') out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/**
 * Content source for the search index rebuild: only published, public
 * posts/pages/tags are indexed. Restricted content is never indexed.
 */
export class SearchRebuildContentSource {
  private postRepo = new DrizzlePostRepository();
  private pageRepo = new DrizzlePageRepository();
  private tagRepo = new DrizzleTagRepository();

  async listIndexableContent(): Promise<SearchDocumentInput[]> {
    const docs: SearchDocumentInput[] = [];
    const siteUrl = getSiteUrl();

    // Posts: published + public only
    const { posts } = await this.postRepo.list({ publishedOnly: true, limit: 10000 });
    for (const post of posts) {
      if (post.visibility !== 'public') continue;
      const bodyText = renderStudioDocumentToPlainText(post.content).slice(0, 2000);
      docs.push({
        entityType: 'post',
        entityId: post.id,
        title: post.title,
        bodyText,
        slug: post.slug,
        url: `${siteUrl}/posts/${post.slug}`,
      });
    }

    // Pages: published + public only
    const { pages } = await this.pageRepo.list({ publishedOnly: true, limit: 10000 });
    for (const page of pages) {
      if (page.visibility !== 'public') continue;
      const bodyText = renderStudioDocumentToPlainText(page.content).slice(0, 2000);
      docs.push({
        entityType: 'page',
        entityId: page.id,
        title: page.title,
        bodyText,
        slug: page.slug,
        url: `${siteUrl}/${page.slug}`,
      });
    }

    // Tags
    const tags = await this.tagRepo.listAll();
    for (const tag of tags) {
      docs.push({
        entityType: 'tag',
        entityId: tag.id,
        title: tag.name,
        slug: tag.slug,
        url: `${siteUrl}/tags/${tag.slug}`,
      });
    }

    return docs;
  }
}
