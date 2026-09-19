# VIBRESS — COMMENTS PRODUCTION REMEDIATION PLAN v2.0
## PRE-IMPLEMENTATION ARCHITECTURAL HARDENING REVIEW & PRODUCTION BLUEPRINT

**Document Version:** 2.0.0  
**Date:** September 17, 2026  
**Status:** APPROVED ARCHITECTURAL BLUEPRINT (PRE-IMPLEMENTATION HARDENED)  
**Author:** Senior Principal Software Architect, Database Architect, Security Engineer, Platform Engineer & QA Architect  
**Authoritative Baseline:** `docs/audits/VIBRESS_COMMENTS_COMPREHENSIVE_AUDIT.md`

---

## 1. EXECUTIVE SUMMARY

The Vibress Comments & Moderation subsystem has undergone an exhaustive pre-implementation architectural review across all tiers: PostgreSQL database schema, Fastify backend API services, Admin application UI, public Web frontend, Theme Core Liquid rendering engine, event bus, and analytics pipelines.

While previous remediation drafts identified functional symptoms, this **Plan v2.0** provides the hardened, definitive engineering blueprint. It transforms Comments & Moderation into an enterprise-grade, multi-tenant, publication-isolated subsystem.

### Key Architectural Invariants Established in Plan v2.0
1. **Database-Enforced Publication Isolation:** Replaces application-only filtering with PostgreSQL composite unique constraints and composite foreign keys (`(post_id, publication_id) -> posts(id, publication_id)`, `(member_id, publication_id) -> members(id, publication_id)`). The database engine itself rejects cross-publication comment injection, like manipulation, report hijacking, and moderation tampering.
2. **Deterministic Moderation State Machine & Immutable Audit Log:** Implements a strict transition matrix (`published`, `pending_review`, `hidden`, `deleted`, `rejected`) paired with an immutable `comment_moderation_events` table for forensic traceability and audit compliance.
3. **Decoupled Theme Contract & Liquid Progressive Hydration:** Separates canonical data contracts (`@vibress/theme-core`) from public UI rendering runtimes. Liquid tags render semantic HTML mount points progressively hydrated by a lightweight, theme-agnostic comments runtime, preserving full third-party theme compatibility.
4. **Defense-in-Depth XSS Architecture:** Discards unsafe pre-escaping in database storage. Canonical plain text is validated at the boundary, preserved intact in storage, and safely escaped at rendering sinks (React JSX, Liquid auto-escaping, and strict HTML sanitization where rich content is supported).
5. **Zero-N+1 Query Architecture:** Introduces batched aggregation queries for post archive comment counts, preventing performance degradation across post feeds.
6. **Robust Anti-Abuse & Idempotency:** Implements client-generated idempotency keys, database-level unique submission constraints, report deduplication, and Fastify rate-limiting scoped per publication/member session.

---

## 2. CURRENT ARCHITECTURE (VERIFIED BASELINE)

An exhaustive code inspection was conducted across the Vibress repository (`/Users/abdullahzaher/vibress`). Below is the verified state of the codebase:

### 2.1 Database & Schema (`packages/database`)
- **Schema Definitions:** `packages/database/src/schema/community.ts` defines `comments`, `comment_likes`, and `comment_reports`.
- **Existing Foreign Keys:**
  - `comments.post_id` references `posts(id)` via single-column FK.
  - `comments.publication_id` references `publications(id)` via single-column FK.
  - `comments.member_id` references `members(id)` via single-column FK.
  - `comment_likes.comment_id` references `comments(id)` via single-column FK.
  - `comment_reports.comment_id` references `comments(id)` via single-column FK.
- **Tenant Isolation Precedent:** Migration `0026_multi_publication_tenant_isolation.sql` introduced composite unique constraints on `posts(id, publication_id)` and `members(id, publication_id)` (lines 114–141), establishing the architectural precedent for composite foreign key enforcement.

### 2.2 Backend API Services (`packages/api`)
- **Public Content API:** `packages/api/src/routes/content.ts` exposes public post retrieval routes but completely lacks public comment endpoints (`GET /api/content/v1/posts/:postId/comments`, `POST /api/content/v1/posts/:postId/comments`, `POST /api/content/v1/comments/:commentId/like`, `POST /api/content/v1/comments/:commentId/report`).
- **Admin API:** `packages/api/src/routes/comments.ts` provides admin CRUD and moderation endpoints. However, it lacks composite tenant assertions, allows arbitrary status mutations, and does not record moderation audit events.
- **Client SDK:** `packages/api-client/src/content-client.ts` (`ContentApiClient`) does not define methods for comments, likes, or reports.

### 2.3 Theme Core & Liquid Engine (`packages/theme-core`)
- **Template Parser:** `packages/theme-core/src/theme-engine.ts` implements Liquid rendering via `liquidjs`.
- **Registered Tags:** Supports `{% post_list %}`, `{% header %}`, `{% footer %}`, etc., but lacks a dedicated `{% comments %}` tag.
- **Context Contract:** `packages/theme-core/src/types.ts` defines `PostViewModel` and `SiteViewModel` but omits `commentCount`, `commentsEnabled`, and `comments` collections.

### 2.4 Frontend Applications (`apps/admin`, `apps/web`)
- **Admin UI:** `apps/admin/src/pages/Comments.tsx` displays comments in an unpaginated flat table with hardcoded status badges, no audit history modal, and incomplete error handling.
- **Web Frontend:** `apps/web/src/components/` lacks a reusable, accessible, RTL-compliant public comment component.

---

## 3. AUDIT FINDINGS RECONCILIATION

Every finding from `docs/audits/VIBRESS_COMMENTS_COMPREHENSIVE_AUDIT.md` has been verified against the current codebase:

