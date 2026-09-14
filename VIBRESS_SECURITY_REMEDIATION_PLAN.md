# VIBRESS — SECURITY AUDIT & REMEDIATION PLAN
## Source-Level Vulnerability Analysis, Threat Modeling & Defense-in-Depth Roadmap

---

## 1. Executive Security Assessment

A rigorous source-level security audit was performed across the entire Vibress codebase.

### Key Strengths:
1. **Password Hashing & Crypto**: Argon2id (`$argon2id$v=19$m=65536,t=3,p=4`) is strictly used with constant-time verification. Tokens (sessions, password resets, email verification, webhooks) are SHA-256 hashed before persistence.
2. **Archive Security**: Theme zip extraction in [zip-validator.ts](file:///Users/abdullahzaher/vibress/packages/theme-core/src/zip-validator.ts) includes comprehensive zip-slip checks, CRC32 verification, and decompressed size limits (zip bomb defense).
3. **Template Sandboxing**: LiquidJS execution is constrained within an in-memory virtual filesystem (`MemoryFileSystem`), preventing server filesystem traversal from templates.
4. **Webhook Integrity**: Stripe webhooks are verified against raw buffer payloads, with SHA-256 deduplication and replay attack protection.

### Critical Deficiencies:
1. **Insecure `node:vm` Sandbox**: `packages/plugin-core/src/sandbox.ts` uses `node:vm` for executing plugin code, which can be trivially bypassed to gain arbitrary Remote Code Execution (RCE) on the host.
2. **Lack of Tenant / Publication Isolation**: Core tables have no `publication_id`, and API routes lack ownership boundary assertions, creating cross-tenant data leaks if deployed in multi-organization environments.
3. **Hardcoded Role Bypasses in RBAC**: Hardcoded checks for `"owner"`, `"administrator"`, and `"editor"` strings bypass the granular capability system, preventing fine-grained access control.
4. **Soft-Deleted Slug Reservation DoS**: Slugs on soft-deleted posts and pages permanently lock that slug due to a missing partial unique index predicate.

---

## 2. Vulnerability Classification & Findings (P0 – P3)

### Severity P0 — Critical (Immediate Remediation Required)

#### [SEC-01] Remote Code Execution via `node:vm` Plugin Sandbox
- **Location**: [packages/plugin-core/src/sandbox.ts](file:///Users/abdullahzaher/vibress/packages/plugin-core/src/sandbox.ts#L45-L52)
- **Vulnerability**: The function `executeSandboxedPluginCode` creates a sandbox context using Node.js built-in `vm.createContext()`:
  ```ts
  const vmContext = vm.createContext(sandboxContext);
  const script = new vm.Script(code);
  return script.runInContext(vmContext, { timeout });
  ```
- **Exploit Vector**: The official Node.js documentation explicitly states that `node:vm` is **NOT a security boundary**. Any sandboxed code can access the outer context's prototype chain and execute arbitrary shell commands:
  ```js
  const ForeignFunction = this.constructor.constructor;
  const process = ForeignFunction("return process")();
  process.mainModule.require("child_process").execSync("cat /etc/passwd");
  ```
- **Impact**: Full host compromise, credential exfiltration, and database destruction.
- **Remediation**:
  1. Immediately deprecate `executeSandboxedPluginCode()` for untrusted code.
  2. Enforce that for v1.x, **only bundled internal plugins** (`BundledPluginHost`) are loaded.
  3. For external plugin execution in v2, adopt **WebAssembly (WASM via Wasmtime/Wasmer)** or a **hardened microVM / container boundary** (e.g., Firecracker / Docker runner). Do not rely on JavaScript VMs.

---

#### [SEC-02] Global Multi-Tenant Data Leakage (Missing Tenant Boundaries)
- **Location**: [packages/database/src/schema/posts.ts](file:///Users/abdullahzaher/vibress/packages/database/src/schema/posts.ts), [pages.ts](file:///Users/abdullahzaher/vibress/packages/database/src/schema/pages.ts), [media.ts](file:///Users/abdullahzaher/vibress/packages/database/src/schema/media.ts), and all API routes.
- **Vulnerability**: While `workspaces` and `publications` tables exist, content tables (`posts`, `pages`, `media`, `tags`, `members`, `newsletters`, `search_documents`) lack a `publication_id` foreign key. API routes perform global queries without tenant scoping.
- **Exploit Vector**: If an administrator configures multiple publications in the database, any authenticated staff member from Publication A can query, read, update, or delete content belonging to Publication B simply by knowing or enumerating resource IDs (IDOR).
- **Impact**: Total loss of confidentiality and data integrity across publications.
- **Remediation**:
  1. Add `publication_id TEXT NOT NULL REFERENCES publications(id)` to all content and relational tables.
  2. Enforce tenant context in Fastify request lifecycle (`req.tenant = { workspaceId, publicationId }`).
  3. Mandate `WHERE publication_id = :publicationId` in all repository queries and unique indexes.

---

#### [SEC-03] In-Memory CRDT Denial of Service (Heap Exhaustion)
- **Location**: [apps/api/src/routes/collaboration.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/collaboration.ts#L293-L316) & [editorial-collaboration-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/posts/src/application/editorial-collaboration-service.ts#L69-L74)
- **Vulnerability**: `POST /posts/:postId/collaboration/crdt` accepts arbitrary base64-encoded strings and pushes them into an unconstrained in-memory array (`docUpdatesMap.get(postId)!.push(update)`).
- **Exploit Vector**: An authenticated editor can loop requests posting 10MB base64 payloads repeatedly. Because the array is unbounded and held entirely in Node.js process heap, the API server will run out of memory (OOM) and crash repeatedly, causing sustained Denial of Service.
- **Impact**: Server crash / permanent availability outage.
- **Remediation**:
  1. Set a strict payload limit (e.g., max 64KB per update chunk) in route validation.
  2. Store CRDT updates in PostgreSQL with a maximum history cap or compact into periodic snapshots.
  3. Enforce rate limiting specifically on collaboration exchange routes.

---

### Severity P1 — High (Remediate Before Broad Scale)

#### [SEC-04] Hardcoded RBAC Capability Bypasses
- **Location**: [packages/security/src/authorization/index.ts](file:///Users/abdullahzaher/vibress/packages/security/src/authorization/index.ts#L6-L10)
- **Vulnerability**: Hardcoded string evaluations grant universal capability overrides:
  ```ts
  if (userRoles.includes("owner")) return true;
  if (userRoles.includes("owner") || userRoles.includes("administrator")) return true;
  if (userRoles.includes("editor") || ...) return true;
  ```
- **Exploit Vector**: If an organization creates a restricted administrative role or wants an editor who cannot delete published articles, the hardcoded check for `"editor"` or `"administrator"` bypasses the permissions table and grants full access.
- **Remediation**:
  1. Refactor RBAC so that roles resolve dynamically to a set of granular capabilities (`permissions`).
  2. Never check role string literals directly in authorization checks; always assert specific capabilities (e.g., `hasCapability(user, "posts.delete")`).

---

#### [SEC-05] Soft-Deleted Slug Permanent Reservation DoS
- **Location**: [packages/database/src/schema/posts.ts](file:///Users/abdullahzaher/vibress/packages/database/src/schema/posts.ts#L16) & [pages.ts](file:///Users/abdullahzaher/vibress/packages/database/src/schema/pages.ts#L16)
- **Vulnerability**: `slug: text("slug").notNull().unique()` creates a global table-level unique constraint across all rows, including rows where `deleted_at IS NOT NULL`.
- **Exploit Vector**: A contributor creates a post with a high-value slug (`/features`), and later an editor deletes it. No post can ever use `/features` again because the soft-deleted record permanently triggers a unique constraint violation.
- **Remediation**:
  1. Drop the table constraint `posts_slug_unique`.
  2. Create a partial unique index in PostgreSQL:
     ```sql
     CREATE UNIQUE INDEX posts_slug_active_idx ON posts (slug) WHERE deleted_at IS NULL;
     ```

---

#### [SEC-06] In-Memory AI Rate Limiting & Budget Reset Flaw
- **Location**: [packages/domains/ai/src/application/ai-gateway-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/ai/src/application/ai-gateway-service.ts#L49-L50)
- **Vulnerability**: User request timestamps (`userRequestTimestamps`) and monthly token usage (`totalUsedTokens`) are stored in JavaScript heap variables.
- **Exploit Vector**: When deployed across multiple container replicas or when the API restarts, all rate limits and budget caps reset to 0. A compromised or rogue user can exceed the monthly spend budget by distributing requests across replicas or cycling container restarts.
- **Remediation**:
  1. Move rate limits and budget counters into Redis with atomic increment (`INCRBY`) and TTL expiration (`EXPIRE`).
  2. Persist cumulative billing spend in the PostgreSQL database.

---

### Severity P2 — Medium (Operational & Hardening Improvements)

#### [SEC-07] Arabic Normalization Semantic Collision Risk
- **Location**: [packages/i18n/src/text-normalizer.ts](file:///Users/abdullahzaher/vibress/packages/i18n/src/text-normalizer.ts#L18-L23)
- **Vulnerability**: Unconditionally converts Taa Marbuta `ة` to `ه` and Alef Maksura `ى` to `ي`.
- **Exploit Vector / Edge Case**: While intended for fuzzy search tolerance, applying this aggressively to stored slugs or identifiers causes collisions between distinct Arabic words (e.g., `علي` [Ali] vs `على` [on/upon]).
- **Remediation**:
  1. Reserve aggressive text normalization strictly for search indexing and query preprocessing.
  2. Preserve original Unicode characters in slugs, titles, and persistent content.

#### [SEC-08] Missing Object-Level Ownership Checks in Domain Services
- **Location**: `packages/domains/posts/src/application/posts-service.ts`
- **Vulnerability**: Domain methods such as `findById()` and `updatePost()` rely primarily on the caller having passed HTTP middleware, rather than verifying object ownership internally.
- **Remediation**: Pass `ActorContext` to all domain service mutation methods and assert object-level ownership (`hasResourcePermission`) before executing Drizzle mutations.

---

### Severity P3 — Low / Defense-in-Depth

#### [SEC-09] Strict CSP Header Enforcement on Admin & Portal
- **Location**: Gateway Nginx configuration (`docker/gateway.Dockerfile`).
- **Remediation**: Add explicit `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' https:;` headers to eliminate any risk of injected script execution.

---

## 3. Authorization Trust Boundary Map

```
┌────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL CLIENT / BROWSER                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / Cookie / Bearer
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        NGINX REVERSE GATEWAY                           │
│  • TLS Termination                                                     │
│  • Request Size Capping (25MB Themes, 10MB Media, 256KB Webhooks)     │
│  • Origin & Referer Verification                                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Forwarded Request
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          FASTIFY API LAYER                             │
│  [Middleware Boundary]                                                 │
│  ├── validateOrigin (CSRF defense for cookie sessions)                 │
│  ├── requireStaffSession (Resolve session token via SHA-256 hash)      │
│  └── requirePermission (Route-level capability check)                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (Gaps identified: no tenant scope)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        DOMAIN SERVICES LAYER                           │
│  • PostsService, PagesService, MediaService, BillingService            │
│  [Required: Object-Level Authorization & Tenant Isolation Checks]      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Parameterized SQL Queries
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     POSTGRESQL DATABASE & REDIS                        │
│  • Drizzle ORM Type-Safe Queries (SQLi Immune)                         │
│  • Row-level locks (FOR UPDATE SKIP LOCKED in Outbox)                  │
│  • Internal Docker Network (No Host Port Exposure)                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Authorization Remediation Plan

1. **Step 1: Eliminate Role Literal Bypasses**
   - Refactor `@vibress/security` to evaluate only permission grants. Remove `userRoles.includes("owner")` bypass branches. Assign universal capabilities (`*` or explicit grant list) to the Owner role definition in the database instead of hardcoding in code.
2. **Step 2: Implement Mandatory Tenant Middleware**
   - Create `resolveTenantContext` middleware in Fastify. Extract `publicationId` from subdomain, path parameter, or staff session.
   - Attach `req.tenant = { workspaceId, publicationId }`.
3. **Step 3: Service-Level Ownership Guards**
   - Update all service mutation signatures to accept `actor: ActorContext`.
   - Call `hasResourcePermission(requiredPerm, { actorId: actor.id, resourceOwnerId: entity.primaryAuthorId })` inside the service transaction.
4. **Step 4: SQL Partial Indexes for Slugs**
   - Apply Drizzle migration adding partial unique indexes on `(publication_id, slug) WHERE deleted_at IS NULL` for posts, pages, and tags.
