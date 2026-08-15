import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findDueScheduledPosts: vi.fn(),
  publishPost: vi.fn(),
  findDueScheduledPages: vi.fn(),
  publishPage: vi.fn(),
}));

vi.mock("@vibress/posts", () => ({
  DrizzlePostRepository: class {},
  PostsService: class {
    findDueScheduledPosts = mocks.findDueScheduledPosts;
    publishPost = mocks.publishPost;
  },
}));

vi.mock("@vibress/pages", () => ({
  DrizzlePageRepository: class {},
  PagesService: class {
    findDueScheduledPages = mocks.findDueScheduledPages;
    publishPage = mocks.publishPage;
  },
}));

vi.mock("@vibress/revisions", () => ({
  DrizzleRevisionRepository: class {},
  RevisionsService: class {},
}));

vi.mock("@vibress/authors", () => ({
  DrizzleAuthorRepository: class {},
}));

vi.mock("@vibress/audit", () => ({
  DrizzleAuditRepository: class {},
}));

import { ContentSchedulerWorker } from "../src/scheduler";

describe("ContentSchedulerWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes due scheduled posts and pages during sweep", async () => {
    mocks.findDueScheduledPosts.mockResolvedValue([
      { id: "post-1", title: "Scheduled Post 1", primaryAuthorId: "author-1" },
      { id: "post-2", title: "Scheduled Post 2", primaryAuthorId: "author-2" },
    ]);
    mocks.findDueScheduledPages.mockResolvedValue([
      { id: "page-1", title: "Scheduled Page 1", primaryAuthorId: "author-1" },
    ]);
    mocks.publishPost.mockResolvedValue({});
    mocks.publishPage.mockResolvedValue({});

    const worker = new ContentSchedulerWorker();
    const result = await worker.runReconciliationSweep();

    expect(result.publishedPostsCount).toBe(2);
    expect(result.publishedPagesCount).toBe(1);
    expect(mocks.publishPost).toHaveBeenCalledWith("post-1", "author-1");
    expect(mocks.publishPost).toHaveBeenCalledWith("post-2", "author-2");
    expect(mocks.publishPage).toHaveBeenCalledWith("page-1", "author-1");
  });

  it("handles errors gracefully without crashing the sweep", async () => {
    mocks.findDueScheduledPosts.mockResolvedValue([
      { id: "post-err", title: "Failing Post", primaryAuthorId: "author-1" },
    ]);
    mocks.findDueScheduledPages.mockResolvedValue([]);
    mocks.publishPost.mockRejectedValue(new Error("Database lock conflict"));

    const worker = new ContentSchedulerWorker();
    const result = await worker.runReconciliationSweep();

    expect(result.publishedPostsCount).toBe(0);
    expect(mocks.publishPost).toHaveBeenCalledTimes(1);
  });
});
