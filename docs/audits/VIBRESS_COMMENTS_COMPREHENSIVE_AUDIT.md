# VIBRESS — COMMENTS COMPREHENSIVE AUDIT
**Cross-Product, API, Database, Multi-Tenancy, Admin, Member, Public Web & Theme Architecture Analysis**

---

## 1. Executive Summary

### 1.1 Executive Overview
An exhaustive, independent architecture and security audit was conducted on the Vibress Comments & Moderation system. The investigation examined the complete lifecycle across the visitor/member experience, theme rendering engine, public web application, client validation, Fastify API routes, authentication/session middleware, domain models, database schema, moderation queues, event bridges, and caching layers.

The audit reveals that **the Comments system is fundamentally incomplete and broken across multiple architectural layers**:
1. **Zero Public Web & Theme Support**: There is no comments rendering or submission UI in any built-in theme (`default`, `molten`, `minimal`), nor in the starter Liquid theme (`content/theme-starter/templates/post.liquid`), nor in `@vibress/theme-core`. Third-party themes cannot render or submit comments because no Theme API, Liquid helper, or client widget exists.
2. **Missing Multi-Tenancy & Publication Scoping**: Database tables (`comments`, `comment_likes`, `comment_reports`) have no `publication_id` column. All admin queries in `apps/api/src/routes/recommendations.ts` fetch comments globally without publication boundaries, exposing a critical cross-tenant data leak. Furthermore, members from Publication A can post comments on posts belonging to Publication B.
3. **Broken Admin Moderation UI**:
   - The Reports badge in `CommunitySettings.tsx` filters for `r.status === "open"`, while the database schema and repositories create reports with default status `"pending"`. As a result, the badge always shows `0` open reports.
   - The "Mark Resolved" action button in `ReportsPanel.tsx` checks `r.status === "open"`, meaning moderators **cannot resolve any new reports** through the UI.
   - The `CommentsPanel.tsx` component classifies both `"pending_review"` and `"deleted"` comments as "Visible" with a green badge, and allows deleted comments to be resurrected as `"hidden"` due to the lack of a state machine.
4. **Architectural Misplacement**: Admin comment moderation routes (`/api/admin/v1/comments`, `/comment-reports`) are incorrectly implemented inside `apps/api/src/routes/recommendations.ts` instead of a dedicated comments route module.
5. **Event Bridge Multi-Tenancy Degradation**: Domain events (`comment.created`, `comment.replied`) omit `publicationId`, causing downstream analytics to default to `"pub_default"` and preventing webhook subscriptions from isolating events per publication.

### 1.2 Summary Answers to Key Audit Questions

| Question | Audit Finding & Assessment |
| :--- | :--- |
| **1. What is currently broken?** | Public comment rendering/forms (non-existent), Admin report count & resolution (broken logic), Admin status badge mapping (misleading), Publication isolation (missing), Event bridge publication routing (missing). |
| **2. Where is it broken?** | Database schema, Domain services, Fastify API routes, Admin React UI, Theme Core view-models, Theme Engine Liquid tags, Built-in themes, Web app SSR pages, Event bridges. |
| **3. What is the root cause?** | The feature was partially implemented as a backend-only prototype with mock-focused unit tests, without extending the database schema with `publication_id` when multi-tenancy was introduced, and without completing the theme contract or front-end widgets. |
| **4. Primary failure layer?** | **Multiple layers simultaneously**: Database schema (missing tenancy), API routing (misplacement & missing tenant guards), Admin UI (logic bugs), and Theme architecture (complete omission). |
| **5. Security vulnerabilities?** | **P0 Cross-Tenant Comment & Report Leak**, **P0 Cross-Publication Comment Injection**, **P1 Stored Unescaped Special Characters Injection**, **P1 Pre-Moderation Bypass via Direct State Assignment**. |
| **6. Data integrity risks?** | Deleting a member cascades and destroys comment history (loss of discussion threads); soft-delete/tombstone body overwrite is irreversible if restored; missing composite indexes cause high-latency queries under load. |
| **7. Can third-party themes support Comments?** | **No**. The Theme SDK, Theme Core view-models, Liquid engine, and documentation contain zero comment contracts, tags, or helpers. |
| **8. What must be redesigned vs fixed?** | **Redesign**: Database multi-tenancy schema, Theme Comments Contract & Web Component, Moderation State Machine. **Fix**: Admin report resolution & status badges, API route separation, Event payload publication scoping. |
| **9. Recommended implementation order?** | Contract Definition → Database Migration (add `publication_id`) → Domain & State Machine → API Routes & Auth Hardening → Admin Moderation UI → Theme SDK & Core → Web App & Built-in Themes → Security & Cache Invalidation. |
| **10. What should NOT be changed?** | The member session authentication mechanism (`requireMemberSession`), basic rate-limiting middleware, and core post/author relationships should be preserved. |

---

## 2. Current Feature Scope

### 2.1 Intended vs Actual Capabilities

```
+----------------------------------------------------------------------------------------------------+
|                                    CURRENT CAPABILITY AUDIT                                         |
+------------------------------------+-----------------------------+---------------------------------+
| Feature Area                       | Intended / Documented       | Actual Code Reality             |
+------------------------------------+-----------------------------+---------------------------------+
| Member Comment Creation            | Authenticated members only  | Working (API-only, no Theme UI) |
| Anonymous Comments                 | Not supported               | Rejected with 401 (Working)     |
| Pre-Moderation                     | Optional via site settings  | Broken (Staff cannot approve)   |
| Threaded Replies                   | Max depth 5, nested replies | Working in domain; no Theme UI  |
| Comment Likes                      | Member toggle               | Working in domain; no Theme UI  |
| Comment Reports                    | 1 per member per comment    | DB writes work; Admin UI broken |
| Admin Hide / Restore / Delete      | Staff moderation actions    | State corruption on restore     |
| Multi-Publication Isolation        | Strict tenant isolation     | COMPLETELY MISSING              |
| Public Web / Theme Rendering       | Standardized post comments  | COMPLETELY MISSING              |
| Liquid Theme Tags / Filters        | Theme SDK integration       | COMPLETELY MISSING              |
| Notifications on Reply / Hide      | In-app member notifications | Working in DB; Portal string ok |
| Analytics & Automations Bridging   | Event-driven metrics        | Broken (Defaults to pub_default)|
+------------------------------------+-----------------------------+---------------------------------+
```

