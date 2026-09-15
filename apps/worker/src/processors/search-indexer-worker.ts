import {
  Worker,
  Job,
  QUEUE_NAMES,
  getBullMqRedisConnection,
  assertJobScope,
} from "@vibress/queue";
import {
  SearchService,
  DrizzleSearchRepository,
  SearchDocumentInput,
} from "@vibress/search";
import { DrizzlePostRepository } from "@vibress/posts";
import { DrizzlePageRepository } from "@vibress/pages";
import { renderStudioDocumentToPlainText } from "@vibress/studio-renderer";
import { tracedProcessor } from "./trace-helper";

export interface SearchIndexJob {
  scope?: "publication" | "system";
  publicationId?: string;
  op: "upsert" | "remove";
  doc?: SearchDocumentInput;
  entityType?: string;
  entityId?: string;
  traceparent?: string;
}

export interface SearchRebuildJob {
  scope?: "publication" | "system";
  publicationId?: string;
  op: "rebuild";
  traceparent?: string;
}

export interface IndexableContentProvider {
  listIndexableContent(publicationId?: string): Promise<SearchDocumentInput[]>;
}

const SEARCH_QUEUE_NAME = QUEUE_NAMES.SEARCH;

/**
 * Event-driven indexer: publish → upsert, unpublish/delete → remove,
 * full rebuild on demand. Jobs are idempotent (upsert/remove are upserts).
 * Defense in depth: every upsert re-verifies the entity is published AND
 * public before indexing — restricted content is never searchable.
 */
export class SearchIndexerWorker {
  private worker: Worker<SearchIndexJob | SearchRebuildJob> | null = null;
  private searchService = new SearchService(new DrizzleSearchRepository());
  private postRepo = new DrizzlePostRepository();
  private pageRepo = new DrizzlePageRepository();
  private contentProvider: IndexableContentProvider;

  constructor(contentProvider: IndexableContentProvider) {
    this.contentProvider = contentProvider;
  }

  async start(): Promise<void> {
    this.worker = new Worker<SearchIndexJob | SearchRebuildJob>(
      SEARCH_QUEUE_NAME,
      tracedProcessor("worker.job.search", (job) => this.process(job)),
      { connection: getBullMqRedisConnection(), concurrency: 1 },
    );
    this.worker.on("failed", (job, err) => {
      console.error(`[SearchIndexer] Job ${job?.id} failed:`, err.message);
    });
  }

  private async process(
    job: Job<SearchIndexJob | SearchRebuildJob>,
  ): Promise<void> {
    const scope = assertJobScope(job.data);
    const pubId = scope.scope === "publication" ? scope.publicationId : undefined;

    if (job.data.op === "rebuild") {
      const count = await this.searchService.rebuild(this.contentProvider, pubId);
      console.log(
        `[SearchIndexer] Rebuild complete: ${count} documents indexed${pubId ? ` (pub: ${pubId})` : ""}`,
      );
      return;
    }
    if (job.data.op === "upsert" && job.data.doc) {
      const docPubId = pubId || job.data.doc.publicationId || "pub_default";
      // Verify the entity is published + public before indexing
      const verified = await this.resolveVerifiedDoc({
        ...job.data.doc,
        publicationId: docPubId,
      });
      if (verified) {
        await this.searchService.indexDocument(verified, docPubId);
      } else {
        // Not indexable — ensure any stale entry is removed
        await this.searchService.removeDocument(
          job.data.doc.entityType,
          job.data.doc.entityId,
          docPubId,
        );
      }
      return;
    }
    if (job.data.op === "remove" && job.data.entityType && job.data.entityId) {
      await this.searchService.removeDocument(
        job.data.entityType,
        job.data.entityId,
        pubId,
      );
    }
  }

  private async resolveVerifiedDoc(
    doc: SearchDocumentInput,
  ): Promise<SearchDocumentInput | null> {
    const pubId = doc.publicationId;
    if (doc.entityType === "post") {
      const post = await this.postRepo.findById(doc.entityId, pubId);
      if (!post || post.status !== "published" || post.visibility !== "public")
        return null;
      return {
        entityType: "post",
        entityId: post.id,
        title: post.title,
        bodyText: renderStudioDocumentToPlainText(post.content).slice(0, 2000),
        slug: post.slug,
        url: doc.url || `/posts/${post.slug}`,
        publicationId: post.publicationId,
      };
    }
    if (doc.entityType === "page") {
      const page = await this.pageRepo.findById(doc.entityId, pubId);
      if (!page || page.status !== "published" || page.visibility !== "public")
        return null;
      return {
        entityType: "page",
        entityId: page.id,
        title: page.title,
        bodyText: renderStudioDocumentToPlainText(page.content).slice(0, 2000),
        slug: page.slug,
        url: doc.url || `/${page.slug}`,
        publicationId: page.publicationId,
      };
    }
    // Tags and authors: trusted metadata, no restriction concept
    return doc;
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}

export { SEARCH_QUEUE_NAME };
