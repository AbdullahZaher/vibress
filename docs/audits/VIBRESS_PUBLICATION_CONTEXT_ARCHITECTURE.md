# Vibress Publication Context Architecture

**Document Reference:** `docs/audits/VIBRESS_PUBLICATION_CONTEXT_ARCHITECTURE.md`  
**Sequence Step:** Step D — Master Runtime Multi-Publication Isolation Audit  
**Date:** 2026-09-15  
**Architecture Status:** PRODUCTION READY & SYSTEMATICALLY ENFORCED  

---

## 1. Architectural Philosophy & Invariants

Vibress implements an **Authoritative Server-Side Multi-Tenant Isolation Architecture**. In this architecture, no client (whether public visitor, headless frontend, admin UI, staff member, webhook receiver, or asynchronous background worker) is permitted to operate in an unconstrained or ambient tenant state.

Every operation that touches data, caches, search indexes, or worker queues is bound to an immutable `PublicationContext`.

### 1.1 Invariant Principles

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CORE ISOLATION INVARIANTS                      │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Host Resolution Invariant:                                          │
│    Mapped Hostname  ──► Resolved Publication Context                   │
│    Unknown Hostname ──► 404 (PUBLICATION_NOT_FOUND). No silent fallback│
│                         in production (isProduction === true).         │
│                                                                        │
│ 2. Authoritative Resolution Invariant:                                │
│    Client headers (e.g. X-Publication-Id) are UNTRUSTED claims.        │
│    They MUST be cryptographically/database authenticated against the    │
│    requesting actor's user_publication_roles or publication_api_keys. │
│                                                                        │
│ 3. Storage Layer Partitioning Invariant:                               │
│    All tenant tables enforce `publication_id NOT NULL` with foreign     │
│    keys to `publications.id`. Composite uniqueness constraints bind     │
│    all slugs, emails, and entity IDs to `publication_id`.               │
│                                                                        │
│ 4. Asynchronous Queue Isolation Invariant:                             │
│    Every BullMQ job MUST explicitly declare `scope: "publication"`     │
│    (with non-empty `publicationId`) or `scope: "system"`.              │
│                                                                        │
│ 5. Cache & Search Invariant:                                           │
│    All cache keys are partitioned via `pub:<publication_id>:*`.        │
│    Search queries and document indices are strictly filtered by        │
│    `publication_id`.                                                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Ingress & Context Resolution Architecture

### 2.1 Context Resolution Hierarchy

The API platform uses a tiered resolver pipeline in `publicationContextMiddleware` (`apps/api/src/middleware/publication-context.ts`):

```mermaid
flowchart TD
    Req[Incoming HTTP Request] --> CheckPath{Path Inspection}
    
    CheckPath -->|"/health", "/metrics", "/system"| Sys[System / Unscoped Context]
    
    CheckPath -->|"/api/content/v1/*"| ContentAPI[Content API Ingress]
    ContentAPI --> AuthToken{Authorization: Bearer <key>}
    AuthToken -->|Token Provided| KeyLookup[Lookup publication_api_keys]
    KeyLookup --> BindKey[Bind publication_id from Key]
    AuthToken -->|No Token / Public| HostLookup[Resolve via Host / x-forwarded-host]
    
    CheckPath -->|"/api/admin/v1/*"| AdminAPI[Admin / Studio Ingress]
    AdminAPI --> AdminAuth[Authenticate Staff JWT / Session]
    AdminAuth --> PubHeader{X-Publication-Id Header Present?}
    PubHeader -->|Yes| RBACCheck[Query user_publication_roles for User & PubId]
    RBACCheck -->|Role Active| BindAdmin[Bind Context to Target publication_id]
    RBACCheck -->|No Role / Forbidden| Deny[403 PUBLICATION_ACCESS_DENIED]
    PubHeader -->|No| DefaultUserPub[Lookup User Primary Active Publication]
    DefaultUserPub --> BindAdmin
    
    CheckPath -->|Public Web / Feeds| WebIngress[Public Web Ingress]
    WebIngress --> HostLookup
    
    HostLookup --> DBHost[Query publications by primary_domain or custom_domain]
    DBHost -->|Found| BindPub[Bind publicationContext]
    DBHost -->|Not Found| ProdCheck{isProduction?}
    ProdCheck -->|true| Reject404[404 PUBLICATION_NOT_FOUND]
    ProdCheck -->|false / dev| DevFallback[Dev Fallback to pub_default]
    
    BindKey --> Execution[Attach to Request.publicationContext]
    BindAdmin --> Execution
    BindPub --> Execution
    DevFallback --> Execution
```

### 2.2 Host Resolution Specification