---

## 3. Architecture Overview

### 3.1 Layer Architecture Map

```
+----------------------------------------------------------------------------------------------------+
|                                 VIBRESS COMMENT SYSTEM LAYERS                                       |
+----------------------------------------------------------------------------------------------------+
|  [Admin SPA (React)]              [Public Web (Next.js SSR)]           [Portal App (React)]         |
|  - CommunitySettings.tsx          - posts/[slug]/page.tsx              - NotificationsSection.tsx   |
|  - CommentsPanel.tsx              - theme-renderer.tsx                 (Reads reply/hide notifs)    |
|  - ReportsPanel.tsx               (No comment components!)                                          |
+----------------------------------------------------------------------------------------------------+
                                               │
                                               ▼
+----------------------------------------------------------------------------------------------------+
|  [Fastify API (apps/api)]                                                                          |
|  - /api/members/v1/comments (routes/comments.ts)                                                   |
|  - /api/content/v1/posts/:postId/comments (routes/comments.ts)                                     |
|  - /api/admin/v1/comments & /comment-reports (routes/recommendations.ts <--- MISPLACED!)          |
+----------------------------------------------------------------------------------------------------+
                                               │
                                               ▼
+----------------------------------------------------------------------------------------------------+
|  [Domain Package (@vibress/comments)]                                                              |
|  - CommentsService (application/comments-service.ts)                                               |
|  - CommentDomainError, sanitizeCommentBody (domain/comment.ts)                                     |
|  - Repositories: DrizzleCommentRepository, DrizzleCommentLikeRepo, DrizzleCommentReportRepo        |
+----------------------------------------------------------------------------------------------------+
                                               │
                                               ▼
+----------------------------------------------------------------------------------------------------+
|  [Database Schema (@vibress/database)]                                                             |
|  - schema/community.ts: comments, comment_likes, comment_reports                                   |
|  (MISSING: publication_id column, moderation audit fields, approval status enum)                   |
+----------------------------------------------------------------------------------------------------+
```

---

## 4. Complete Comments Data Flow

### 4.1 End-to-End Trace & Failure Points

```
[Reader/Member]
      │
      ▼
1. Public Web / Theme (apps/web)
   └── File: apps/web/src/themes/default/components/Post.tsx:L140
       Status: ❌ BROKEN (Zero comment markup, zero form, zero script tags)
      │
      ▼
2. API Submission (POST /api/members/v1/comments)
   └── File: apps/api/src/routes/comments.ts:L65-144
       Auth: requireMemberSession, validateMemberOrigin (✅ Passed)
       Settings Check: commentAccess ("all" | "paid" | "disabled") (✅ Passed)
       Publication Check: ❌ FAILED (Does not verify if post belongs to member's publication)
      │
      ▼
3. Domain Service (CommentsService.createComment)
   └── File: packages/domains/comments/src/application/comments-service.ts:L64-146
       Sanitization: sanitizeCommentBody (⚠️ Strips HTML tags, but leaves raw scripts text)
       Threading & Depth Check: depth <= 5 (✅ Passed)
       Database Persistence: DrizzleCommentRepository.create (❌ Inserts without publicationId)
       Notifications: Notifies parent author on reply (✅ Passed)
       Events: domainEvents.emit("comment.created", { commentId, postId, memberId })
               (❌ Fails to include publicationId in event payload)
      │
      ▼
4. Database Persistence (PostgreSQL)
   └── File: packages/database/src/schema/community.ts:L13-49
       Status: ❌ Persisted with NO publication_id. Global database pollution.
      │
      ▼
5. Admin Moderation Queue (GET /api/admin/v1/comments)
   └── File: apps/api/src/routes/recommendations.ts:L194-225 (Misplaced in recommendations.ts)
       Auth: requireStaffSession, requirePermission("comments.read") (✅ Passed)
       Tenant Filter: ❌ FAILED (Queries all comments across the entire DB instance)
      │
      ▼
6. Admin UI Rendering (CommentsPanel.tsx & ReportsPanel.tsx)
   └── File: apps/admin/src/components/CommunitySettings.tsx:L46
       Status: ❌ BROKEN (Reports count checks r.status === "open" vs DB "pending")
       Status: ❌ BROKEN (Reports resolution button disabled for all pending reports)
       Status: ❌ BROKEN (Status badge renders "pending_review" and "deleted" as "Visible")
```

---

## 5. Database Audit

### 5.1 Schema Definition Inspection
Inspection of `packages/database/src/schema/community.ts`:

```typescript
// packages/database/src/schema/community.ts: Lines 13-49
export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }), // ⚠️ Issue: Hard-delete destroys discussion
    parentId: text("parent_id"),
    body: text("body").notNull(),
    status: text("status").notNull().default("published"),   // ⚠️ Issue: Plain text, no enum validation
    likeCount: integer("like_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    depth: integer("depth").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // ❌ CRITICAL DEFICIENCY: publication_id is completely missing
    // ❌ DEFICIENCY: moderated_by, moderated_at, moderation_reason are missing
  },
  (table) => ({
    postIdx: index("comments_post_idx").on(table.postId),
    memberIdx: index("comments_member_idx").on(table.memberId),
    parentIdx: index("comments_parent_idx").on(table.parentId),
    statusIdx: index("comments_status_idx").on(table.status),
    postStatusIdx: index("comments_post_status_idx").on(table.postId, table.status),
    // ❌ MISSING: Composite index on (publication_id, post_id, status, created_at)
  })
);
```

### 5.2 Schema Findings & Gaps Matrix