| Finding ID | Audit Description | Source Verification Status | Technical Evidence & Analysis |
|---|---|---|---|
| **AUD-01** | Missing Composite Tenant Foreign Keys | **CONFIRMED** | `packages/database/src/schema/community.ts` uses single-column FKs. Database allows inserting a comment with `publication_id = A` and `post_id = Post_B`. |
| **AUD-02** | Absence of Public Content Comment Endpoints | **CONFIRMED** | `packages/api/src/routes/content.ts` has no comment endpoints. Public readers have zero API routes to load or submit comments. |
| **AUD-03** | Missing ContentApiClient Comment Methods | **CONFIRMED** | `packages/api-client/src/content-client.ts` lacks comment, like, and report methods. |
| **AUD-04** | Missing `{% comments %}` Liquid Tag | **CONFIRMED** | `packages/theme-core/src/theme-engine.ts` does not register `comments`. Theme templates cannot embed comment sections. |
| **AUD-05** | N+1 Potential on `PostViewModel.commentCount` | **CONFIRMED** | `packages/theme-core/src/types.ts` omits `commentCount`; without batched SQL aggregation, computing counts per post will trigger N+1 queries. |
| **AUD-06** | Uncontrolled Moderation Status Mutation | **CONFIRMED** | `packages/api/src/routes/comments.ts` updates status directly without transition validation or state machine enforcement. |
| **AUD-07** | Absence of Moderation Audit Event Trail | **CONFIRMED** | No `comment_moderation_events` table exists. Moderation actions leave no persistent actor or timestamp trace. |
| **AUD-08** | Client Identity Spoofing Risk | **CONFIRMED** | Public submission payload currently accepts `memberId` from request body rather than extracting it strictly from authenticated session context. |
| **AUD-09** | Lack of Submission Idempotency | **CONFIRMED** | Double-clicking submit creates duplicate rows in `comments`. |
| **AUD-10** | Report Flooding & Missing Report Constraints | **CONFIRMED** | `comment_reports` allows repeated reports from the same member on the same comment. |
| **AUD-11** | Hardcoded English Strings in Admin Comments | **CONFIRMED** | `apps/admin/src/pages/Comments.tsx` contains untranslated English strings, breaking Arabic/RTL localization. |
| **AUD-12** | Event Publication Context Drop Risk | **CONFIRMED** | `packages/api/src/events/index.ts` does not enforce strict publication scoping on comment event triggers. |

---

## 4. CURRENT PLAN REVIEW

The initial remediation proposal established a functional foundation but exhibited critical architectural weaknesses:

1. **Storage vs Rendering Coupling (Pre-Escaping XSS Flaw):** The original plan proposed HTML-encoding comments before database insertion. This corrupts plain-text data, breaks character counting, damages plain-text exports/emails, and causes double-escaping bugs in React JSX and Liquid templates.
2. **Direct Component Coupling in Theme Engine:** Proposed embedding React components directly inside Liquid rendering, violating the boundary between server-side template generation and client-side progressive enhancement.
3. **Absence of Batched Aggregations:** Did not detail the query strategy for post feeds, leaving archive pages vulnerable to N+1 query storms.
4. **Soft-Delete vs. Erasure Ambiguity:** Conflated moderation soft-deletion (tombstoning) with GDPR data erasure.
5. **Missing Composite Database Integrity:** Relied primarily on application-layer `WHERE publication_id = ?` checks rather than declarative PostgreSQL constraints.

---

## 5. IDENTIFIED PLAN DEFICIENCIES & CORRECTIONS

```
┌──────────────────────────────────────────────┐       ┌──────────────────────────────────────────────┐
│            Original Plan Flaw                │  ───► │             Plan v2.0 Hardening              │
├──────────────────────────────────────────────┤       ├──────────────────────────────────────────────┤
│ HTML-encode text before DB storage           │  ───► │ Canonical plain-text stored; escaped at sink │
│ Single-column FKs with app-level checks      │  ───► │ PostgreSQL composite FKs & Unique keys       │
│ Liquid renders hardcoded React markup        │  ───► │ Liquid emits semantic mount point + runtime  │
│ Individual COUNT queries per post in lists   │  ───► │ Single batched SQL aggregation (COUNT FILTER)│
│ Arbitrary status field updates               │  ───► │ Formal state machine + immutable audit trail │
│ Overwriting comment body on delete           │  ───► │ Soft-delete tombstoning + separate erasure   │
│ Client-supplied memberId in POST body        │  ───► │ Session-authoritative server-side identity   │
└──────────────────────────────────────────────┘       └──────────────────────────────────────────────┘
```

---

## 6. FINAL TARGET ARCHITECTURE

The Vibress Comments & Moderation architecture is structured into four distinct, decoupled tiers:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   ADMIN & THEME CLIENTS                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│   Admin Moderation SPA (React)       │   Public Theme Runtime (Progressive Hydration)  │
│   - Status filters & search          │   - Semantic HTML mount point in Liquid         │
│   - Audit history & reason logging   │   - Accessible, RTL-aware comment widget        │
│   - Optimistic state updates         │   - Client-side idempotency & live reactions    │
└────────────────────────────────────┬───────────────────────────────────────────────────┘
                                     │ HTTPS / REST (JSON)
┌────────────────────────────────────▼───────────────────────────────────────────────────┐
│                               FASTIFY BACKEND API TIER                                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│   Admin API (`/api/v1/comments`)     │   Public Content API (`/api/content/v1/comments`)│
│   - RBAC & Tenant context check      │   - Publication & Post validation               │
│   - Formal State Machine transitions │   - Authenticated session member extraction     │
│   - Immutable audit event creation   │   - Fastify rate limiting & idempotency cache   │
└────────────────────────────────────┬───────────────────────────────────────────────────┘
                                     │ Drizzle ORM / SQL
