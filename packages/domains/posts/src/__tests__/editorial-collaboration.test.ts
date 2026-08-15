import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorialCollaborationService } from "../application/editorial-collaboration-service";

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock("@vibress/database", () => ({
  getDb: () => mockDb,
  editorialComments: {
    id: "id",
    postId: "post_id",
    authorId: "author_id",
    body: "body",
    blockId: "block_id",
    status: "status",
    resolvedBy: "resolved_by",
    resolvedAt: "resolved_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  editorialSuggestions: {
    id: "id",
    postId: "post_id",
    authorId: "author_id",
    originalText: "original_text",
    suggestedText: "suggested_text",
    blockId: "block_id",
    status: "status",
    reviewedBy: "reviewed_by",
    reviewedAt: "reviewed_at",
    createdAt: "created_at",
  },
  editorialAssignments: {
    id: "id",
    postId: "post_id",
    assigneeId: "assignee_id",
    reviewerIds: "reviewer_ids",
    dueDate: "due_date",
    editorialNotes: "editorial_notes",
    reviewStatus: "review_status",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  users: { id: "id", name: "name" },
  posts: { id: "id", status: "status", primaryAuthorId: "primary_author_id" },
}));

describe("EditorialCollaborationService", () => {
  let service: EditorialCollaborationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EditorialCollaborationService();
  });

  describe("Presence Coordination", () => {
    it("records active user heartbeat and returns active users", () => {
      const active = service.recordPresenceHeartbeat("post-1", {
        userId: "user-1",
        name: "Alice Editor",
        cursor: { x: 120, y: 340, blockId: "block-1" },
      });

      expect(active).toHaveLength(1);
      expect(active[0]?.userId).toBe("user-1");
      expect(active[0]?.name).toBe("Alice Editor");
      expect(active[0]?.cursor?.blockId).toBe("block-1");
    });

    it("tracks multiple users simultaneously in the same post room", () => {
      service.recordPresenceHeartbeat("post-1", {
        userId: "user-1",
        name: "Alice Editor",
      });
      const active = service.recordPresenceHeartbeat("post-1", {
        userId: "user-2",
        name: "Bob Reviewer",
      });

      expect(active).toHaveLength(2);
      const userIds = active.map((u) => u.userId);
      expect(userIds).toContain("user-1");
      expect(userIds).toContain("user-2");
    });
  });

  describe("Workflow State Machine & RBAC", () => {
    it("allows author to submit draft for review with posts.edit permission", async () => {
      mockDb.select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                { id: "post-1", status: "draft", primaryAuthorId: "user-1" },
              ]),
          }),
        }),
      });

      mockDb.update.mockReturnValueOnce({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      });

      const res = await service.transitionWorkflow({
        postId: "post-1",
        targetStatus: "in_review",
        actorId: "user-1",
        actorPermissions: ["posts.edit"],
      });

      expect(res.status).toBe("in_review");
    });

    it("rejects transition to published if actor lacks posts.publish permission", async () => {
      mockDb.select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                { id: "post-1", status: "approved", primaryAuthorId: "user-1" },
              ]),
          }),
        }),
      });

      await expect(
        service.transitionWorkflow({
          postId: "post-1",
          targetStatus: "published",
          actorId: "user-1",
          actorPermissions: ["posts.edit"], // Missing posts.publish
        }),
      ).rejects.toThrow(/Permission 'posts.publish' required/);
    });

    it("allows publisher to transition approved post to published", async () => {
      mockDb.select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                { id: "post-1", status: "approved", primaryAuthorId: "user-1" },
              ]),
          }),
        }),
      });

      mockDb.update.mockReturnValueOnce({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      });

      const res = await service.transitionWorkflow({
        postId: "post-1",
        targetStatus: "published",
        actorId: "user-editor",
        actorPermissions: ["posts.edit", "posts.publish"],
      });

      expect(res.status).toBe("published");
    });
  });
});