| Table | Column / Constraint | Status | Severity | Technical Impact |
| :--- | :--- | :--- | :--- | :--- |
| `comments` | `publication_id` | **MISSING** | **P0 — Critical** | Comments cannot be isolated by tenant; queries scan entire DB. |
| `comments` | `member_id` foreign key | **ON DELETE CASCADE** | **P1 — High** | When a member is deleted, all their comments and child replies disappear, destroying thread integrity. Should be `SET NULL` with tombstone. |
| `comments` | `status` | `text default 'published'` | **P2 — Medium** | No DB-level check constraint for allowed statuses (`published`, `pending_review`, `hidden`, `deleted`, `rejected`). |
| `comments` | `moderated_at`, `moderated_by` | **MISSING** | **P2 — Medium** | Lack of auditability for staff moderation actions. |
| `comment_likes` | `publication_id` | **MISSING** | **P0 — Critical** | Likes cannot be scoped or purged by publication. |
| `comment_reports` | `publication_id` | **MISSING** | **P0 — Critical** | Reports from all publications leak into a single admin view. |
| `comment_reports` | `status` default | `pending` | **P1 — High** | Mismatches Admin UI which expects `"open"`. |

---

## 6. Multi-Tenancy & Publication Scoping Audit

### 6.1 Vulnerability Trace: Cross-Tenant Data Access
Vibress enforces strict publication isolation on `posts`, `pages`, `tags`, `members`, `newsletters`, and `settings`. However, **the comments domain was entirely omitted from this multi-tenant boundary**.

```
[Attacker with Staff Token in Publication B]
      │
      ▼
GET /api/admin/v1/comments?limit=50
      │
      ▼
routes/recommendations.ts:L209
commentsService.listCommentsForModeration(params)
      │
      ▼
drizzle-comment-repositories.ts:L110
SELECT * FROM comments ORDER BY created_at DESC LIMIT 50;
      │
      ▼
❌ Result: Staff user of Publication B reads private comments from Publication A!
```

### 6.2 Vulnerability Trace: Cross-Publication Member Commenting
`POST /api/members/v1/comments` in `apps/api/src/routes/comments.ts` (lines 65-144):
- The endpoint inspects `req.member.id` and verifies that the member has an active session in their registered publication.
- It parses `req.body.postId`.
- **It NEVER looks up the post in the database to verify `post.publicationId === req.member.publicationId`**.
- An authenticated member of `Publication A` can craft an API request targeting a `postId` from `Publication B` and inject comments into Publication B.

---

## 7. API Audit

### 7.1 Complete Endpoint Reality Matrix

| HTTP Method | Path | Actual File Location | Auth Middleware | Publication Check | Implementation Status | Quality / Bugs |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/content/v1/posts/:postId/comments` | `routes/comments.ts:L39` | None (Public) | Implicit (via post) | **IMPLEMENTED** | Unbounded pagination risk; missing rate limit. |
| `GET` | `/api/content/v1/posts/:postId/comments/count` | `routes/comments.ts:L56` | None (Public) | Implicit (via post) | **IMPLEMENTED** | Working. |
| `POST` | `/api/members/v1/comments` | `routes/comments.ts:L65` | `requireMemberSession` | ❌ **MISSING** | **IMPLEMENTED** | Cross-pub injection possible; pre-moderation works. |
| `PATCH` | `/api/members/v1/comments/:id` | `routes/comments.ts:L147` | `requireMemberSession` | ❌ **MISSING** | **IMPLEMENTED** | IDOR check on memberId passes; missing pub check. |
| `DELETE` | `/api/members/v1/comments/:id` | `routes/comments.ts:L193` | `requireMemberSession` | ❌ **MISSING** | **IMPLEMENTED** | Tombstone applied (`[deleted]`). |
| `POST` | `/api/members/v1/comments/:id/like` | `routes/comments.ts:L222` | `requireMemberSession` | ❌ **MISSING** | **IMPLEMENTED** | Toggle works; missing pub check. |
| `POST` | `/api/members/v1/comments/:id/report` | `routes/comments.ts:L248` | `requireMemberSession` | ❌ **MISSING** | **IMPLEMENTED** | Writes report with `status: "pending"`. |
| `GET` | `/api/admin/v1/comments` | `routes/recommendations.ts:L194` | `requireStaffSession`, `comments.read` | ❌ **MISSING** | **MISPLACED / LEAK** | Misplaced in recommendations.ts; cross-tenant leak. |
| `POST` | `/api/admin/v1/comments/:id/hide` | `routes/recommendations.ts:L227` | `requireStaffSession`, `comments.moderate` | ❌ **MISSING** | **MISPLACED** | Sets status to "hidden"; notifies member. |
| `POST` | `/api/admin/v1/comments/:id/restore` | `routes/recommendations.ts:L248` | `requireStaffSession`, `comments.moderate` | ❌ **MISSING** | **MISPLACED** | Restores to "published"; body remains `[deleted]` if deleted. |
| `POST` | `/api/admin/v1/comments/:id/delete` | `routes/recommendations.ts:L269` | `requireStaffSession`, `comments.moderate` | ❌ **MISSING** | **MISPLACED** | Sets body `[removed by moderator]` and status `deleted`. |
| `GET` | `/api/admin/v1/comment-reports` | `routes/recommendations.ts:L290` | `requireStaffSession`, `comments.read` | ❌ **MISSING** | **MISPLACED / LEAK** | Cross-tenant report leak. |
| `POST` | `/api/admin/v1/comment-reports/:id/resolve` | `routes/recommendations.ts:L304` | `requireStaffSession`, `comments.moderate` | ❌ **MISSING** | **MISPLACED** | Updates report status. |
| `POST` | `/api/admin/v1/comments/:id/approve` | N/A | None | N/A | **NOT IMPLEMENTED** | Required for pre-moderation approval. |
| `POST` | `/api/admin/v1/comments/:id/reject` | N/A | None | N/A | **NOT IMPLEMENTED** | Required for pre-moderation rejection. |
| `POST` | `/api/admin/v1/comments/bulk` | N/A | None | N/A | **NOT IMPLEMENTED** | Required for bulk moderation. |

---

## 8. Admin Comments & Moderation Audit

### 8.1 Analysis of Admin UI (`CommunitySettings.tsx`, `CommentsPanel.tsx`, `ReportsPanel.tsx`)

#### 1. The Reports Counter & Resolution Bug (Evidence)
In `apps/admin/src/components/CommunitySettings.tsx`:
```tsx
// Line 46:
const openReportsCount = reports.filter((r) => r.status === "open").length;
```
And in `apps/admin/src/components/community/ReportsPanel.tsx`:
```tsx
// Line 73:
{r.status === "open" && (
  <Button
    variant="outline"
    size="sm"
    onClick={() => handleResolveReport(r.id)}
    className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
  >
    Mark Resolved
  </Button>
)}
```
**The Failure**:
- `packages/database/src/schema/community.ts` (line 93) defines `status: text("status").notNull().default("pending")`.
- `DrizzleCommentReportRepository.create` (line 278) inserts `status: "pending"`.
- When a member reports a comment, the status is `"pending"`.
- Because `r.status !== "open"`, `openReportsCount` is evaluated as `0`.
- Because `r.status !== "open"`, the `Mark Resolved` button is **never rendered**. Staff cannot resolve any pending reports.

#### 2. Misleading Badges and State Confusion in `CommentsPanel.tsx` (Evidence)
In `apps/admin/src/components/community/CommentsPanel.tsx`:
```tsx
// Lines 94-109:
<TableCell>
  {c.status === "hidden" ? (
    <Badge
      variant="outline"
      className="text-[10px] font-mono px-2 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
    >
      Hidden
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
    >
      Visible
    </Badge>
  )}