When a request arrives at `apps/api`, host resolution checks the following HTTP headers in deterministic priority:
1. `x-forwarded-host` (set by reverse proxies, Next.js server actions, or Cloudflare/Fastly edges)
2. `host` (standard HTTP/1.1 header)

The domain is extracted (stripping optional `:port` suffixes) and queried against:
```sql
SELECT p.* FROM publications p
LEFT JOIN publication_domains pd ON pd.publication_id = p.id
WHERE p.primary_domain = :host 
   OR p.custom_domain = :host 
   OR pd.domain = :host
LIMIT 1;
```

If no publication is found:
- **Production Mode (`getConfig().isProduction === true`):** The server terminates the request immediately with:
  ```json
  {
    "code": "PUBLICATION_NOT_FOUND",
    "message": "No publication configured for host: example.com",
    "statusCode": 404
  }
  ```
- **Development Mode (`!getConfig().isProduction`):** The server logs a warning and binds `pub_default` to ease local development on `localhost:3000` or `127.0.0.1`.

### 2.3 Staff & Admin RBAC Enforcement

The `X-Publication-Id` header allows staff members with access to multiple publications (e.g. agency editors, network admins) to switch contexts in the Admin UI. However, this header is strictly validated against the server-side RBAC table `user_publication_roles`:

```sql
SELECT r.key AS role_key, p.id AS publication_id
FROM user_publication_roles upr
JOIN roles r ON r.id = upr.role_id
JOIN publications p ON p.id = upr.publication_id
WHERE upr.user_id = :userId 
  AND upr.publication_id = :requestedPublicationId;
```

If no active role is found for the given `(user_id, publication_id)` pair, the API issues `403 PUBLICATION_ACCESS_DENIED`. A malicious user cannot spoof `X-Publication-Id` to access another tenant's administration panel.

---

## 3. Storage Layer Isolation Guarantees

### 3.1 Migration 0026 Schema Foundation

Database schema isolation is governed by Migration 0026 (`packages/database/migrations/0026_multi_publication_tenant_isolation.sql`). All 14 tenant-owned entities enforce `publication_id NOT NULL`:

```sql
-- Example: Posts table isolation
ALTER TABLE "posts" 
  ADD COLUMN "publication_id" text NOT NULL,
  ADD CONSTRAINT "posts_publication_id_fk" 
    FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "posts_publication_slug_unique" 
  ON "posts" ("publication_id", "slug") WHERE "deleted_at" IS NULL;
```

### 3.2 Composite Foreign Keys for Hierarchical Entities

Where child entities depend on parent entities that are also tenant-owned, composite foreign keys prevent cross-tenant referencing at the storage engine level.

For **Products** and **Plans**:
1. Parent uniqueness: `products(id, publication_id)` is declared `UNIQUE`.
2. Composite child foreign key:
```sql
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_product_publication_fk"
  FOREIGN KEY ("product_id", "publication_id")
  REFERENCES "products"("id", "publication_id")
  ON DELETE RESTRICT;
```
This guarantees that Plan $P_1$ (owned by Publication Alpha) cannot link to Product $D_2$ (owned by Publication Beta), even if an attacker manipulates API payloads. The PostgreSQL storage engine rejects the transaction with `foreign_key_violation (23503)`.

---

## 4. Application Service Layer Contracts

Every domain service and repository contract mandates an explicit `publicationId: string` parameter in the first argument position of all data-fetching and mutation methods.

```typescript
// Canonical Service Contract Pattern
export interface PostsService {
  listPosts(publicationId: string, options: ListPostsOptions): Promise<PaginatedResult<Post>>;
  getPostById(publicationId: string, id: string): Promise<Post | null>;
  getPostBySlug(publicationId: string, slug: string): Promise<Post | null>;
  createPost(publicationId: string, input: CreatePostInput): Promise<Post>;
  updatePost(publicationId: string, id: string, input: UpdatePostInput): Promise<Post>;
  deletePost(publicationId: string, id: string): Promise<void>;
}
```

### 4.1 Non-Disclosing 404 Enforcement

To prevent timing and enumeration attacks, domain services return `null` (and routes return `404 RESOURCE_NOT_FOUND`) when a requested entity does not belong to the invoking publication:

```typescript
// Repository implementation
const [post] = await db
  .select()
  .from(posts)
  .where(
    and(
      eq(posts.id, id),
      eq(posts.publicationId, publicationId),
      isNull(posts.deletedAt)
    )
  )
  .limit(1);

if (!post) {
  // Returns identical 404 whether the post does not exist at all,
  // or exists under another publication.
  throw new NotFoundError(`Post not found: ${id}`);
}
```

---

## 5. Worker & Asynchronous Job Architecture