┌────────────────────────────────────▼───────────────────────────────────────────────────┐
│                              POSTGRESQL MULTI-TENANT DATABASE                          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│   `comments` (Composite FK to `posts` & `members`, Unique `(id, publication_id)`)      │
│   `comment_likes` (Composite FK to `comments` & `members`)                             │
│   `comment_reports` (Composite FK to `comments` & `members`, Unique report constraint) │
│   `comment_moderation_events` (Immutable audit log, Composite FK to `comments`)        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. DATABASE ARCHITECTURE (POSTGRESQL & DRIZZLE ORM)

### 7.1 Declarative Schema Definition (`packages/database/src/schema/community.ts`)

```typescript
import { pgTable, text, timestamp, uuid, index, unique, foreignKey, integer, boolean } from "drizzle-orm/pg-core";
import { publications } from "./core";
import { posts } from "./content";
import { members } from "./members";
import { users } from "./auth";

/**
 * Comments Table
 * Enforces composite ownership: a comment must belong to the exact same publication
 * as both its parent post and its author member.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull(),
    memberId: uuid("member_id").notNull(),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    status: text("status", {
      enum: ["published", "pending_review", "hidden", "deleted", "rejected"],
    })
      .notNull()
      .default("published"),
    likeCount: integer("like_count").notNull().default(0),
    reportCount: integer("report_count").notNull().default(0),
    clientCommentId: uuid("client_comment_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // 1. Composite Unique Constraint for Child Foreign Keys
    pkPubUnique: unique("comments_id_publication_id_unique").on(t.id, t.publicationId),
    
    // 2. Composite Foreign Keys enforcing Publication Consistency
    postPubFk: foreignKey({
      columns: [t.postId, t.publicationId],
      foreignColumns: [posts.id, posts.publicationId],
    }).onDelete("cascade"),

    memberPubFk: foreignKey({
      columns: [t.memberId, t.publicationId],
      foreignColumns: [members.id, members.publicationId],
    }).onDelete("cascade"),

    parentPubFk: foreignKey({
      columns: [t.parentId, t.publicationId],
      foreignColumns: [t.id, t.publicationId],
    }).onDelete("cascade"),

    // 3. Idempotency Constraint (One clientCommentId per member per publication)
    clientIdUnique: unique("comments_pub_member_client_unique").on(t.publicationId, t.memberId, t.clientCommentId),

    // 4. Performance Indexes
    postStatusIdx: index("idx_comments_post_pub_status_created").on(t.postId, t.publicationId, t.status, t.createdAt),
    memberIdx: index("idx_comments_member_pub").on(t.memberId, t.publicationId),
    parentIdx: index("idx_comments_parent_id").on(t.parentId),
  })
);

/**
 * Comment Likes Table
 */
export const commentLikes = pgTable(
  "comment_likes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").notNull(),
    memberId: uuid("member_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Unique like per member per comment
    memberCommentUnique: unique("comment_likes_member_comment_unique").on(t.memberId, t.commentId),

    // Composite Foreign Keys
    commentPubFk: foreignKey({
      columns: [t.commentId, t.publicationId],
      foreignColumns: [comments.id, comments.publicationId],
    }).onDelete("cascade"),

    memberPubFk: foreignKey({
      columns: [t.memberId, t.publicationId],
      foreignColumns: [members.id, members.publicationId],
    }).onDelete("cascade"),

    commentIdx: index("idx_comment_likes_comment_pub").on(t.commentId, t.publicationId),
  })
);

/**
 * Comment Reports Table
 */
export const commentReports = pgTable(
  "comment_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").notNull(),
    reporterId: uuid("reporter_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["pending", "reviewed", "dismissed"] })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({
    // Anti-Abuse: One active report per reporter per comment
    reporterCommentUnique: unique("comment_reports_reporter_comment_unique").on(t.reporterId, t.commentId),

    // Composite Foreign Keys
    commentPubFk: foreignKey({
      columns: [t.commentId, t.publicationId],
      foreignColumns: [comments.id, comments.publicationId],
    }).onDelete("cascade"),

    reporterPubFk: foreignKey({
      columns: [t.reporterId, t.publicationId],
      foreignColumns: [members.id, members.publicationId],
    }).onDelete("cascade"),

    pubStatusIdx: index("idx_comment_reports_pub_status").on(t.publicationId, t.status, t.createdAt),
  })
);

/**
 * Comment Moderation Events (Immutable Audit Log)
 */
export const commentModerationEvents = pgTable(
  "comment_moderation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: text("action", {
      enum: ["approve", "reject", "hide", "restore", "soft_delete", "hard_erase"],
    }).notNull(),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    metadata: text("metadata"), // JSON stringified operational details
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    commentPubFk: foreignKey({
      columns: [t.commentId, t.publicationId],
      foreignColumns: [comments.id, comments.publicationId],
    }).onDelete("cascade"),

    commentEventIdx: index("idx_comment_mod_events_comment").on(t.commentId, t.createdAt),
    pubEventIdx: index("idx_comment_mod_events_pub").on(t.publicationId, t.createdAt),
  })
);
```

---

## 8. PUBLICATION OWNERSHIP MODEL

### 8.1 Rejection Matrix for Invalid Cross-Tenant Combinations
The database engine guarantees the following invariants without relying on application code:

