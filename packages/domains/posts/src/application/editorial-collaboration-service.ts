import {
  getDb,
  editorialComments,
  editorialSuggestions,
  editorialAssignments,
  users,
  posts,
} from "@vibress/database";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { hasResourcePermission } from "@vibress/security";
import { PostStatus, PostDomainError } from "../domain/post";

const WORKFLOW_TARGET_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "in_review",
  "scheduled",
  "published",
  "archived",
]);

export interface EditorialCommentDto {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  body: string;
  blockId?: string | null | undefined;
  status: "open" | "resolved";
  resolvedBy?: string | null | undefined;
  resolvedAt?: string | null | undefined;
  createdAt: string;
}

export interface EditorialSuggestionDto {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  originalText: string;
  suggestedText: string;
  blockId?: string | null | undefined;
  status: "pending" | "accepted" | "rejected";
  reviewedBy?: string | null | undefined;
  reviewedAt?: string | null | undefined;
  createdAt: string;
}

export interface EditorialAssignmentDto {
  id: string;
  postId: string;
  assigneeId?: string | null | undefined;
  assigneeName?: string | null | undefined;
  reviewerIds: string[];
  dueDate?: string | null | undefined;
  editorialNotes?: string | null | undefined;
  reviewStatus: "pending" | "in_review" | "changes_requested" | "approved";
  updatedAt: string;
}

export interface EditorPresenceUser {
  userId: string;
  name: string;
  cursor?: { x: number; y: number; blockId?: string } | undefined;
  lastActive: number;
}

export class EditorialCollaborationService {
  // In-memory fallback presence tracker (scoped per publication + post)
  private presenceMap: Map<string, Map<string, EditorPresenceUser>> = new Map();
  // Persistent document CRDT updates buffer (scoped per publication + post)
  private docUpdatesMap: Map<string, Uint8Array[]> = new Map();

  private buildScopedKey(postId: string, publicationId = "pub_default"): string {
    return `${publicationId}:${postId}`;
  }

  getYjsDocUpdates(postId: string, publicationId = "pub_default"): Uint8Array[] {
    return this.docUpdatesMap.get(this.buildScopedKey(postId, publicationId)) || [];
  }

  applyYjsDocUpdate(
    postId: string,
    update: Uint8Array,
    publicationId = "pub_default",
  ): void {
    const key = this.buildScopedKey(postId, publicationId);
    let list = this.docUpdatesMap.get(key);
    if (!list) {
      list = [];
      this.docUpdatesMap.set(key, list);
    }
    list.push(update);
    if (list.length > 100) {
      list.shift();
    }
  }

  clearYjsDocUpdates(postId: string, publicationId = "pub_default"): void {
    this.docUpdatesMap.delete(this.buildScopedKey(postId, publicationId));
    // Also clean legacy unscoped entry if present
    this.docUpdatesMap.delete(postId);
  }

