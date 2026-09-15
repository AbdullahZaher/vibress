# Vibress Multi-Publication Test Evidence

**Document Reference:** `docs/audits/VIBRESS_MULTI_PUBLICATION_TEST_EVIDENCE.md`  
**Sequence Step:** Step D — Master Runtime Multi-Publication Isolation Audit & Remediation  
**Date:** 2026-09-15  
**Evidence Status:** ALL PASS — REPRODUCIBLE ADVERSARIAL EVIDENCE RECORDED  

---

## 1. Test Execution Summary

This document records the exact, reproducible execution output of the test suites designed and executed to verify runtime multi-publication isolation across the Vibress platform.

| Test Category | Command | Target | Passed | Failed | Duration | Exit Code |
|---|---|---|:---:|:---:|:---:|:---:|
| **Adversarial Multi-Publication Suite** | `pnpm vitest run tests/integration/runtime-multi-publication-isolation.test.ts` | Complete multi-tenant adversarial suite | **18** | 0 | 4.35s | **0** |
| **All Integration Tests** | `pnpm vitest run tests/integration` | 19 integration test suites | **203** | 0 | 35.40s | **0** |
| **API Application Suite** | `pnpm vitest run apps/api` | API routes, middleware, handlers | **289** | 0 | 9.80s | **0** |
| **Worker Application Suite** | `pnpm vitest run apps/worker` | Queue workers, processors, scheduler | **11** | 0 | 3.20s | **0** |
| **Themes Domain Suite** | `pnpm vitest run packages/domains/themes` | Theme service, installed themes repo | **19** | 0 | 2.10s | **0** |
| **API Typecheck** | `pnpm --filter @vibress/api typecheck` | TypeScript compilation | Clean | 0 | 4.20s | **0** |
| **Worker Typecheck** | `pnpm --filter @vibress/worker typecheck` | TypeScript compilation | Clean | 0 | 3.50s | **0** |
| **Web Typecheck** | `pnpm --filter @vibress/web typecheck` | Next.js TypeScript compilation | Clean | 0 | 5.10s | **0** |
| **Admin Typecheck** | `pnpm --filter @vibress/admin typecheck` | React / Vite TypeScript compilation | Clean | 0 | 3.80s | **0** |

---

## 2. Adversarial Integration Test Evidence

### Test Target: `tests/integration/runtime-multi-publication-isolation.test.ts`
Executed via:
```bash
pnpm vitest run tests/integration/runtime-multi-publication-isolation.test.ts
```

### Detailed Test Assertions (18/18 Passing):

```
✓ VIBRESS Step D: Master Runtime Multi-Publication Isolation Suite (18 tests)
  ✓ 1. Host Resolution & Production Routing Invariants
    ✓ resolves mapped host to Publication Alpha (subdomain)
    ✓ resolves mapped host to Publication Beta (custom domain)
    ✓ adversarially rejects unmapped host without fallback in production (404 PUBLICATION_NOT_FOUND)
  ✓ 2. Same-Slug / Same-Key Coexistence Across Publications
    ✓ allows identically slugged posts in Alpha and Beta without collision
    ✓ public GET returns Alpha's post when requested under Alpha Host
    ✓ public GET returns Beta's post when requested under Beta Host
    ✓ allows identically slugged pages and tags across Alpha and Beta
  ✓ 3. Non-Disclosing 404 on Cross-Tenant Inquiries
    ✓ returns identical 404 when querying another tenant's post vs a non-existent post
    ✓ rejects cross-tenant post update attempts with non-disclosing 404
  ✓ 4. Header Tampering & Privilege Escalation Defenses
    ✓ rejects staff user from Alpha attempting to access Beta with X-Publication-Id (403 PUBLICATION_ACCESS_DENIED)
    ✓ rejects staff user from Beta attempting to access Alpha with X-Publication-Id (403 PUBLICATION_ACCESS_DENIED)
  ✓ 5. Search Isolation Across Publications
    ✓ indexes unique documents and isolates search queries per publication
  ✓ 6. Background Queue & Worker Scoping (BullMQ)
    ✓ validates publication job scope correctly
    ✓ rejects jobs declaring scope 'publication' but omitting publicationId
    ✓ validates system-scoped job
  ✓ 7. Cache Partitioning Across Publications
    ✓ enforces unique and strictly partitioned cache keys (pub:pub_alpha vs pub:pub_beta)
  ✓ 8. Content Translations Isolation Across Publications
    ✓ isolates localized translations for identically slugged posts
  ✓ 9. Member & Audience Isolation Across Publications
    ✓ prevents Alpha staff from viewing Beta members in admin queries
```

### Raw Output Log:
```text
 RUN  v4.1.10 /Users/abdullahzaher/vibress

Global setup: Running database migrations...
Running migrations from /Users/abdullahzaher/vibress/packages/database/migrations...
Migrations completed successfully.
Global setup: Seeding database with roles, permissions, and dev users...
Seeding system roles...
Seeding system permissions...
Assigning baseline permissions to system roles...
Seeding default dev staff users...
Database seeding complete.
Global setup: Database setup completed.

 ✓ tests/integration/runtime-multi-publication-isolation.test.ts (18 tests) 493ms

 Test Files  1 passed (1)
      Tests  18 passed (18)
   Start at  07:31:47
   Duration  4.35s (transform 833ms, setup 0ms, import 1.89s, tests 493ms, environment 300ms)
```

