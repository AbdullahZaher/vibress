import { DrizzlePostRepository, PostsService } from '@vibress/posts';
import { DrizzlePageRepository, PagesService } from '@vibress/pages';
import { DrizzleRevisionRepository, RevisionsService } from '@vibress/revisions';
import { DrizzleAuthorRepository } from '@vibress/authors';
import { DrizzleAuditRepository } from '@vibress/audit';

export class ContentSchedulerWorker {
  private postsService: PostsService;
  private pagesService: PagesService;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    const postRepo = new DrizzlePostRepository();
    const pageRepo = new DrizzlePageRepository();
    const revisionRepo = new DrizzleRevisionRepository();
    const authorRepo = new DrizzleAuthorRepository();
    const auditRepo = new DrizzleAuditRepository();

    const revisionsService = new RevisionsService(revisionRepo);
    this.postsService = new PostsService(postRepo, revisionsService, authorRepo, auditRepo);
    this.pagesService = new PagesService(pageRepo, revisionsService, authorRepo, auditRepo);
  }

  async runReconciliationSweep(): Promise<{ publishedPostsCount: number; publishedPagesCount: number }> {
    const now = new Date();
    let publishedPostsCount = 0;
    let publishedPagesCount = 0;

    // 1. Process due posts
    try {
      const duePosts = await this.postsService.findDueScheduledPosts(now);
      for (const post of duePosts) {
        try {
          const actorId = post.updatedBy || post.primaryAuthorId;
          await this.postsService.publishPost(post.id, actorId);
          publishedPostsCount++;
          console.log(`[Scheduler] Automatically published post ${post.id} ("${post.title}")`);
        } catch (err) {
          console.error(`[Scheduler] Failed to publish post ${post.id}:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error fetching due posts:', err instanceof Error ? err.message : err);
    }

    // 2. Process due pages
    try {
      const duePages = await this.pagesService.findDueScheduledPages(now);
      for (const page of duePages) {
        try {
          const actorId = page.updatedBy || page.primaryAuthorId;
          await this.pagesService.publishPage(page.id, actorId);
          publishedPagesCount++;
          console.log(`[Scheduler] Automatically published page ${page.id} ("${page.title}")`);
        } catch (err) {
          console.error(`[Scheduler] Failed to publish page ${page.id}:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error fetching due pages:', err instanceof Error ? err.message : err);
    }

    return { publishedPostsCount, publishedPagesCount };
  }

  start(intervalMs = 5000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Run initial sweep immediately
    this.runReconciliationSweep().catch(err => console.error('[Scheduler] Initial sweep failed:', err));

    this.intervalTimer = setInterval(() => {
      this.runReconciliationSweep().catch(err => console.error('[Scheduler] Sweep error:', err));
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.isRunning = false;
  }
}