### 5.1 Job Payload Typing & Scope Assertion

All background jobs dispatched via BullMQ implement `ScopedJobData`:

```typescript
export type JobScope = "publication" | "system";

export interface ScopedJobData {
  scope: JobScope;
  publicationId?: string;
  traceparent?: string;
}

export function assertJobScope(job: Job<ScopedJobData>): {
  scope: JobScope;
  publicationId?: string;
} {
  const data = job.data;
  if (!data || !data.scope) {
    throw new TenantViolationError(
      `Job ${job.id || job.name} failed scope assertion: missing required 'scope' property`
    );
  }
  if (data.scope === "publication" && (!data.publicationId || data.publicationId.trim() === "")) {
    throw new TenantViolationError(
      `Job ${job.id || job.name} declared scope 'publication' but omitted required 'publicationId'`
    );
  }
  return { scope: data.scope, publicationId: data.publicationId };
}
```

### 5.2 Traced and Scoped Processor Wrapper

The worker processor wrapper `tracedProcessor` automatically asserts job scope, binds the OpenTelemetry tracing span, and passes an authoritative execution context to the underlying domain worker:

```typescript
export function tracedProcessor<T extends ScopedJobData>(
  jobName: string,
  processor: (job: Job<T>, context: WorkerExecutionContext) => Promise<void>
) {
  return async (job: Job<T>): Promise<void> => {
    const { scope, publicationId } = assertJobScope(job);
    const executionContext: WorkerExecutionContext = {
      scope,
      publicationId,
      jobId: job.id,
    };
    return runWithSpan(`worker.${jobName}`, async () => {
      await processor(job, executionContext);
    });
  };
}
```

---

## 6. Cache & Search Partitioning

### 6.1 Cache Key Partitioning

The `@vibress/cache` package enforces partitioned key construction:
- Publication keys: `pub:<publication_id>:<domain>:<key>`
- System keys: `sys:<domain>:<key>`

```typescript
export function buildPublicationCacheKey(
  publicationId: string,
  domain: string,
  key: string
): string {
  if (!publicationId || publicationId.trim() === "") {
    throw new Error("buildPublicationCacheKey: publicationId is required");
  }
  return `pub:${publicationId}:${domain}:${key}`;
}
```

If a developer attempts to call `buildPublicationCacheKey` with an empty or missing `publicationId`, the method throws synchronously, preventing un-namespaced cache entry creation.

### 6.2 Full-Text Search Partitioning

The `search_documents` table indexes searchable content with composite uniqueness:
```sql
CREATE UNIQUE INDEX "search_documents_publication_entity_unique"
  ON "search_documents" ("publication_id", "entity_type", "entity_id");
```

All search queries execute with an immutable `eq(searchDocuments.publicationId, publicationId)` filter in the SQL `WHERE` clause. Search queries from Publication Alpha cannot match or score documents belonging to Publication Beta.

---

## 7. Public Web & Admin Client Context Propagation

### 7.1 Public Web (`apps/web`)

Next.js Server Components and server-side fetch routines dynamically read incoming host headers via `next/headers` and forward `x-forwarded-host` to the API gateway:

```typescript
// apps/web/src/lib/content-api-client.ts
const headersList = await headers();
const incomingHost = headersList.get("x-forwarded-host") || headersList.get("host");

if (incomingHost) {
  forwardHeaders["x-forwarded-host"] = incomingHost;
}
```

This guarantees that subrequests made by Next.js Server Components inherit the exact tenant identity of the browser's incoming request.

### 7.2 Admin Client (`apps/admin`)

The Admin single-page client maintains the active tenant state in memory / local storage and attaches `X-Publication-Id` to all outgoing HTTP requests via `apps/admin/src/lib/api/client.ts`:

```typescript
export function setActivePublicationId(pubId: string): void {
  activePublicationId = pubId;
}

// In request interceptor:
if (activePublicationId) {
  headers["X-Publication-Id"] = activePublicationId;
}
```

Server-side RBAC validates this header against `user_publication_roles` on every request.

---

## 8. Summary of Architectural Guarantees

1. **Storage Tier:** Immutably partitioned by Migration 0026 (`publication_id NOT NULL`, composite constraints).
2. **Ingress Tier:** Authoritatively resolved by host or authenticated RBAC claim. Zero silent fallback to default tenants in production.
3. **Service Tier:** Explicit `publicationId` parameters on all calls; non-disclosing 404s for cross-tenant lookups.
4. **Worker Tier:** Mandatory `scope: "publication"` and `assertJobScope` validation on all BullMQ queues.
5. **Cache/Search Tier:** Strict prefix partitioning (`pub:<id>:*`) and SQL search filtering.