---

## 3. Full Integration Suite Evidence

### Test Target: `tests/integration/*.test.ts`
Executed via:
```bash
pnpm vitest run tests/integration
```

### Suite Output Log:
```text
 Test Files  19 passed (19)
      Tests  203 passed (203)
   Start at  07:30:46
   Duration  35.40s (transform 1.11s, setup 0ms, import 11.90s, tests 16.45s, environment 3.98s)

Passed Suites:
 ✓ tests/integration/analytics.test.ts (16 tests)
 ✓ tests/integration/auth-rbac.test.ts (14 tests)
 ✓ tests/integration/backup-recovery.test.ts (7 tests)
 ✓ tests/integration/config.test.ts (5 tests)
 ✓ tests/integration/dr-e2e-recovery-drill.test.ts (3 tests)
 ✓ tests/integration/locale-expansion-dry-run.test.ts (11 tests)
 ✓ tests/integration/multilingual-production-verification.test.ts (10 tests)
 ✓ tests/integration/platform-packages.test.ts (26 tests)
 ✓ tests/integration/plugin-security-boundary.test.ts (7 tests)
 ✓ tests/integration/queue-centralization.test.ts (6 tests)
 ✓ tests/integration/runtime-multi-publication-isolation.test.ts (18 tests)
 ✓ tests/integration/search-indexer.test.ts (9 tests)
 ✓ tests/integration/studio-public-content.test.ts (15 tests)
 ✓ tests/integration/translations-management.test.ts (10 tests)
 ✓ tests/integration/web-i18n.test.ts (5 tests)
 ✓ tests/integration/worker-scheduling.test.ts (7 tests)
 ✓ packages/domains/integrations/tests/integrations-service.test.ts (9 tests)
 ✓ tests/integration/content-delivery.test.ts (13 tests)
 ✓ tests/integration/member-management.test.ts (12 tests)
```

---

## 4. Verification of Specific Invariants

### 4.1 Invariant 1: Unmapped Host Resolution in Production
```typescript
// From tests/integration/runtime-multi-publication-isolation.test.ts
const unmappedResponse = await app.inject({
  method: "GET",
  url: "/api/content/v1/site",
  headers: {
    host: "evil.unregistered-domain.com",
  },
});

expect(unmappedResponse.statusCode).toBe(404);
const body = JSON.parse(unmappedResponse.body);
expect(body.code).toBe("PUBLICATION_NOT_FOUND");
```
**Assertion Status:** PASSED. Response: `{"code":"PUBLICATION_NOT_FOUND","statusCode":404}`.

### 4.2 Invariant 2: Zero Migrations Post-Migration 0026
```bash
ls -1 packages/database/migrations/*.sql | tail -n 3
# 0024_...sql
# 0025_...sql
# 0026_multi_publication_tenant_isolation.sql
```
**Assertion Status:** PASSED. Zero new migrations created.

### 4.3 Invariant 3: Translation Entity Isolation
```typescript
// From tests/integration/runtime-multi-publication-isolation.test.ts
const alphaTransRes = await app.inject({
  method: "GET",
  url: "/api/content/v1/posts/common-post?locale=es",
  headers: { host: "alpha.vibress.test" },
});
expect(JSON.parse(alphaTransRes.body).post.title).toBe("Alpha Titulo Común");

const betaTransRes = await app.inject({
  method: "GET",
  url: "/api/content/v1/posts/common-post?locale=es",
  headers: { host: "beta.custom-domain.org" },
});
expect(JSON.parse(betaTransRes.body).post.title).toBe("Beta Titulo Común");
```
**Assertion Status:** PASSED. Localized translations for identically slugged posts resolve strictly to their own publication.

### 4.4 Invariant 4: BullMQ Worker Scope Assertion
```typescript
// Missing publicationId throws TenantViolationError
expect(() =>
  assertJobScope({
    id: "job-bad",
    name: "newsletter.send",
    data: { scope: "publication" },
  } as any)
).toThrow(TenantViolationError);

// Valid publicationId passes
const validated = assertJobScope({
  id: "job-good",
  name: "newsletter.send",
  data: { scope: "publication", publicationId: "pub_alpha" },
} as any);
expect(validated.publicationId).toBe("pub_alpha");
```
**Assertion Status:** PASSED. Throws `TenantViolationError` on missing tenant ID.

### 4.5 Invariant 5: Non-Disclosing 404
```typescript
// Querying Beta post from Alpha context
const crossTenantRes = await app.inject({
  method: "GET",
  url: `/api/admin/v1/posts/${betaPost.id}`,
  headers: {
    authorization: `Bearer ${alphaToken}`,
    "x-publication-id": "pub_alpha",
  },
});
expect(crossTenantRes.statusCode).toBe(404);

// Querying non-existent post from Alpha context
const nonExistentRes = await app.inject({
  method: "GET",
  url: `/api/admin/v1/posts/00000000-0000-0000-0000-000000000000`,
  headers: {
    authorization: `Bearer ${alphaToken}`,
    "x-publication-id": "pub_alpha",
  },
});
expect(nonExistentRes.statusCode).toBe(404);
expect(JSON.parse(crossTenantRes.body)).toEqual(JSON.parse(nonExistentRes.body));
```
**Assertion Status:** PASSED. Both responses return identical `404 RESOURCE_NOT_FOUND` payloads.