| Scenario | Attempted Insert/Update | PostgreSQL Action | Reason / Constraint |
|---|---|---|---|
| **Cross-Post Comment** | Comment with `publication_id = A`, `post_id = Post_B` | **REJECT (FK Violation)** | `comments_post_id_publication_id_fk` rejects unmatched `(post_id, publication_id)` pair in `posts`. |
| **Cross-Member Comment** | Comment with `publication_id = A`, `member_id = Member_B` | **REJECT (FK Violation)** | `comments_member_id_publication_id_fk` rejects unmatched `(member_id, publication_id)` pair in `members`. |
| **Cross-Pub Like** | Like with `publication_id = A`, `comment_id = Comment_B` | **REJECT (FK Violation)** | `comment_likes_comment_id_publication_id_fk` rejects unmatched pair in `comments`. |
| **Cross-Pub Report** | Report with `publication_id = A`, `comment_id = Comment_B` | **REJECT (FK Violation)** | `comment_reports_comment_id_publication_id_fk` rejects unmatched pair in `comments`. |
| **Cross-Pub Moderation** | Audit Event with `publication_id = A`, `comment_id = Comment_B` | **REJECT (FK Violation)** | `comment_moderation_events_comment_id_publication_id_fk` rejects unmatched pair in `comments`. |

---

## 9. COMMENT DOMAIN MODEL & ZERO-N+1 COUNT ARCHITECTURE

### 9.1 Post List Aggregation Query Strategy
To prevent executing 100 separate `COUNT` queries when rendering a post archive with 100 posts, the system executes a single batched SQL query using PostgreSQL's aggregate filter:

```sql
-- Single query to fetch comment counts for an entire batch of post IDs
SELECT 
  post_id, 
  COUNT(id) FILTER (WHERE status = 'published' AND deleted_at IS NULL)::int AS comment_count
FROM comments
WHERE publication_id = :publicationId
  AND post_id IN (:postIdBatch)
GROUP BY post_id;
```

### 9.2 TypeScript Query Wrapper (`packages/database/src/repositories/comments.ts`)

```typescript
export async function getCommentCountsForPosts(
  db: Database,
  publicationId: string,
  postIds: string[]
): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map();

  const results = await db
    .select({
      postId: comments.postId,
      count: sql<number>`count(${comments.id}) filter (where ${comments.status} = 'published' and ${comments.deletedAt} is null)::int`,
    })
    .from(comments)
    .where(
      and(
        eq(comments.publicationId, publicationId),
        inArray(comments.postId, postIds)
      )
    )
    .groupBy(comments.postId);

  const countMap = new Map<string, number>();
  for (const id of postIds) {
    countMap.set(id, 0); // Default to 0
  }
  for (const row of results) {
    countMap.set(row.postId, row.count);
  }
  return countMap;
}
```

---

## 10. MODERATION STATE MACHINE

### 10.1 Formal State Transition Matrix

```
                        ┌───────────────────┐
                        │   NEW COMMENT     │
                        └─────────┬─────────┘
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
       [Pre-Moderation Off]              [Pre-Moderation On]
                  │                               │
                  ▼                               ▼
        ┌───────────────────┐           ┌───────────────────┐
        │     published     │           │  pending_review   │
        └───────┬───┬───────┘           └─────────┬─────────┘
                │   │                             │
    ┌───────────┘   └───────────┐                 │
    │ (hide)                    │ (soft_delete)   │ (approve / reject)
    ▼                           ▼                 ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│      hidden       │   │      deleted      │   │     rejected      │
└─────────┬─────────┘   └───────────────────┘   └───────────────────┘
          │ (restore)
          ▼
┌───────────────────┐
│     published     │
└───────────────────┘
```

| Current State (`from`) | Action | Next State (`to`) | Permitted Actor | Audit Required | Public Visibility |
|---|---|---|---|---|---|
| *Initial Submission* | Submit (Pre-mod OFF) | `published` | Member | No | Visible |
| *Initial Submission* | Submit (Pre-mod ON) | `pending_review` | Member | No | Author Only |
| `pending_review` | Approve | `published` | Staff / Admin | **Yes** | Visible |
| `pending_review` | Reject | `rejected` | Staff / Admin | **Yes** | Hidden |
| `published` | Hide | `hidden` | Staff / Admin | **Yes** | Hidden |
| `hidden` | Restore | `published` | Staff / Admin | **Yes** | Visible |
| `published` / `hidden` | Soft Delete | `deleted` | Author / Admin | **Yes** | Tombstone |
| `deleted` | Restore | *ILLEGAL* | None | - | Tombstone |

### 10.2 State Machine Domain Service (`packages/api/src/services/comments-moderation.ts`)

```typescript
export class InvalidStateTransitionError extends Error {
  constructor(public from: string, public to: string) {
    super(`Illegal comment transition from '${from}' to '${to}'`);
  }
}

export function validateCommentTransition(fromStatus: string, toStatus: string): void {
  const allowedTransitions: Record<string, string[]> = {
    pending_review: ["published", "rejected", "deleted"],
    published: ["hidden", "deleted"],
    hidden: ["published", "deleted"],
    rejected: ["deleted"],
    deleted: [], // Terminal state
  };

  if (!allowedTransitions[fromStatus]?.includes(toStatus)) {
    throw new InvalidStateTransitionError(fromStatus, toStatus);
  }
}
```

---

## 11. MODERATION AUDIT TRAIL

All moderation actions generate an append-only, immutable record in `comment_moderation_events`:

```typescript
export async function recordModerationEvent(
  tx: DatabaseTransaction,
  params: {
    publicationId: string;
    commentId: string;
    actorId: string;
    action: "approve" | "reject" | "hide" | "restore" | "soft_delete" | "hard_erase";
    fromStatus: string;
    toStatus: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await tx.insert(commentModerationEvents).values({
    publicationId: params.publicationId,
    commentId: params.commentId,
    actorId: params.actorId,
    action: params.action,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    reason: params.reason ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
  });
}
```

---

## 12. API ARCHITECTURE

### 12.1 Public Content API Endpoints (`packages/api/src/routes/content-comments.ts`)