</TableCell>
```
**The Failure**:
- The binary ternary operator (`c.status === "hidden" ? Hidden : Visible`) treats every status that is not `"hidden"` as "Visible".
- When a comment is in `"pending_review"`, it renders a **green "Visible" badge**, misleading the admin into thinking the unapproved comment is public.
- When a comment is `"deleted"`, it renders a **green "Visible" badge**.
- When an admin deletes a comment, the row remains in the table with body `"[removed by moderator]"` and a green "Visible" badge, displaying buttons "Hide" and "Delete".
- Clicking "Hide" on a deleted comment invokes `hideCommentApi(id)`, which sets status to `"hidden"` and un-deletes the record in an invalid state.

#### 3. Diagnostic Trace of Screenshot Payload (`alert("xss")"Hello`)
- The screenshot shows a comment with body `alert("xss")"Hello`.
- This occurred because a user submitted `<script>alert("xss")</script>"Hello`.
- The backend sanitization function `sanitizeCommentBody` executed:
  `stripped = body.replace(/<[^>]*>/g, "")`
- This stripped `<script>` and `</script>`, leaving the inner text `alert("xss")"Hello`.
- In Admin React JSX (`CommentsPanel.tsx:L91`), `{c.body}` is rendered as text, preventing XSS execution in the Admin.
- However, because special characters like `"` are not encoded, raw template injection remains a risk if passed to non-escaped theme templates.

---

## 9. Public Web & Theme Architecture Audit

### 9.1 Theme Contract & Rendering Gap Analysis
A comprehensive audit was performed across all themes and rendering pipelines:
1. `apps/web/src/themes/default/components/Post.tsx`:
   - Inspects `props.post`, renders article header, author avatar, reading time, table of contents, and `dangerouslySetInnerHTML={{ __html: post.html }}`.
   - **Does NOT render any comments section, comment count, or discussion block.**
2. `apps/web/src/themes/molten/components/Post.tsx`:
   - Inspects `props.post`, renders header, meta, and `post.html`.
   - `screen.css` contains unused CSS classes (`.vb-comments`, `.vb-comments-header`), but `Post.tsx` **contains zero comment JSX**.
3. `content/theme-starter/templates/post.liquid`:
   - Renders article title, author, date, and `{{ post.html }}`.
   - **Contains zero Liquid tags or includes for comments.**
4. `packages/theme-core/src/theme-engine.ts`:
   - Registers Liquid filters: `t`, `translate`, `is_rtl`, `direction`, `asset_url`, `post_url`, `format_date`, `format_number`, `pagination_url`.
   - Registers Liquid tags: `asset`, `route`, `t`, `locale_switcher`.
   - **Contains ZERO Liquid tags or filters for comments (`comments`, `comment_form`, `comment_count`).**
5. `packages/theme-core/src/view-models.ts`:
   - `PostViewModel` (lines 297-375) does **not** expose `comments`, `commentCount`, or discussion state.
   - `ThemePostContext` (lines 127-135) only passes `{ site, post, settings, theme }`.

### 9.2 Third-Party Theme Feasibility
**Conclusion**: A third-party developer creating a theme for Vibress **cannot implement comments today** using standard platform tools. They would have to write custom client-side JavaScript that directly hits `/api/members/v1/comments` and `/api/content/v1/posts/:postId/comments`, handling auth cookies and CORS manually.

---

## 10. Security & Threat Analysis

### 10.1 Threat Modeling Matrix

```
+----------------------------------------------------------------------------------------------------+
|                                    SECURITY THREAT MATRIX                                          |
+---------------------+-------------+------------------------------------+---------------------------+
| Threat Scenario     | Severity    | Affected Layer                     | Status / Mitigation Gap   |
+---------------------+-------------+------------------------------------+---------------------------+
| Multi-Tenant Leak   | P0 Critical | API & Database Repositories        | No publication_id filter  |
| Cross-Pub Injection | P0 Critical | API routes/comments.ts             | Post ownership not checked|
| Incomplete XSS San. | P1 High     | CommentsService.sanitizeCommentBody| Only strips HTML tags     |
| Pre-Mod Bypass      | P1 High     | State transitions & API routes     | No state machine guard    |
| Cascade Destruction | P1 High     | DB Foreign Key (member_id)         | ON DELETE CASCADE         |
| Unbounded Scraping  | P2 Medium   | GET /posts/:postId/comments        | Missing Rate Limiting     |
| CSRF on Comments    | Low (Safe)  | validateMemberOrigin middleware    | Origin header enforced    |
+---------------------+-------------+------------------------------------+---------------------------+
```

---

## 11. Moderation State Machine Audit

