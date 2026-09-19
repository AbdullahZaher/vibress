# VIBRESS — COMMENTS IMPLEMENTATION BASELINE

**Date:** September 17, 2026  
**Git Commit SHA:** `002334fc81299ee3588c23d731a79687342a7413`  
**Git Branch:** `main`  
**Package Version:** `1.1.0`  
**Migration Head:** `0026_multi_publication_tenant_isolation.sql`  

---

## 1. Baseline Verification Status

| Check | Tool / Command | Result | Notes |
|---|---|---|---|
| **Git Working Tree** | `git status --short` | Clean (only audit docs untracked) | Ready for implementation |
| **Migration Head** | `packages/database/migrations` | `0026_multi_publication_tenant_isolation.sql` | Migration 0027 is the next in sequence |
| **Typecheck** | `pnpm typecheck` | **PASS** (72/72 projects) | Monorepo compiles cleanly |
| **Existing Comments Tests** | `vitest run packages/domains/comments/tests/comments-service.test.ts` | **PASS** (17/17 tests) | Baseline unit tests in memory/mock pass |

---

## 2. Pre-Existing Architectural Gaps & Vulnerabilities Identified

1. **Database Schema (`packages/database/src/schema/community.ts`):** Single-column foreign keys allow inserting comments where `publication_id` differs from `posts.publication_id`.
2. **Public API (`packages/api/src/routes/content.ts`):** No public endpoints exist for comments, likes, or reports.
3. **API Client (`packages/api-client/src/content-client.ts`):** Missing comments SDK methods.
4. **Theme Core (`packages/theme-core`):** Liquid engine does not register `{% comments %}` tag; `PostViewModel` lacks `commentCount`.
5. **Admin UI (`apps/admin/src/pages/Comments.tsx`):** Unpaginated flat list, untranslated English strings, no audit history modal.
6. **State Machine & Auditing:** No `comment_moderation_events` table exists; status transitions lack formal validation.

---

## 3. Implementation Sequence & Execution Plan

Implementation will proceed strictly through the approved 16 phases of Plan v2.0:
- Phase 0: Security containment & baseline confirmation (Complete)
- Phase 1: Canonical contracts & domain models
- Phase 2: Database Migration 0027 (`0027_comments_hardened_publication_isolation.sql`)
- Phase 3: Moderation state machine & audit trail
- Phase 4: Server-side authentication & session security
- Phase 5: Public Content API routes
- Phase 6: Admin API moderation routes
- Phase 7: Theme Core Liquid `{% comments %}` tag
- Phase 8: Public comments runtime
- Phase 9: Built-in themes integration
- Phase 10: Events, analytics & automations
- Phase 11: Batched count queries (Zero N+1)
- Phase 12: Localization (AR/EN), RTL & Accessibility
- Phase 13: Anti-abuse & idempotency
- Phase 14: Adversarial multi-tenant test matrix
- Phase 15: Production E2E verification