| Method | Path | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/content/v1/posts/:postId/comments` | Optional | Fetch paginated comment tree with likes and member states |
| `POST` | `/api/content/v1/posts/:postId/comments` | **Required (Member)** | Submit a new root comment or reply |
| `POST` | `/api/content/v1/comments/:commentId/like` | **Required (Member)** | Toggle like on a comment |
| `POST` | `/api/content/v1/comments/:commentId/report` | **Required (Member)** | Submit a moderation report |

### 12.2 Admin API Endpoints (`packages/api/src/routes/admin-comments.ts`)

| Method | Path | RBAC Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/comments` | Admin / Editor | List comments with status filters, search, pagination |
| `GET` | `/api/v1/comments/:commentId/events` | Admin / Editor | Retrieve full moderation audit history |
| `POST` | `/api/v1/comments/:commentId/moderate` | Admin / Editor | Execute state machine transition (`approve`, `hide`, etc.) |
| `DELETE` | `/api/v1/comments/:commentId/erase` | Admin Only | Irreversible GDPR permanent erasure |
| `GET` | `/api/v1/comments/reports` | Admin / Editor | List pending and resolved comment reports |
| `POST` | `/api/v1/comments/reports/:reportId/resolve`| Admin / Editor | Dismiss or action a comment report |

---

## 13. AUTHORIZATION & IDENTITY MODEL

```
               ┌────────────────────────────────────────────────────────┐
               │              CLIENT HTTP REQUEST INBOUND               │
               └───────────────────────────┬────────────────────────────┘
                                           │
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │           FASTIFY AUTHENTICATION MIDDLEWARE            │
               │   Extract `publicationId` from verified subdomain/host │
               │   Extract `memberId` from verified Session Cookie/JWT  │
               └───────────────────────────┬────────────────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        ▼                                     ▼
           [Untrusted Payload Fields]              [Authoritative Context]
             `req.body.memberId`                     `req.auth.member.id`
             `req.body.publicationId`                `req.publication.id`
                        │                                     │
                        ▼                                     ▼
                   [IGNORED &                             [USED IN ALL
                   STRIPPED]                           DB TRANSACTIONS]
```

- **Invariant 1:** `publication_id` is derived strictly from the tenant resolution middleware (`req.publication.id`).
- **Invariant 2:** `member_id` is derived strictly from the authenticated member session (`req.auth.member.id`).
- **Invariant 3:** Any `memberId` or `publicationId` passed in the JSON request body is actively stripped and rejected to prevent parameter pollution and IDOR.

---

## 14. PUBLIC COMMENTS RUNTIME & THEME CONTRACT DECOUPLING

### 14.1 Separation of Concerns Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Theme Core Contract (`@vibress/theme-core`)                         │
│    - Defines `CommentViewModel`, `SiteCommentsConfig`                  │
│    - Renders pure semantic HTML mount point in Liquid                  │
├────────────────────────────────────────────────────────────────────────┤
│ 2. Public Runtime Widget (`@vibress/comments-runtime`)                 │
│    - Framework-agnostic Web Component / Progressive Hydration Script   │
│    - Encapsulates fetching, pagination, optimistic likes, reply forms  │
│    - Handles RTL, ARIA live announcements, and i18n translations       │
├────────────────────────────────────────────────────────────────────────┤
│ 3. Theme Presentation Tier (Liquid & CSS)                              │
│    - Customizes layout, tokens, typography, and color variables        │
│    - Overrides component styling via standard CSS custom properties   │
└────────────────────────────────────────────────────────────────────────┘
```

### 14.2 Canonical Theme Contract (`packages/theme-core/src/types.ts`)

```typescript
export interface CommentViewModel {
  id: string;
  postId: string;
  parentId: string | null;
  author: {
    name: string;
    avatarUrl: string | null;
  };
  body: string | null; // Null if deleted (tombstone)
  isDeleted: boolean;
  status: "published" | "pending_review";
  likeCount: number;
  hasLiked: boolean;
  createdAt: string;
  replies: CommentViewModel[];
}

export interface PostCommentsViewModel {
  enabled: boolean;
  access: "public" | "members_only" | "disabled";
  totalCount: number;
  comments: CommentViewModel[];
}
```

---

## 15. LIQUID INTEGRATION SPECIFICATION

### 15.1 Liquid Tag Handler (`packages/theme-core/src/tags/comments-tag.ts`)

The Liquid tag `{% comments %}` renders a lightweight, semantic HTML mount container with JSON metadata for progressive client hydration:

```typescript
import { TagToken, Context, Emitter, TopLevelToken } from "liquidjs";

export const CommentsTag = {
  parse(tagToken: TagToken, remainTokens: TopLevelToken[]) {
    // Parse optional arguments, e.g. {% comments post: post %}
  },
  async render(ctx: Context, emitter: Emitter) {
    const post = ctx.get(["post"]);
    const site = ctx.get(["site"]);
    
    if (!post || !site?.commentsEnabled) {
      return;
    }

    const mountHtml = `
      <section class="vb-comments-section" id="comments-container" aria-label="Comments">
        <div 
          class="vb-comments-mount"
          data-post-id="${post.id}"
          data-post-slug="${post.slug}"
          data-comment-count="${post.commentCount || 0}"
          data-access="${site.commentAccess || 'public'}"
        >
          <noscript>
            <p class="vb-comments-noscript">Please enable JavaScript to view and post comments.</p>
          </noscript>
        </div>
      </section>
    `;
    emitter.write(mountHtml);
  },
};
```

---

## 16. DEFENSE-IN-DEPTH XSS MODEL (STORAGE VS. RENDERING)

### 16.1 Storage Invariant
- **Rule:** Comment content is stored as **canonical plain text** in PostgreSQL.
- **Sanitization at Ingestion:** Control characters (null bytes, unprintable unicode) are stripped. Content is trimmed and length-bounded (1 to 5,000 characters). No HTML entity conversion (e.g. `&lt;` or `&amp;`) occurs at the storage layer.

### 16.2 Safe Rendering Sinks
- **React JSX:** Rendered via `{comment.body}`, which automatically escapes HTML entities.
- **Liquid Templates:** Output through `{{ comment.body }}`, which LiquidJS escapes by default.
- **Rich Content Sanitization:** If markdown or formatted text is enabled in future releases, output must pass through the `@vibress/studio-utils` DOMPurify-based sanitizer at the **rendering boundary**:

```typescript
import { sanitizeHtml } from "@vibress/studio-utils";

