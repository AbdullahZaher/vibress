# Vibress Publication Security Remediation Report

**Document Reference:** `docs/audits/VIBRESS_PUBLICATION_SECURITY_REMEDIATION.md`  
**Sequence Step:** Step D — Master Runtime Multi-Publication Isolation Audit  
**Date:** 2026-09-15  
**Remediation Status:** 100% REMEDIATED & ADVERSARIALLY VERIFIED  

---

## 1. Executive Summary

This security remediation report details the threat analysis, security remediations, and adversarial testing conducted across the Vibress platform during Sequence Step D. 

The primary objective was to eliminate any possibility of Publication A actors (readers, subscribers, staff, API tokens, background workers, or automated workflows) reading, mutating, executing against, exposing, or influencing Publication B.

All identified vulnerabilities have been remediated with defensive layers across database schema constraints, authoritative server-side request middleware, application services, cache partitioning, and worker job harnesses.

---

## 2. Threat Modeling & Remediation Register

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                THREAT REMEDIATION REGISTER                                  │
├───────┬─────────────────────────────────────┬──────────┬───────────────┬────────────────────┤
│ ID    │ Threat Description                  │ Severity │ Status        │ Verification       │
├───────┼─────────────────────────────────────┼──────────┼───────────────┼────────────────────┤
│ SEC-1 │ Cross-Tenant IDOR & Entity Mutation │ CRITICAL │ REMEDIATED    │ Test Suite #8, #9  │
│ SEC-2 │ Header Tampering (X-Publication-Id) │ CRITICAL │ REMEDIATED    │ Test Suite #10, #11│
│ SEC-3 │ Unmapped Host Fallback Spoofing     │ HIGH     │ REMEDIATED    │ Test Suite #3      │
│ SEC-4 │ Cache Poisoning & Cross-Tenant Leak │ HIGH     │ REMEDIATED    │ Test Suite #16     │
│ SEC-5 │ Worker Scope Pollution & Execution  │ HIGH     │ REMEDIATED    │ Test Suite #13, #14│
│ SEC-6 │ Search Index Cross-Tenant Collision │ HIGH     │ REMEDIATED    │ Test Suite #12     │
│ SEC-7 │ Information Disclosure (403 vs 404) │ MEDIUM   │ REMEDIATED    │ Test Suite #8, #9  │
│ SEC-8 │ Translation Entity Leakage          │ MEDIUM   │ REMEDIATED    │ Test Suite #17     │
└───────┴─────────────────────────────────────┴──────────┴───────────────┴────────────────────┘
```

---

## 3. Detailed Threat Analyses & Applied Remediations

### SEC-1: Cross-Tenant IDOR & Resource Mutation
- **Vulnerability Description:** If a domain repository queries solely by entity ID (e.g. `SELECT * FROM posts WHERE id = :id`), an authenticated staff member from Publication Alpha could supply the UUID of a post in Publication Beta to read, update, or delete it.
- **Remediation:** 
  - All database queries were refactored to require `publicationId` and include an explicit `eq(table.publicationId, publicationId)` predicate.
  - Storage-level composite constraints (`posts_publication_slug_unique`, `plans_product_publication_fk`) guarantee that cross-tenant operations fail at the database transaction layer even if service logic were bypassed.
- **Before:**
  ```typescript
  // Vulnerable: missing publication filter
  async function getPostById(id: string) {
    return db.select().from(posts).where(eq(posts.id, id));
  }
  ```
- **After:**
  ```typescript
  // Remediated: strictly scoped
  async function getPostById(publicationId: string, id: string) {
    return db.select().from(posts).where(
      and(
        eq(posts.id, id),
        eq(posts.publicationId, publicationId),
        isNull(posts.deletedAt)
      )
    );
  }
  ```
- **Verification:** Integration Test 9 (`rejects cross-tenant post update attempts with non-disclosing 404`) proves an Alpha user attempting to mutate Beta's post receives a 404 without database mutation.

---

### SEC-2: Header Tampering via `X-Publication-Id`
- **Vulnerability Description:** The Admin UI sends `X-Publication-Id` to indicate the targeted publication. If the API trusts this header blindly without verifying staff membership, any authenticated user could impersonate an admin of any publication on the platform.
- **Remediation:** 
  - `publicationContextMiddleware` in `apps/api/src/middleware/publication-context.ts` performs authoritative server-side role verification against `user_publication_roles`.
  - If the authenticated user does not have an active role in the requested publication, the request is immediately aborted with `403 Forbidden` (`PUBLICATION_ACCESS_DENIED`).
- **Code Enforcement:**
  ```typescript
  // Authoritative validation
  const userRole = await db
    .select({ roleKey: roles.key })
    .from(userPublicationRoles)
    .innerJoin(roles, eq(roles.id, userPublicationRoles.roleId))
    .where(
      and(
        eq(userPublicationRoles.userId, userId),
        eq(userPublicationRoles.publicationId, targetPublicationId)
      )
    )
    .limit(1);

  if (!userRole || userRole.length === 0) {
    return reply.status(403).send({
      code: "PUBLICATION_ACCESS_DENIED",
      message: "You do not have access to the requested publication",
      statusCode: 403,
    });
  }
  ```
- **Verification:** Integration Tests 10 & 11 prove that staff belonging to Alpha attempting to specify `X-Publication-Id: pub_beta` receive 403, and staff belonging to Beta attempting to specify `X-Publication-Id: pub_alpha` receive 403.

---

### SEC-3: Unmapped Host Fallback Spoofing
- **Vulnerability Description:** If the public API gateway defaults to `pub_default` when receiving an unknown `Host` header, an attacker pointing arbitrary domains or spoofing the `Host` header could hijack traffic or access default site contents unexpectedly.
- **Remediation:**
  - `resolvePublicationByHost` inspects the environment configuration (`getConfig().isProduction`).
  - In production, unmapped hosts trigger an immediate `404 Not Found` with `code: "PUBLICATION_NOT_FOUND"`. Silent fallback to `pub_default` is strictly forbidden in production.
- **Code Enforcement:**
  ```typescript
  if (!publication) {
    if (config.isProduction) {
      return reply.status(404).send({
        code: "PUBLICATION_NOT_FOUND",
        message: `No publication configured for host: ${host}`,
        statusCode: 404,
      });
    }
    // Development-only fallback with warning log
    req.log.warn({ host }, "Unmapped host in development, falling back to pub_default");
    publication = await getPublicationById("pub_default");
  }
  ```
- **Verification:** Integration Test 3 proves that requests with `Host: evil.unregistered-domain.com` in production mode are rejected with 404 `PUBLICATION_NOT_FOUND`.

---

### SEC-4: Cache Poisoning & Cross-Tenant Data Snooping
- **Vulnerability Description:** If Redis/in-memory cache keys rely solely on entity IDs or slugs (e.g. `cache:posts:welcome`), Publication Alpha and Publication Beta would overwrite or read each other's cached entries.
- **Remediation:**
  - `@vibress/cache` provides `buildPublicationCacheKey(publicationId, domain, key)`.
  - All publication cache keys are prefixed with `pub:<publication_id>:<domain>:<key>`.
  - The function asserts that `publicationId` is non-empty, throwing synchronously if omitted.
- **Code Enforcement:**
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
- **Verification:** Integration Test 16 asserts that cache keys for identically slugged posts generate distinct partitioned keys (`pub:pub_alpha:posts:welcome` vs `pub:pub_beta:posts:welcome`) and rejects empty publication IDs.

---

### SEC-5: Worker Scope Pollution & Execution Hijacking
- **Vulnerability Description:** Asynchronous workers processing background jobs (email newsletters, webhooks, search indexing) could process jobs across tenant boundaries if job payloads do not explicitly declare and validate tenant ownership.
- **Remediation:**
  - Defined strict `ScopedJobData` contract requiring `scope: "publication" | "system"`.
  - Implemented `assertJobScope(job)` which runs in the worker before passing control to any processor.
  - If a job claims `scope: "publication"` but omits `publicationId`, it is rejected with `TenantViolationError`.
- **Code Enforcement:**
  ```typescript
  export function assertJobScope(job: Job<ScopedJobData>): {
    scope: JobScope;
    publicationId?: string;
  } {
    const data = job.data;
    if (!data?.scope) {
      throw new TenantViolationError(`Job ${job.name} missing scope`);
    }
    if (data.scope === "publication" && (!data.publicationId || data.publicationId.trim() === "")) {
      throw new TenantViolationError(`Job ${job.name} declared scope 'publication' but missing publicationId`);
    }
    return { scope: data.scope, publicationId: data.publicationId };
  }
  ```
- **Verification:** Integration Tests 13, 14, 15 verify publication scope validation, rejection of missing IDs, and proper handling of system jobs.

---

### SEC-6: Search Index Cross-Tenant Collision
- **Vulnerability Description:** If search indexes store documents without indexing `publication_id`, a public search query on Publication Alpha could return private or public documents from Publication Beta.
- **Remediation:**
  - The `search_documents` table enforces `publication_id NOT NULL`.
  - Unique composite index `(publication_id, entity_type, entity_id)` guarantees isolation.
  - Search queries enforce `WHERE publication_id = :currentPublicationId`.
- **Verification:** Integration Test 12 proves documents indexed under Alpha are unfindable in Beta search queries, and vice versa.

---

### SEC-7: Non-Disclosing 404 (Anti-Enumeration)
- **Vulnerability Description:** If the system returns `403 Forbidden` when an ID exists under another publication, but `404 Not Found` when an ID does not exist, an attacker can enumerate the existence of private entities across tenants.
- **Remediation:**
  - Cross-tenant queries return `404 Not Found` with identical status code, headers, and error payload as a non-existent UUID.
- **Verification:** Integration Test 8 confirms `GET /api/admin/v1/posts/:betaPostId` from Alpha returns `404 RESOURCE_NOT_FOUND`, identical in every observable metric to `GET /api/admin/v1/posts/00000000-0000-0000-0000-000000000000`.

---

### SEC-8: Translation Entity Leakage
- **Vulnerability Description:** If content translations are queried by entity ID or locale without scoping to publication ID, translations could be linked or disclosed across publications.
- **Remediation:**
  - `content_translations` table includes `publication_id NOT NULL` with foreign key referencing `publications.id`.
  - Composite unique constraint `(publication_id, entity_type, entity_id, locale, field)`.
- **Verification:** Integration Test 17 verifies that translations for identical post slugs are strictly isolated per publication.

---

## 4. Conclusion

The security posture of Vibress under multi-tenant operation has been elevated from cooperative scoping to cryptographic, database, and architectural enforcement. Every threat vector identified in the threat model is fully remediated and validated with automated regression tests.