### 11.1 State Machine Discrepancies
The system lacks a formal state transition machine. State transitions currently occur via raw string overwrites in `updateStatus(id, status)`:

```
[Current Wildcard Transitions - UNGOVERNED]

          ┌───────────────────────┐
          │      published        │◄───────────┐
          └──────────┬────────────┘            │
                     │                         │
         ┌───────────┴───────────┐             │
         ▼                       ▼             │ (restoreComment)
┌─────────────────┐     ┌─────────────────┐    │
│     hidden      │     │     deleted     ├────┘ (Corrupts body!)
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────────────────┘
```

### 11.2 Flaws in Current State Flow:
1. **Permanent Data Loss on Restore**: When `deleteComment` or `adminDeleteComment` is called, the body is overwritten in the DB with `"[deleted]"` or `"[removed by moderator]"`. If a moderator later clicks "Restore" (`restoreComment`), the status becomes `"published"`, but the original text is permanently lost.
2. **Missing Pre-Moderation Flow**: When pre-moderation is enabled, comments are inserted as `"pending_review"`. But there are no endpoints to transition `"pending_review"` → `"published"` (Approve) or `"pending_review"` → `"rejected"` (Reject).

---

## 12. Caching, SSR & Revalidation Audit

1. **Web SSR Layer (`apps/web/src/app/posts/[slug]/page.tsx`)**:
   - `export const revalidate = 0;` (Dynamic SSR).
   - If comments are rendered server-side in the future, Next.js cache tags (`revalidateTag("comments:${postId}")`) must be triggered by domain events.
2. **Theme File Memory Cache (`apps/web/src/lib/theme-renderer.tsx`)**:
   - `themeFilesCache` stores parsed theme templates for 60 seconds.
   - This cache is safe for templates, but does not cache dynamic data.
3. **API Response Caching**:
   - `/api/content/v1/posts/:postId/comments` does not set `Cache-Control` or ETag headers.

---

## 13. Events, Workers & Analytics Audit

1. **Outbound Webhooks (`apps/api/src/webhook-event-bridge.ts`)**:
   - Listens to `comment.created` and `comment.replied`.
   - Calls `webhooksService.dispatchEvent(event.name, event.payload)`.
   - **Bug**: `event.payload` does not contain `publicationId`. If multiple publications register webhooks for `comment.created`, the dispatcher cannot route the event exclusively to the correct tenant's webhook endpoints.
2. **Analytics Ingestion (`apps/api/src/async-bridge.ts`)**:
   - Line 87: `const pubId = (payload.publicationId as string) || "pub_default";`
   - Because `comment.created` emits `{ commentId, postId, memberId }` without `publicationId`, all comment analytics are attributed to `"pub_default"`.
3. **Automations Engine (`apps/api/src/async-bridge.ts:L153`)**:
   - Listens to `comment.created` and passes payload to `automationsService.handleEvent`.
   - Fails to filter by publication context.

---

## 14. Localization, Accessibility & Responsive UX

1. **Localization (`packages/i18n`)**:
   - `packages/i18n/src/dictionaries/en.ts` and `ar.ts` lack keys for comment actions, states, and counts.
   - Admin components (`CommentsPanel.tsx`, `ReportsPanel.tsx`) contain hardcoded English strings: `"Member ID"`, `"Comment Content"`, `"No comments found"`, `"Mark Resolved"`, `"Restore"`, `"Hide"`, `"Delete"`.
2. **Accessibility (a11y)**:
   - Status indicators in `CommentsPanel` and `ReportsPanel` use background colors (`bg-red-500/10`, `bg-emerald-500/10`) without explicit screen reader text (`sr-only` descriptions).
   - Action buttons lack descriptive `aria-label`s (e.g., `aria-label="Hide comment by member {memberId}"`).
3. **Responsive UX**:
   - `CommentsPanel` uses standard HTML `<table>`, which causes horizontal scrolling and text truncation on mobile devices.
   - Raw UUID member IDs (`memberId`) take up excessive screen width without tooltip or popover cards.

---

## 15. Existing Test Coverage Analysis

### 15.1 Test Audit Matrix

| Test Suite File | Test Count | Scope & Focus | Effectiveness / Blindspots |
| :--- | :--- | :--- | :--- |
| `packages/domains/comments/tests/comments-service.test.ts` | 17 tests | Unit tests with mocked repositories | ⚠️ **Mocked Blindspot**: Tests state transitions and depth against idealized in-memory mocks; does not test SQL queries, publication boundaries, or schema constraints. |
| `apps/api/src/__tests__/community-api.test.ts` | 33 tests | Fastify route injection integration | ⚠️ **Single-Tenant Blindspot**: Runs against single database with `pub_default`. Never tests cross-tenant isolation or multi-publication attacks. |
| `tests/e2e/community.test.ts` | 2 test suites | API injection via Playwright context | ⚠️ **UI Blindspot**: Tests API responses only; does NOT test Admin React UI (`CommunitySettings.tsx`) or public theme rendering in the browser. |
| **Theme Comments Tests** | **0 tests** | None | ❌ **Completely Missing**: Zero tests for theme rendering of comments. |
| **Multi-Tenant Comments Tests** | **0 tests** | None | ❌ **Completely Missing**: Zero tests asserting that Publication A cannot access Publication B comments. |

---

## 16. Feature Completeness Matrix