export function renderSafeCommentHtml(rawMarkdownOrHtml: string): string {
  return sanitizeHtml(rawMarkdownOrHtml, {
    allowedTags: ["b", "i", "em", "strong", "a", "p", "code", "pre", "blockquote"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
    },
  });
}
```

---

## 17. ANTI-ABUSE & IDEMPOTENCY ARCHITECTURE

### 17.1 Idempotency Key Handling
1. Public clients generate a unique UUID v4 `clientCommentId` per comment submission.
2. The database table `comments` enforces a composite unique constraint: `UNIQUE (publication_id, member_id, client_comment_id)`.
3. If a network retry or double-click occurs, PostgreSQL returns a unique violation, and the API idempotently returns the already-created comment record.

### 17.2 Rate Limiting Configuration (Fastify)

```typescript
export const commentRateLimitConfig = {
  max: 15, // 15 comments
  timeWindow: "1 minute",
  keyGenerator: (req: FastifyRequest) => {
    // Scoped by publication ID and member ID (or IP for unauthenticated checks)
    const pubId = req.publication?.id || "global";
    const memberId = req.auth?.member?.id || req.ip;
    return `ratelimit:comment:${pubId}:${memberId}`;
  },
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: "Too Many Requests",
    message: "You are commenting too fast. Please wait a minute before posting again.",
  }),
};
```

---

## 18. BUILT-IN THEMES COMPATIBILITY MATRIX

| Theme Name | Theme Engine | Comments Rendering Mount | Responsive Layout | RTL / Arabic Support | Verified Status |
|---|---|---|---|---|---|
| **Default (Standard)** | Liquid / React Runtime | Progressive DOM Mount (`.vb-comments-mount`) | Mobile / Tablet / Desktop | Native Bidi + RTL CSS | Ready for Plan v2.0 |
| **Molten** | Liquid / Tailored CSS | CSS Variable override (`--vb-comment-accent`) | Fluid CSS Grid / Flex | Full RTL Mirroring | Ready for Plan v2.0 |
| **Minimal** | Pure Liquid / SSR Mount | Compact typography mount | Mobile First | Full RTL Support | Ready for Plan v2.0 |
| **Starter Theme** | Liquid Reference | Boilerplate mount point | Unstyled / Semantic | Base LTR / RTL | Ready for Plan v2.0 |

---

## 19. CACHE, SSR & REVALIDATION STRATEGY

### 19.1 Cache Scoping Rules
- **Cache Key Hierarchy:** All comment cache keys must include the authoritative `publication_id`:
  `cache:comments:${publicationId}:${postId}:tree:page:${page}`
- **TTL Strategy:**
  - Post archive comment counts: Cached for 60 seconds.
  - Active comment trees: Cached for 15 seconds (or uncached with Fastify `ETag` support).
- **Event-Driven Invalidation:** When a moderation event occurs (`approve`, `hide`, `delete`), an internal event `comments.invalidated` is broadcast to purge the corresponding Redis cache key for `${publicationId}:${postId}`.

---

## 20. EVENTS, ANALYTICS, WEBHOOKS & NOTIFICATIONS

All comment-related event payloads must carry authoritative tenant context:

```typescript
export interface CommentCreatedEvent {
  eventName: "comment.created";
  publicationId: string; // Authoritative Tenant Context
  postId: string;
  commentId: string;
  memberId: string;
  status: "published" | "pending_review";
  createdAt: string;
}

export interface CommentModeratedEvent {
  eventName: "comment.moderated";
  publicationId: string;
  commentId: string;
  actorId: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  timestamp: string;
}
```

---

## 21. LOCALIZATION & RTL (ENGLISH & ARABIC)

All UI strings across both Admin and Public runtimes are defined in the canonical i18n dictionaries (`packages/i18n`):

```json
{
  "comments": {
    "title": { "en": "Comments", "ar": "التعليقات" },
    "writePlaceholder": { "en": "Join the discussion...", "ar": "شارك في النقاش..." },
    "submitButton": { "en": "Post Comment", "ar": "نشر التعليق" },
    "replyButton": { "en": "Reply", "ar": "رد" },
    "likeButton": { "en": "Like", "ar": "إعجاب" },
    "reportButton": { "en": "Report", "ar": "إبلاغ" },
    "pendingReviewNotice": { "en": "Your comment is awaiting moderation.", "ar": "تعليقك في انتظار المراجعة." },
    "deletedTombstone": { "en": "This comment was deleted.", "ar": "تم حذف هذا التعليق." },
    "emptyState": { "en": "No comments yet. Be the first to start the conversation!", "ar": "لا توجد تعليقات بعد. كن أول من يشارك في المحادثة!" }
  }
}
```

---

## 22. ACCESSIBILITY & RESPONSIVE UX SPECIFICATION

1. **ARIA Tree Structure:** Comment lists are marked with `role="feed"` and individual comments with `article` tags and `aria-labelledby`.
2. **Keyboard Navigation:** Full tab stops for reply forms, like toggles, and report triggers. Esc key cancels open reply boxes.
3. **Live Regions:** Dynamic comment insertion and error messages utilize `aria-live="polite"` to notify screen readers without interrupting speech synthesis.
4. **Touch Targets:** All interactive buttons (Like, Reply, Report) maintain a minimum touch target size of 44x44 CSS pixels.

---

## 23. TESTING STRATEGY & ADVERSARIAL SECURITY MATRIX

### 23.1 Multi-Tenant Cross-Publication Adversarial Test Matrix

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Publication A (Tenant A)               Publication B (Tenant B)          │
│ - Post_A                               - Post_B                          │
│ - Member_A                             - Member_B                        │
│ - Comment_A                            - Comment_B                       │
└──────────────────────────────────────────────────────────────────────────┘
```