  async listComments(postId: string): Promise<EditorialCommentDto[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: editorialComments.id,
        postId: editorialComments.postId,
        authorId: editorialComments.authorId,
        authorName: users.name,
        body: editorialComments.body,
        blockId: editorialComments.blockId,
        status: editorialComments.status,
        resolvedBy: editorialComments.resolvedBy,
        resolvedAt: editorialComments.resolvedAt,
        createdAt: editorialComments.createdAt,
      })
      .from(editorialComments)
      .innerJoin(users, eq(editorialComments.authorId, users.id))
      .where(eq(editorialComments.postId, postId))
      .orderBy(desc(editorialComments.createdAt));

    return rows.map((r) => ({
      id: r.id,
      postId: r.postId,
      authorId: r.authorId,
      authorName: r.authorName,
      body: r.body,
      blockId: r.blockId,
      status: r.status as "open" | "resolved",
      resolvedBy: r.resolvedBy,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addComment(params: {
    postId: string;
    authorId: string;
    body: string;
    blockId?: string | undefined;
  }): Promise<EditorialCommentDto> {
    const db = getDb();
    const id = randomUUID();
    await db.insert(editorialComments).values({
      id,
      postId: params.postId,
      authorId: params.authorId,
      body: params.body,
      blockId: params.blockId || null,
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const user = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, params.authorId))
      .limit(1);

    return {
      id,
      postId: params.postId,
      authorId: params.authorId,
      authorName: user[0]?.name || "Staff Member",
      body: params.body,
      blockId: params.blockId || null,
      status: "open",
      createdAt: new Date().toISOString(),
    };
  }

  async resolveComment(
    commentId: string,
    resolvedById: string,
    postId?: string,
  ): Promise<void> {
    const db = getDb();
    await db
      .update(editorialComments)
      .set({
        status: "resolved",
        resolvedBy: resolvedById,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        postId
          ? and(
              eq(editorialComments.id, commentId),
              eq(editorialComments.postId, postId),
            )
          : eq(editorialComments.id, commentId),
      );
  }

  async reopenComment(commentId: string, postId?: string): Promise<void> {
    const db = getDb();
    await db
      .update(editorialComments)
      .set({
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
        updatedAt: new Date(),
      })
      .where(
        postId
          ? and(
              eq(editorialComments.id, commentId),
              eq(editorialComments.postId, postId),
            )
          : eq(editorialComments.id, commentId),
      );
  }

  async listSuggestions(postId: string): Promise<EditorialSuggestionDto[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: editorialSuggestions.id,
        postId: editorialSuggestions.postId,
        authorId: editorialSuggestions.authorId,
        authorName: users.name,
        originalText: editorialSuggestions.originalText,
        suggestedText: editorialSuggestions.suggestedText,
        blockId: editorialSuggestions.blockId,
        status: editorialSuggestions.status,
        reviewedBy: editorialSuggestions.reviewedBy,
        reviewedAt: editorialSuggestions.reviewedAt,
        createdAt: editorialSuggestions.createdAt,
      })
      .from(editorialSuggestions)
      .innerJoin(users, eq(editorialSuggestions.authorId, users.id))
      .where(eq(editorialSuggestions.postId, postId))
      .orderBy(desc(editorialSuggestions.createdAt));

    return rows.map((r) => ({
      id: r.id,
      postId: r.postId,
      authorId: r.authorId,
      authorName: r.authorName,
      originalText: r.originalText,
      suggestedText: r.suggestedText,
      blockId: r.blockId,
      status: r.status as "pending" | "accepted" | "rejected",
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createSuggestion(params: {
    postId: string;
    authorId: string;
    originalText: string;
    suggestedText: string;
    blockId?: string | undefined;
  }): Promise<EditorialSuggestionDto> {
    const db = getDb();
    const id = randomUUID();
    await db.insert(editorialSuggestions).values({
      id,
      postId: params.postId,
      authorId: params.authorId,
      originalText: params.originalText,
      suggestedText: params.suggestedText,
      blockId: params.blockId || null,
      status: "pending",
      createdAt: new Date(),
    });

    const user = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, params.authorId))
      .limit(1);

    return {
      id,
      postId: params.postId,
      authorId: params.authorId,
      authorName: user[0]?.name || "Staff Member",
      originalText: params.originalText,
      suggestedText: params.suggestedText,
      blockId: params.blockId || null,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
  }

  async reviewSuggestion(
    suggestionId: string,
    reviewedById: string,
    action: "accepted" | "rejected",
    postId?: string,
  ): Promise<void> {
    const db = getDb();
    await db
      .update(editorialSuggestions)
      .set({
        status: action,
        reviewedBy: reviewedById,
        reviewedAt: new Date(),
      })
      .where(
        postId
          ? and(
              eq(editorialSuggestions.id, suggestionId),
              eq(editorialSuggestions.postId, postId),
            )
          : eq(editorialSuggestions.id, suggestionId),
      );
  }

  async getAssignment(postId: string): Promise<EditorialAssignmentDto | null> {
    const db = getDb();
    const rows = await db
      .select({
        id: editorialAssignments.id,
        postId: editorialAssignments.postId,
        assigneeId: editorialAssignments.assigneeId,
        assigneeName: users.name,
        reviewerIds: editorialAssignments.reviewerIds,
        dueDate: editorialAssignments.dueDate,
        editorialNotes: editorialAssignments.editorialNotes,
        reviewStatus: editorialAssignments.reviewStatus,
        updatedAt: editorialAssignments.updatedAt,
      })
      .from(editorialAssignments)
      .leftJoin(users, eq(editorialAssignments.assigneeId, users.id))
      .where(eq(editorialAssignments.postId, postId))
      .limit(1);

    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      postId: r.postId,
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeName,
      reviewerIds: Array.isArray(r.reviewerIds) ? (r.reviewerIds as string[]) : [],
      dueDate: r.dueDate ? r.dueDate.toISOString() : null,
      editorialNotes: r.editorialNotes,
      reviewStatus: r.reviewStatus as
        | "pending"
        | "in_review"
        | "changes_requested"
        | "approved",
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async updateAssignment(params: {
    postId: string;
    assigneeId?: string | null | undefined;
    reviewerIds?: string[] | undefined;
    dueDate?: Date | null | undefined;
    editorialNotes?: string | null | undefined;
    reviewStatus?:
      | "pending"
      | "in_review"
      | "changes_requested"
      | "approved"
      | undefined;
  }): Promise<EditorialAssignmentDto> {
    const db = getDb();
    const existing = await db
      .select({ id: editorialAssignments.id })
      .from(editorialAssignments)
      .where(eq(editorialAssignments.postId, params.postId))
      .limit(1);

    if (existing[0]) {
      await db
        .update(editorialAssignments)
        .set({
          assigneeId: params.assigneeId,
          reviewerIds: params.reviewerIds || [],
          dueDate: params.dueDate,
          editorialNotes: params.editorialNotes,
          reviewStatus: params.reviewStatus || "pending",
          updatedAt: new Date(),
        })
        .where(eq(editorialAssignments.postId, params.postId));
    } else {
      await db.insert(editorialAssignments).values({
        id: randomUUID(),
        postId: params.postId,
        assigneeId: params.assigneeId,
        reviewerIds: params.reviewerIds || [],
        dueDate: params.dueDate,
        editorialNotes: params.editorialNotes,
        reviewStatus: params.reviewStatus || "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const updated = await this.getAssignment(params.postId);
    return updated!;
  }

  // Presence coordination
  recordPresenceHeartbeat(
    postId: string,
    user: {
      userId: string;
      name: string;
      cursor?: { x: number; y: number; blockId?: string } | undefined;
    },
    publicationId = "pub_default",
  ): EditorPresenceUser[] {
    const scopedKey = this.buildScopedKey(postId, publicationId);
    if (!this.presenceMap.has(scopedKey)) {
      this.presenceMap.set(scopedKey, new Map());
    }
    const postPresences = this.presenceMap.get(scopedKey)!;
    postPresences.set(user.userId, {
      ...user,
      lastActive: Date.now(),
    });

    // Prune stale presences (> 30s)
    const now = Date.now();
    for (const [uid, presence] of postPresences.entries()) {
      if (now - presence.lastActive > 30000) {
        postPresences.delete(uid);
      }
    }
    if (postPresences.size === 0) {
      this.presenceMap.delete(scopedKey);
    }

    return Array.from(postPresences.values());
  }

  getActivePresence(
    postId: string,
    publicationId = "pub_default",
  ): EditorPresenceUser[] {
    const scopedKey = this.buildScopedKey(postId, publicationId);
    const postPresences = this.presenceMap.get(scopedKey);
    if (!postPresences) return [];
    const now = Date.now();
    return Array.from(postPresences.values()).filter(
      (p) => now - p.lastActive <= 30000,
    );
  }

  // Extensible workflow state machine transition
  async transitionWorkflow(params: {
    postId: string;
    publicationId?: string | undefined;
    targetStatus: PostStatus;
    actorId: string;
    actorRoles?: string[] | undefined;
    actorPermissions: string[];
    resourceAuthorIds?: string[] | undefined;
  }): Promise<{ status: PostStatus }> {
    if (
      typeof params.targetStatus !== "string" ||
      !WORKFLOW_TARGET_STATUSES.has(params.targetStatus)
    ) {
      throw new PostDomainError(
        "VALIDATION_ERROR",
        `Invalid workflow targetStatus '${String(params.targetStatus)}'`,
      );
    }
    const targetStatus = params.targetStatus;

    const db = getDb();
    const whereClause = params.publicationId
      ? and(
          eq(posts.id, params.postId),
          eq(posts.publicationId, params.publicationId),
        )
      : eq(posts.id, params.postId);

    const postRow = await db
      .select({
        id: posts.id,
        status: posts.status,
        publicationId: posts.publicationId,
        primaryAuthorId: posts.primaryAuthorId,
      })
      .from(posts)
      .where(whereClause)
      .limit(1);

    if (!postRow[0]) {
      throw new PostDomainError("NOT_FOUND", `Post ${params.postId} not found`);
    }

    const p = params.actorPermissions;

    // RBAC + resource ownership validation on workflow transition
    if (
      targetStatus === "published" ||
      targetStatus === "scheduled" ||
      targetStatus === "archived"
    ) {
      if (!p.includes("posts.publish")) {
        throw new PostDomainError(
          "UNAUTHORIZED",
          `Permission 'posts.publish' required to transition post to '${targetStatus}'`,
        );
      }
    } else {
      const canEditResource = hasResourcePermission("posts.edit", {
        actorId: params.actorId,
        resourceOwnerId: postRow[0].primaryAuthorId,
        resourceAuthorIds: params.resourceAuthorIds,
        userRoles: params.actorRoles,
        userPermissions: p,
        publicationId: params.publicationId,
        resourcePublicationId: postRow[0].publicationId,
      });
      if (!canEditResource) {
        throw new PostDomainError(
          "UNAUTHORIZED",
          `Permission 'posts.edit' on this post is required to transition to '${targetStatus}'`,
        );
      }
    }

    await db
      .update(posts)
      .set({
        status: targetStatus,
        updatedBy: params.actorId,
        updatedAt: new Date(),
        publishedAt: targetStatus === "published" ? new Date() : undefined,
      })
      .where(whereClause);

    return { status: targetStatus };
  }
}