| Feature Area | Expected Capability | Implemented in Backend | Admin UI Working | Theme Support | Multi-Tenant Isolated | Tests Verify Behavior | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Comment Creation** | Member submits comment on published post | Yes | N/A | ❌ No | ❌ No | Partial (API only) | **PARTIAL** |
| **Threaded Replies** | Nested reply up to depth 5 | Yes | N/A | ❌ No | ❌ No | Partial (API only) | **PARTIAL** |
| **Comment Editing** | Member edits own comment body | Yes | N/A | ❌ No | ❌ No | Partial (API only) | **PARTIAL** |
| **Comment Deletion** | Member soft-deletes (tombstone) | Yes | N/A | ❌ No | ❌ No | Partial (API only) | **PARTIAL** |
| **Comment Likes** | Member likes / unlikes comment | Yes | N/A | ❌ No | ❌ No | Partial (API only) | **PARTIAL** |
| **Comment Reports** | Member reports abusive comment | Yes | ❌ Broken | ❌ No | ❌ No | Partial (API only) | **BROKEN** |
| **Admin Comment List** | Staff reviews comments in publication | Yes | Partial | N/A | ❌ No (Leak) | False Positive | **BROKEN** |
| **Admin Moderation** | Staff hides / restores / deletes | Yes | Partial | N/A | ❌ No (Leak) | False Positive | **PARTIAL** |
| **Pre-Moderation Approval** | Staff approves pending comments | ❌ No | ❌ No | ❌ No | ❌ No | None | **MISSING** |
| **Report Resolution** | Staff marks reports as resolved | Yes | ❌ Broken | N/A | ❌ No (Leak) | False Positive | **BROKEN** |
| **Public Post Rendering** | Comments list & form on post page | ❌ No | N/A | ❌ No | N/A | None | **MISSING** |
| **Theme SDK Integration** | Liquid tags / View-models for themes | ❌ No | N/A | ❌ No | N/A | None | **MISSING** |
| **Event Bridge Scoping** | Webhooks & Analytics isolated by pub | ❌ No | N/A | N/A | ❌ No | None | **BROKEN** |
| **Localization & RTL** | English / Arabic dictionaries & layouts | ❌ No | ❌ No | ❌ No | N/A | None | **MISSING** |

---

## 17. Root Cause Analysis (Detailed Breakdown)

### P0 Issues (Critical Security & Data Isolation)

#### ROOT-CAUSE-P0-1: Missing `publication_id` in Community Database Tables
- **Symptom**: Admin comment listing and moderation routes access all comments across all publications in the database instance.
- **Affected Layer**: `packages/database/src/schema/community.ts`, `packages/domains/comments/src/infrastructure/drizzle-comment-repositories.ts`, `apps/api/src/routes/recommendations.ts`.
- **Root Cause**: When multi-tenancy was introduced across Vibress, the `comments`, `comment_likes`, and `comment_reports` tables were not migrated to include `publication_id`.
- **Security Impact**: Cross-tenant data breach. Staff of Publication A can view, hide, restore, or delete comments from Publication B.
- **Recommended Fix**: Add a database migration adding `publication_id` with foreign key referencing `publications.id` (ON DELETE CASCADE), backfill existing records, and enforce `publication_id` filtering on all repository queries.

#### ROOT-CAUSE-P0-2: Missing Publication Check on Member Comment Creation
- **Symptom**: Members registered in Publication A can submit comments on posts belonging to Publication B.
- **Affected Layer**: `apps/api/src/routes/comments.ts:L65-144`.
- **Root Cause**: The route handler verifies that the member session is valid in the member's publication, but never checks if the target `post.publicationId` matches `req.member.publicationId`.
- **Security Impact**: Unauthorized cross-publication content injection.
- **Recommended Fix**: Fetch the post record in the route handler or service and assert `post.publicationId === req.member.publicationId`.

---

### P1 Issues (Core Functionality Broken / Misplaced)

#### ROOT-CAUSE-P1-1: Report Status Mismatch in Admin UI
- **Symptom**: Reports tab shows `0` open reports, and the "Mark Resolved" button is never rendered for new reports.
- **Affected Layer**: `packages/database/src/schema/community.ts:L93`, `apps/admin/src/components/CommunitySettings.tsx:L46`, `apps/admin/src/components/community/ReportsPanel.tsx:L73`.
- **Root Cause**: The database defaults `comment_reports.status` to `"pending"`, but the React components hardcode checks for `r.status === "open"`.
- **User Impact**: Administrators cannot see the pending reports count or resolve member reports through the UI.
- **Recommended Fix**: Align the status contract across the schema, domain, API, and UI to use `"pending"` (or `"open"`) consistently.

#### ROOT-CAUSE-P1-2: Complete Omission of Comments from Public Web & Themes
- **Symptom**: No comments appear on any post on the public site; readers have no way to view or submit comments.
- **Affected Layer**: `apps/web/src/themes/*`, `content/theme-starter/*`, `packages/theme-core/*`.
- **Root Cause**: Comments were implemented only up to the backend API layer. The theme view-models (`PostViewModel`, `ThemePostContext`), Liquid engine tags, and theme React components were never built.
- **User Impact**: Comments feature is 100% inoperable from a reader's perspective.
- **Recommended Fix**: Implement standardized theme view-model mappings, create Liquid tags (`{% comments %}`, `{% comment_form %}`), build a lightweight client-side Web Component/React comment widget, and integrate into built-in and starter themes.

#### ROOT-CAUSE-P1-3: Misplacement of Admin Moderation Routes in `recommendations.ts`
- **Symptom**: Comment moderation endpoints are defined inside `apps/api/src/routes/recommendations.ts`.
- **Affected Layer**: `apps/api/src/routes/recommendations.ts`, `apps/api/src/main.ts`.
- **Root Cause**: Architectural misplacement during rapid initial development.
- **Architectural Impact**: Code maintainability debt, confused route boundaries, and failure to apply standard publication middleware.
- **Recommended Fix**: Extract `adminCommentModerationRoutes` into `apps/api/src/routes/admin-comments.ts` and register properly in `main.ts`.

---

### P2 Issues (Major UX & State Integrity Flaws)

#### ROOT-CAUSE-P2-1: Flawed Status Badging & State Resurrecting in `CommentsPanel.tsx`
- **Symptom**: `"pending_review"` and `"deleted"` comments display green "Visible" badges; deleted comments can be restored into a corrupted state.
- **Affected Layer**: `apps/admin/src/components/community/CommentsPanel.tsx:L94-142`, `packages/domains/comments/src/application/comments-service.ts:L310-338`.
- **Root Cause**: The UI uses a simplistic binary check `c.status === "hidden" ? Hidden : Visible` instead of handling all domain states, and the service allows arbitrary state overwrites without validation.
- **Recommended Fix**: Build a formal state machine in the domain layer, and update the UI with specific badges and actions for each state (`Published`, `Pending Review`, `Hidden`, `Deleted`, `Rejected`).