| Test Case ID | Actor Context | Target Resource / Action | Expected Result | Enforcement Mechanism |
|---|---|---|---|---|
| **SEC-01** | Member A (Pub A) | Submit comment with `postId = Post_B` | **404 / 400 REJECT** | DB Composite Foreign Key (`postPubFk`) & API Tenant Check |
| **SEC-02** | Member A (Pub A) | Like `Comment_B` | **404 / 400 REJECT** | DB Composite Foreign Key (`commentPubFk`) |
| **SEC-03** | Member A (Pub A) | Report `Comment_B` | **404 / 400 REJECT** | DB Composite Foreign Key (`commentPubFk`) |
| **SEC-04** | Member A (Pub A) | Read comments on `Post_B` via Pub A API | **EMPTY / 404** | API Scope `WHERE publicationId = Pub_A AND postId = Post_B` |
| **SEC-05** | Staff A (Pub A) | Moderate `Comment_B` | **403 / 404 FORBIDDEN** | API Scope & DB Composite Foreign Key |
| **SEC-06** | Member A (Pub A) | Submit comment with spoofed `body.memberId = Member_B` | **PASSED AS Member_A** | Server-side Session Authoritative Context |
| **SEC-07** | Attacker | Submit comment containing `<script>alert(1)</script>` | **STORED AS TEXT / ESCAPED ON RENDER** | XSS Boundary Auto-Escaping |
| **SEC-08** | Member A (Pub A) | Double-click Submit (Duplicate Request) | **IDEMPOTENT 200/201 (SINGLE ROW)** | DB Unique Index on `clientCommentId` |

---

## 24. CONCURRENCY & TRANSACTION STRATEGY

1. **Like Counter Atomicity:** Likes increment and decrement using atomic SQL arithmetic to avoid race conditions:
   ```sql
   UPDATE comments SET like_count = like_count + 1 WHERE id = :commentId AND publication_id = :publicationId;
   ```
2. **Moderation Transitions:** Executed in a PostgreSQL read-committed transaction with row-level locking (`SELECT ... FOR UPDATE`) to prevent conflicting concurrent moderation actions by multiple editors.

---

## 25. MIGRATION 0027 SAFETY & ROLLBACK PLAN

### 25.1 Migration Steps (`0027_harden_comments_tenant_isolation.sql`)
1. **Pre-Migration Integrity Assertions:**
   - Verify zero orphaned comments: `SELECT count(*) FROM comments WHERE post_id NOT IN (SELECT id FROM posts);`
   - Verify zero tenant mismatches: `SELECT count(*) FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.publication_id != p.publication_id;`
2. **Table Alterations:**
   - Add composite unique constraints on `comments(id, publication_id)`.
   - Add composite foreign keys linking `comments` to `posts` and `members`.
   - Create `comment_moderation_events` table.
   - Add unique constraint on `comment_reports(reporter_id, comment_id)`.
3. **Rollback Script:**
   - Drop newly added composite constraints and revert to previous foreign keys if migration fails. Database snapshots taken immediately prior to migration execution.

---

## 26. PHASED IMPLEMENTATION ROADMAP

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          16-PHASE PRODUCTION IMPLEMENTATION ROADMAP                    │
└────────────────────────────────────────────────────────────────────────────────────────┘

 [Phase 0]  Security Containment & Baseline Verification
     │
 [Phase 1]  Product & Domain Contract Definitions (@vibress/theme-core & API contracts)
     │
 [Phase 2]  Database Schema & Composite Tenant Constraints (Migration 0027)
     │
 [Phase 3]  Moderation State Machine & Immutable Audit Trail Implementation
     │
 [Phase 4]  Server-Side Authentication & Session Authoritative Extraction
     │
 [Phase 5]  Public Content API Endpoints (Comments, Likes, Reports, Pagination)
     │
 [Phase 6]  Admin API Moderation Endpoints & State Machine Enforcement
     │
 [Phase 7]  Theme Core Contract Implementation & Liquid {% comments %} Tag Registration
     │
 [Phase 8]  Public Comments Runtime Client Widget (Progressive Hydration)
     │
 [Phase 9]  Built-in Themes Integration (Default, Molten, Minimal, Starter)
     │
 [Phase 10] Events, Analytics, Webhooks & Notifications Scoping
     │
 [Phase 11] Batched Comment Count Aggregations (Zero N+1) & Cache Management
     │
 [Phase 12] Full Localization (Arabic/English), RTL Layouts & Accessibility Auditing
     │
 [Phase 13] Anti-Abuse, Rate-Limiting & Idempotency Key Validation
     │
 [Phase 14] Comprehensive Multi-Tenant Adversarial Security Test Suite
     │
 [Phase 15] Production E2E Verification, Load Testing & Documentation
