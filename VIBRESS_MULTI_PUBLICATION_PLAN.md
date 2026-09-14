# VIBRESS — MULTI-PUBLICATION & TENANCY ISOLATION PLAN
## Enterprise Resource Isolation, Schema Migration & Boundary Enforcement

---

## 1. Resource Isolation Audit & Data Ownership Truth

The Runtime Truth Audit proved that while `workspaces` and `publications` tables exist in PostgreSQL, **zero core publishing or membership tables possess a `publication_id` column**.

### Resource Ownership Matrix

| Resource | Current Storage | Direct `publication_id` Required? | Ownership Resolution Strategy |
| :--- | :--- | :---: | :--- |
| **Workspaces** | `workspaces` table | **No** (Parent Entity) | Top-level tenant container. Has many publications and workspace members. |
| **Publications** | `publications` table | **Self** (`id`) | Direct child of `workspaces`. Identified by unique `(workspace_id, slug)`. |
| **Posts** | `posts` table | **YES** | Add `publication_id` FK. Scope `(publication_id, slug)` uniqueness. |
| **Pages** | `pages` table | **YES** | Add `publication_id` FK. Scope `(publication_id, slug)` uniqueness. |
| **Post Revisions** | `revisions` table | **Inherited** | Inherits from `posts.publication_id`. Query joins `posts`. |
| **Media Assets** | `media` table | **YES** | Add `publication_id` FK. Prevent cross-publication asset enumeration. |
| **Taxonomies & Tags** | `tags` table | **YES** | Add `publication_id` FK. Scope `(publication_id, slug)` uniqueness. |
| **Editorial Comments** | `editorial_comments` | **Inherited** | Inherits from `posts.publication_id`. |
| **Editorial Suggestions** | `editorial_suggestions` | **Inherited** | Inherits from `posts.publication_id`. |
| **Editorial Assignments** | `editorial_assignments` | **Inherited** | Inherits from `posts.publication_id`. |
| **Members (Subscribers)** | `members` table | **YES** | Add `publication_id` FK. Subscribers belong to specific publications. |
| **Subscriptions** | `subscriptions` table | **Inherited** | Inherits from `members.publication_id` and `plans.publication_id`. |
| **Billing Plans** | `plans` table | **YES** | Add `publication_id` FK. Each publication defines its own pricing tiers. |
| **Newsletters** | `newsletters` table | **YES** | Add `publication_id` FK. Newsletters belong to a specific publication. |
| **Newsletter Sends** | `newsletter_sends` | **Inherited** | Inherits from `newsletters.publication_id`. |
| **Email Recipients** | `email_recipients` | **Inherited** | Inherits from `newsletter_sends.publication_id`. |
| **Analytics Events** | `analytics_events` | **YES** | Add `publication_id` FK for fast aggregations and tenant filtering. |
| **Automations** | `automations` table | **YES** | Add `publication_id` FK. Workflows are publication-scoped. |
| **Search Documents** | `search_documents` | **YES** | Add `publication_id` FK. Prevent search result leakage across publications. |
| **Active Themes** | `installed_themes` | **YES** | Add `publication_id` FK. Distinct publications can activate different themes. |
| **Content Translations**| `content_translations` | **YES** | Add `publication_id` FK. Translation matrix scoped to publication. |
| **Webhooks** | `webhooks` table | **YES** | Add `publication_id` FK. Developers register webhooks per publication. |
| **Audit Logs** | `audit_events` | **YES** | Add `publication_id` (nullable for system-level root events). |

---

## 2. Schema Migration Strategy

### Migration Phasing & Zero-Downtime Backfill