#### ROOT-CAUSE-P2-2: Missing `publicationId` in Domain Events
- **Symptom**: Webhook deliveries and analytics events for comments default to `"pub_default"`.
- **Affected Layer**: `packages/domains/comments/src/application/comments-service.ts`, `apps/api/src/webhook-event-bridge.ts`, `apps/api/src/async-bridge.ts`.
- **Root Cause**: `domainEvents.emit("comment.created", ...)` omitted `publicationId`.
- **Recommended Fix**: Include `publicationId` in all comment domain event payloads.

---

## 18. Target Architecture Design

### 18.1 Target Database Schema

```
                                  +-----------------------+
                                  |     publications      |
                                  +-----------┬-----------+
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     │ 1:N                    │ 1:N                    │ 1:N
                     ▼                        ▼                        ▼
           +-------------------+    +-------------------+    +-------------------+
           |       posts       |    |      members      |    |     comments      |
           +---------┬---------+    +---------┬---------+    +---------┬---------+
                     │                        │                        │
                     │ 1:N                    │ 1:N                    │
                     └────────────────────────┼────────────────────────┘
                                              │
                                              ▼
                                   +---------------------+
                                   |      comments       |
                                   +---------------------+
                                   | id (PK)             |
                                   | publication_id (FK) | <─── Added
                                   | post_id (FK)        |
                                   | member_id (FK/Null) | <─── ON DELETE SET NULL
                                   | parent_id (FK/Null) |
                                   | body (text)         |
                                   | status (enum)       | <─── published, pending_review, hidden, deleted, rejected
                                   | like_count (int)    |
                                   | reply_count (int)   |
                                   | depth (int)         |
                                   | moderated_by (FK)   | <─── Added
                                   | moderated_at (ts)   | <─── Added
                                   | moderation_reason   | <─── Added
                                   | created_at (ts)     |
                                   | updated_at (ts)     |
                                   | deleted_at (ts)     |
                                   +----------┬----------+
                                              │
                                              ├────────────────────────┐
                                              │ 1:N                    │ 1:N
                                              ▼                        ▼
                                   +---------------------+  +---------------------+
                                   |    comment_likes    |  |   comment_reports   |
                                   +---------------------+  +---------------------+
                                   | id (PK)             |  | id (PK)             |
                                   | publication_id (FK) |  | publication_id (FK) |
                                   | comment_id (FK)     |  | comment_id (FK)     |
                                   | member_id (FK)      |  | reporter_id (FK)    |
                                   | created_at (ts)     |  | reason (text)       |
                                   +---------------------+  | status (enum)       | <─── pending, resolved, dismissed
                                                            | resolved_by (FK)    |
                                                            | resolved_at (ts)    |
                                                            | created_at (ts)     |
                                                            +---------------------+
```

### 18.2 Target Moderation State Machine

```
                   ┌────────────────────────────────────────┐
                   │               [CREATE]                 │
                   └───────────────────┬────────────────────┘
                                       │
                    Is Pre-Moderation Enabled for Publication?
                                       │
                      ┌────────────────┴────────────────┐
                      │ No                              │ Yes
                      ▼                                 ▼
             ┌─────────────────┐               ┌─────────────────┐
             │    published    │               │ pending_review  │
             └────────┬────────┘               └────────┬────────┘
                      │                                 │
           ┌──────────┼──────────┐            ┌─────────┴─────────┐
           │          │          │            │ Approve           │ Reject
           ▼          ▼          ▼            ▼                   ▼
    ┌──────────┐┌──────────┐┌──────────┐┌───────────┐       ┌───────────┐
    │  hidden  ││ deleted  ││ reported ││ published │       │ rejected  │
    └────┬─────┘└──────────┘└──────────┘└───────────┘       └───────────┘
         │ (Restore)
         ▼
  ┌─────────────┐
  │  published  │
  └─────────────┘
```

### 18.3 Target Theme Comments SDK Contract
For third-party and built-in themes, provide a standardized, drop-in Liquid tag and React component:

1. **Liquid Template Syntax**:
   ```liquid
   {% if site.comments.commentAccess != "disabled" %}
     <section class="vb-comments-section">
       {% comments post: post, access: site.comments.commentAccess %}
     </section>
   {% endif %}
   ```
2. **Standard Theme Client Widget**:
   A lightweight, accessible, zero-dependency script/component that:
   - Fetches comments from `GET /api/content/v1/posts/:postId/comments`.
   - Checks member session status via `/api/members/v1/session`.
   - Renders comment list, reply trees, like counts, and reply forms.
   - Handles localized text strings in English/Arabic and respects RTL directionality.

---

## 19. Detailed Implementation Roadmap

### Phase 0 — Baseline & Route Cleanliness
- **Objective**: Move admin moderation routes out of `routes/recommendations.ts` into a clean `routes/admin-comments.ts`.
- **Files Affected**:
  - `apps/api/src/routes/recommendations.ts`
  - `apps/api/src/routes/admin-comments.ts` [NEW]
  - `apps/api/src/main.ts`
- **Dependencies**: None.

### Phase 1 — Database Schema & Multi-Tenancy Migration
- **Objective**: Add `publication_id` to `comments`, `comment_likes`, and `comment_reports` with foreign keys and composite indexes. Change `member_id` foreign key delete rule to `SET NULL`.
- **Files Affected**:
  - `packages/database/src/schema/community.ts`
  - `packages/database/migrations/*` [NEW MIGRATION]
  - `packages/database/src/seed.ts`
- **Security Considerations**: Ensures physical database multi-tenant isolation.

### Phase 2 — Domain Layer & State Machine
- **Objective**: Update `CommentsService` and repositories to require `publicationId` on all operations, implement a formal moderation state machine, and include `publicationId` in domain events.
- **Files Affected**:
  - `packages/domains/comments/src/domain/comment.ts`
  - `packages/domains/comments/src/domain/repository.ts`
  - `packages/domains/comments/src/application/comments-service.ts`
  - `packages/domains/comments/src/infrastructure/drizzle-comment-repositories.ts`