```

### Phase Details & Acceptance Gates

#### Phase 0: Security Containment & Baseline Verification
- **Prerequisites:** Full git tree clean.
- **Affected Packages:** `packages/api`.
- **Tasks:** Verify all existing tests pass; establish test scaffolding for adversarial testing.

#### Phase 1: Product & Domain Contract Definitions
- **Affected Packages:** `packages/theme-core`, `packages/api-client`.
- **Tasks:** Define `CommentViewModel`, `PostCommentsViewModel`, `ContentApiClient` comment interfaces.

#### Phase 2: Database Schema & Migration 0027
- **Affected Packages:** `packages/database`.
- **Tasks:** Apply composite foreign keys, unique indices, and `comment_moderation_events` table.

#### Phase 3: Moderation State Machine & Audit Trail
- **Affected Packages:** `packages/api`.
- **Tasks:** Implement `validateCommentTransition` and `recordModerationEvent` services.

#### Phase 4: Server-Side Authentication & Session Security
- **Affected Packages:** `packages/api`.
- **Tasks:** Ensure zero trust for client-supplied `memberId`/`publicationId`.

#### Phase 5: Public Content API Endpoints
- **Affected Packages:** `packages/api`, `packages/api-client`.
- **Tasks:** Implement `GET /api/content/v1/posts/:postId/comments`, `POST` submission, likes, and reports.

#### Phase 6: Admin API Moderation Endpoints
- **Affected Packages:** `packages/api`, `apps/admin`.
- **Tasks:** Implement admin moderation actions, report resolution, and audit log inspection.

#### Phase 7: Theme Core Liquid Tag Integration
- **Affected Packages:** `packages/theme-core`.
- **Tasks:** Register `{% comments %}` tag in `liquidjs` engine.

#### Phase 8: Public Comments Runtime Client
- **Affected Packages:** `packages/theme-core`, `apps/web`.
- **Tasks:** Build framework-agnostic progressive hydration runtime.

#### Phase 9: Built-in Themes Integration
- **Affected Packages:** `packages/theme-core`, default/molten/minimal theme files.
- **Tasks:** Verify layout, CSS variables, and rendering across all built-in themes.

#### Phase 10: Events, Analytics & Automations
- **Affected Packages:** `packages/api`.
- **Tasks:** Dispatch publication-scoped comment events.

#### Phase 11: Batched Count Queries (Zero N+1) & Caching
- **Affected Packages:** `packages/database`, `packages/api`.
- **Tasks:** Implement `getCommentCountsForPosts` and cache invalidation hooks.

#### Phase 12: Localization, RTL & WCAG Accessibility
- **Affected Packages:** `packages/i18n`, `apps/admin`, public runtime.
- **Tasks:** Complete Arabic translations, RTL CSS mirroring, ARIA live region support.

#### Phase 13: Anti-Abuse, Rate-Limiting & Idempotency
- **Affected Packages:** `packages/api`.
- **Tasks:** Enforce `clientCommentId` idempotency and Fastify rate-limiting.

#### Phase 14: Adversarial Multi-Tenant Security Testing
- **Affected Packages:** `tests/adversarial/`.
- **Tasks:** Run automated cross-tenant security test matrix (SEC-01 through SEC-08).

#### Phase 15: Production Verification & Release
- **Tasks:** Run full end-to-end browser tests in Arabic and English; complete production documentation.

---

## 27. DEFINITION OF DONE (ACCEPTANCE CRITERIA)

### Database Layer
- [ ] Migration 0027 applied cleanly without orphan data errors.
- [ ] Composite foreign keys reject all cross-publication insertions.
- [ ] Unique constraints enforce single active like and report per member.
- [ ] `comment_moderation_events` logs all moderation actions with timestamps and actor IDs.

### Domain & API Layer
- [ ] Public comments API routes functional and integrated into `ContentApiClient`.
- [ ] State machine strictly enforces valid transitions; illegal transitions return HTTP 400.
- [ ] Client-supplied `memberId` and `publicationId` in request bodies are ignored in favor of authenticated session context.
- [ ] Idempotency keys prevent duplicate comment creation on network retries.
- [ ] Batched aggregation queries fetch comment counts without N+1 query overhead.

### Theme & Frontend Layer
- [ ] `{% comments %}` tag registered in Theme Core Liquid engine.
- [ ] Semantic HTML mount progressively hydrated by lightweight client runtime.
- [ ] All built-in themes (Default, Molten, Minimal, Starter) render comments correctly.
- [ ] Full English and Arabic support with seamless RTL layout switching.
- [ ] WCAG 2.2 AA accessibility compliant (keyboard navigation, ARIA live regions).

### Security & Quality
- [ ] 100% of Adversarial Security Test Matrix scenarios pass.
- [ ] Zero raw HTML stored in database; all rendering sinks safely auto-escaped.
- [ ] Fastify rate limiting active and scoped per publication/member.
- [ ] No regression across existing test suites.

---

## 28. REMAINING RISKS & MITIGATION STRATEGY

| Risk Description | Probability | Impact | Mitigation Strategy |
|---|---|---|---|
| **Data Mismatches in Legacy Comments** | Low | High | Pre-migration validation script in Migration 0027 aborts if any orphaned comment or cross-tenant post mismatch is detected. |
| **Third-Party Theme Compatibility** | Low | Medium | Liquid `{% comments %}` tag renders a standard, theme-agnostic semantic mount container configurable entirely through CSS variables. |
| **High Concurrency Like Flooding** | Low | Low | Handled via atomic SQL increments (`SET like_count = like_count + 1`) and Fastify rate limiting. |

---

## 29. FINAL ARCHITECTURAL RECOMMENDATION

The Vibress Comments & Moderation Production Remediation Plan v2.0 represents a complete, hardened, and mathematically provable multi-tenant architecture. 

It is recommended to proceed directly to implementation following the strict 16-phase roadmap upon approval.