```
Phase 1: DDL Add Nullable Columns
  ALTER TABLE posts ADD COLUMN publication_id TEXT REFERENCES publications(id) ON DELETE CASCADE;
  ALTER TABLE pages ADD COLUMN publication_id TEXT REFERENCES publications(id) ON DELETE CASCADE;
  ALTER TABLE media ADD COLUMN publication_id TEXT REFERENCES publications(id) ON DELETE CASCADE;
  ALTER TABLE tags ADD COLUMN publication_id TEXT REFERENCES publications(id) ON DELETE CASCADE;
  ALTER TABLE members ADD COLUMN publication_id TEXT REFERENCES publications(id) ON DELETE CASCADE;
  ALTER TABLE newsletters ADD COLUMN publication_id TEXT REFERENCES publications(id) ON DELETE CASCADE;
  ALTER TABLE search_documents ADD COLUMN publication_id TEXT REFERENCES publications(id) ON DELETE CASCADE;
  ALTER TABLE content_translations ADD COLUMN publication_id TEXT REFERENCES publications(id) ON DELETE CASCADE;

Phase 2: Data Backfill Script
  -- In single-tenant legacy databases, ensure a default publication exists
  INSERT INTO publications (id, workspace_id, name, slug, primary_locale)
  VALUES ('pub_default', 'ws_default', 'Default Publication', 'default', 'en')
  ON CONFLICT DO NOTHING;

  -- Backfill all legacy orphaned records to the default publication
  UPDATE posts SET publication_id = 'pub_default' WHERE publication_id IS NULL;
  UPDATE pages SET publication_id = 'pub_default' WHERE publication_id IS NULL;
  UPDATE media SET publication_id = 'pub_default' WHERE publication_id IS NULL;
  UPDATE tags SET publication_id = 'pub_default' WHERE publication_id IS NULL;
  UPDATE members SET publication_id = 'pub_default' WHERE publication_id IS NULL;
  UPDATE newsletters SET publication_id = 'pub_default' WHERE publication_id IS NULL;
  UPDATE search_documents SET publication_id = 'pub_default' WHERE publication_id IS NULL;
  UPDATE content_translations SET publication_id = 'pub_default' WHERE publication_id IS NULL;

Phase 3: DDL Set NOT NULL and Composite Indexes
  ALTER TABLE posts ALTER COLUMN publication_id SET NOT NULL;
  ALTER TABLE pages ALTER COLUMN publication_id SET NOT NULL;
  ALTER TABLE media ALTER COLUMN publication_id SET NOT NULL;
  ALTER TABLE tags ALTER COLUMN publication_id SET NOT NULL;
  ALTER TABLE members ALTER COLUMN publication_id SET NOT NULL;
  ALTER TABLE newsletters ALTER COLUMN publication_id SET NOT NULL;
  ALTER TABLE search_documents ALTER COLUMN publication_id SET NOT NULL;

  -- Replace global unique slug constraints with publication-scoped partial indexes
  ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_slug_unique;
  CREATE UNIQUE INDEX posts_pub_slug_active_idx ON posts (publication_id, slug) WHERE deleted_at IS NULL;

  ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_slug_unique;
  CREATE UNIQUE INDEX pages_pub_slug_active_idx ON pages (publication_id, slug) WHERE deleted_at IS NULL;

  CREATE UNIQUE INDEX tags_pub_slug_idx ON tags (publication_id, slug);
  CREATE INDEX media_pub_idx ON media (publication_id);
  CREATE INDEX search_pub_idx ON search_documents (publication_id, searchable);
```

---

## 3. Enforcement Across All System Boundaries

### 3.1 Fastify Request Lifecycle Enforcement
1. **Tenant Extraction**:
   - `TenantContext` is extracted by Fastify hook `onRequest` via:
     - Subdomain (e.g., `mag.vibress.io` → lookup publication by `domain`).
     - Request Header: `X-Vibress-Publication-Id: <id>` (validated against user's publication memberships).
     - Staff Session Context: Active publication stored in session context.
2. **Access Control Gate**:
   - If user is not an Owner/Admin of the workspace and lacks a `publication_memberships` record for `publicationId`, reject with HTTP 403 `TENANT_ACCESS_DENIED`.
3. **Request Decoration**:
   - Decorates Fastify request: `req.tenant = { workspaceId: string, publicationId: string }`.

### 3.2 Repository Layer Enforcement
All Drizzle repository queries MUST enforce publication scoping:
```ts
export class DrizzlePostRepository implements PostRepository {
  async findById(publicationId: string, id: string): Promise<Post | null> {
    const rows = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, id), eq(posts.publicationId, publicationId)))
      .limit(1);
    return rows[0] ? toPostEntity(rows[0]) : null;
  }
}
```
**Rule**: Repositories must NEVER provide parameter-less global lookup methods like `findById(id: string)` without `publicationId`.

### 3.3 Search Engine Enforcement
- `SearchRepository.query()` accepts `publicationId: string`.
- All SQL queries append `eq(searchDocuments.publicationId, publicationId)`.
- Indexer worker sets `publicationId` on document creation.

### 3.4 Worker & Background Job Enforcement
- Every BullMQ job payload must contain `publicationId` in its metadata envelope:
  ```ts
  export interface TracedJobEnvelope<T> {
    publicationId: string;
    actorId: string;
    payload: T;
  }
  ```
- Workers set the execution tenant context before processing.

---

## 4. Cross-Publication Attack Verification Suite

A dedicated security test suite must be implemented in `tests/integration/tenant-isolation-boundary.test.ts`:

1. **Attack 1: Cross-Tenant Post IDOR**:
   - Seed Publication A and Publication B with distinct editors User A and User B.
   - User A creates Post 101 in Publication A.
   - User B sends `GET /posts/101` and `PUT /posts/101`.
   - **Assertion**: API must return `404 Not Found` (never 200, and never leak publication metadata in 403).
2. **Attack 2: Cross-Tenant Duplicate Slug Collisions**:
   - User A creates post with slug `breaking-news` in Publication A.
   - User B creates post with slug `breaking-news` in Publication B.
   - **Assertion**: Both operations succeed without constraint errors.
3. **Attack 3: Search Index Bleed**:
   - User A publishes post containing secret keyword `OperationObsidian` in Publication A.
   - User B executes search for `OperationObsidian` in Publication B.
   - **Assertion**: Search returns 0 results.
4. **Attack 4: Cross-Tenant Media File Enumeration**:
   - User A uploads `confidential.pdf` in Publication A.
   - User B attempts to access `/api/admin/v1/media/:mediaId` for User A's asset.
   - **Assertion**: API returns `404 Not Found`.