- **Dependencies**: Phase 1.

### Phase 3 — Fastify API Route Hardening
- **Objective**: Enforce publication context on all member and admin comment routes. Verify that `post.publicationId === req.member.publicationId` on comment creation. Add `/approve` and `/reject` moderation endpoints.
- **Files Affected**:
  - `apps/api/src/routes/comments.ts`
  - `apps/api/src/routes/admin-comments.ts`
  - `packages/api-contracts/src/community.ts`
- **Dependencies**: Phase 2.

### Phase 4 — Admin Moderation UI Remediation
- **Objective**: Fix report count and report resolution logic. Update `CommentsPanel` to properly render all status badges (`Published`, `Pending Review`, `Hidden`, `Deleted`, `Rejected`) and provide approve/reject buttons.
- **Files Affected**:
  - `apps/admin/src/components/CommunitySettings.tsx`
  - `apps/admin/src/components/community/CommentsPanel.tsx`
  - `apps/admin/src/components/community/ReportsPanel.tsx`
  - `apps/admin/src/lib/api/comments.ts`
- **Dependencies**: Phase 3.

### Phase 5 — Theme Core & Liquid Engine Extensions
- **Objective**: Add `comments` view-models and Liquid tags (`{% comments %}`) to `@vibress/theme-core`. Expose comment counts and settings on `PostViewModel` and `ThemePostContext`.
- **Files Affected**:
  - `packages/theme-core/src/view-models.ts`
  - `packages/theme-core/src/theme-engine.ts`
  - `packages/theme-core/src/route-contract.ts`
- **Dependencies**: Phase 2.

### Phase 6 — Public Web & Built-in Themes Integration
- **Objective**: Build the public comment thread & form UI component. Integrate into built-in themes (`default`, `molten`, `minimal`) and starter Liquid templates (`content/theme-starter/templates/post.liquid`).
- **Files Affected**:
  - `apps/web/src/themes/default/components/Post.tsx`
  - `apps/web/src/themes/molten/components/Post.tsx`
  - `content/theme-starter/templates/post.liquid`
  - `content/theme-starter/partials/comments.liquid` [NEW]
  - `apps/web/src/components/comments/CommentSection.tsx` [NEW]
- **Dependencies**: Phase 5.

### Phase 7 — Localization, Accessibility & Security Hardening
- **Objective**: Add English and Arabic translation dictionaries for all comment and moderation strings. Support RTL layouts. Add HTML entity encoding for stored content.
- **Files Affected**:
  - `packages/i18n/src/dictionaries/en.ts`
  - `packages/i18n/src/dictionaries/ar.ts`
  - `apps/admin/src/components/community/CommentsPanel.tsx`
  - `apps/web/src/components/comments/CommentSection.tsx`
- **Dependencies**: Phase 6.

### Phase 8 — Comprehensive Verification & E2E Testing
- **Objective**: Implement multi-tenant isolation tests, browser-based Admin moderation E2E tests, and theme rendering verification tests.
- **Files Affected**:
  - `packages/domains/comments/tests/*`
  - `apps/api/src/__tests__/community-api.test.ts`
  - `tests/e2e/community.test.ts`
- **Dependencies**: Phases 0–7.

---

## 20. Future Test Strategy & Test Plan

1. **Database Unit Tests**:
   - Verify that querying comments for `publication_A` returns 0 comments from `publication_B`.
   - Verify that member deletion sets `comments.member_id = NULL` without deleting child comments.
2. **API Security Tests**:
   - Attempt to create a comment on Publication B's post using Publication A's member session → Assert `403 FORBIDDEN`.
   - Attempt to list comments via Admin API in Publication B → Assert only Publication B comments are returned.
3. **Admin Browser E2E Tests (Playwright)**:
   - Staff navigates to `/admin/comments`.
   - Submits a pre-moderated comment as a member.
   - Staff sees comment in "Pending Review" tab, clicks "Approve".
   - Verifies comment becomes visible on public post page.
   - Member reports comment; staff sees badge "1", navigates to Reports tab, and clicks "Mark Resolved".
4. **Theme Rendering Tests**:
   - Liquid theme renders `{% comments %}` tag and outputs semantic HTML container with localized text.

---

## 21. Definition of Done (DoD)

The Vibress Comments system will be certified complete only when all criteria are satisfied:
- [ ] Database schema enforces `publication_id` with foreign key and composite indexes across `comments`, `comment_likes`, `comment_reports`.
- [ ] Multi-tenant isolation verified: Cross-publication comment reads, writes, and moderation are strictly blocked.
- [ ] Member deletion preserves discussion thread structure (tombstone with `member_id: null`).
- [ ] Moderation state machine enforces valid transitions (`pending_review`, `published`, `hidden`, `deleted`, `rejected`).
- [ ] Admin Reports tab accurately displays pending count and enables staff to resolve reports.
- [ ] Admin Comments list displays accurate badges and functional moderation actions (Approve, Reject, Hide, Restore, Delete).
- [ ] Public post page renders comment list, reply thread, like button, report modal, and submission form.
- [ ] `@vibress/theme-core` exposes `PostViewModel` comments and Liquid `{% comments %}` tag.
- [ ] Built-in themes (`default`, `molten`, `minimal`) and starter Liquid theme render comments.
- [ ] Full localization in English and Arabic with verified RTL rendering.
- [ ] Domain events include `publicationId`, correctly routing webhooks and analytics.
- [ ] All automated unit, integration, multi-tenant security, and browser E2E tests pass.

---

## 22. Audit Conclusion & Final Verdict

- **Audit Status**: **COMPLETE**
- **Implementation Status**: **NOT PERFORMED** (Working tree strictly unmodified except for this audit report).
- **Classification**: **CRITICAL ARCHITECTURAL GAPS & DEFECTS IDENTIFIED**
- **Action Required**: Engineering team must execute the 8-phase implementation roadmap to bring Comments & Moderation to enterprise-grade production readiness.
