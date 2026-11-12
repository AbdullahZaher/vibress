# Prelaunch Security Review — Vibress

> Audit plus owner-authorized remediation of F-001, F-002, F-003, F-004, F-005,
> and F-009. No other findings were changed. This report is not a certification
> and does not replace an independent penetration test.

## Scope

- **Project / revision:** `vibress-monorepo` at `67a4de4b` (`main`), version 1.2.0.
- **Owner-approved repositories / environments:** local working tree at
  `/Users/abdullahzaher/vibress`; local docker services (`vibress-postgres`,
  `vibress-redis`, `vibress-minio`, `vibress-mailpit`, gateway on 7777). No
  external, staging, or production endpoint was contacted.
- **Date:** 2026-11-13.
- **Framework / auth / database / deployment:** pnpm + Nx monorepo; Fastify API
  (`apps/api`), Next.js public web (`apps/web`), Vite SPAs (`apps/admin`,
  `apps/portal`), worker (`apps/worker`); custom staff/member session auth with
  Argon2id; PostgreSQL via Drizzle; Redis; S3/MinIO or local storage; Stripe;
  Docker Compose behind an external TLS-terminating edge.
- **Tools actually used:** manual code review, `scripts/preflight.py`
  (filename-only), Gitleaks 8.30.1 (`--redact`), `pnpm audit`, Vitest 4.1.12,
  `git` history inspection. Semgrep / OSV-Scanner / TruffleHog were not
  installed and were not used.
- **Limitations:** no staging/public HTTP or browser testing, no source/service
  maps inspection of a deployed artifact, no full monorepo test run (only the
  API suite and the affected domain suites), typecheck only for affected
  packages, no lint/build run, no RLS runtime test, no independent pentest. Edge
  TLS configuration is outside this repository. Migrations `0052` and `0053`
  were applied to the local development database only.

## Executive Summary

- **Launch recommendation: CONDITIONAL LAUNCH.** The three verified high-severity
  authorization defects (F-001, F-002, F-003) and the cross-tenant/size defects
  F-004, F-005, and F-009 have been remediated and covered by negative regression
  tests locally. Multi-publication deployments still require applying migrations
  `0052` and `0053` and completing the remaining medium-severity actions below;
  no external/staging verification was performed.
- **Fixed and verified high issues:**
  1. F-001 — newsletter sends now carry `publication_id`, every send/audience
     route uses the resolved staff publication, and the worker validates job
     scope before delivery.
  2. F-002 — staff invitation enforces an actor→target role ceiling; only an
     existing `owner` can grant `owner`, and unknown/custom keys are rejected on
     this surface. Invitations emit an audit event.
  3. F-003 — staff publication context fails closed when the actor has no
     publication/workspace membership; only a global `owner` receives the
     unassigned `pub_default` bootstrap context.
- **Fixed and verified medium issues:**
  4. F-004 — the staff directory and assignable role list are now scoped to the
     caller's publication (plus workspace `owner`/`admin`), so an editor in one
     publication no longer enumerates other tenants' staff or global roles.
  5. F-005 — email suppressions carry an optional `publication_id`; lists and
     deletes are publication-scoped, global rows apply everywhere, and webhook
     bounces/complaints are recorded against the send's publication.
  6. F-009 — direct and multipart upload completion now reject objects larger
     than both the declared size and the per-asset ceiling, and always verify
     magic bytes on completion (fail closed when the provider cannot supply
     them), instead of skipping signature checks.
- **Verified medium issues still open:** login CSRF on `GET /members/auth/verify`,
  missing Origin checks on several staff mutations, no rate limit on reset
  acceptance, public site-privacy HMAC fallback, missing HSTS/HTTPS enforcement
  in deployable config, DB superuser with no RLS, in-memory rate limiter, and a
  production guard that accepts any `sk_test_*` Stripe key.
- **Remaining approvals:** the remaining medium-severity fixes and the
  production rollout of migrations `0052`/`0053` still require owner approval;
  see [Approvals and Manual Actions](#approvals-and-manual-actions).
- **Unverified areas:** live TLS/HSTS, Docker build-context matching, full test
  matrix, dependency tree unused-package analysis, runtime RLS behavior.

## 27-Point Control Matrix

| ID | Control | Status | Severity | Evidence | Fix | Test result | Owner action |
|---|---|---|---|---|---|---|---|
| 01 | Authentication | pass | low | Opaque 32-byte sessions stored as SHA-256, revoked/expiry checked per request; per-request role reload ([auth-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/auth/src/application/auth-service.ts#L82), [middleware/auth.ts](file:///Users/abdullahzaher/vibress/apps/api/src/middleware/auth.ts#L42), [drizzle-session-repository.ts](file:///Users/abdullahzaher/vibress/packages/domains/auth/src/infrastructure/drizzle-session-repository.ts#L33)) | Wire MFA/SSO or document them as not shipped; add idle timeout | 82 unit + 98 API tests passed | Confirm MFA expectation for launch |
| 02 | Protect API keys | failed | medium | No server secret in client bundles; only `NEXT_PUBLIC_SITE_URL` is public. But site-privacy HMAC falls back to a public literal ([middleware.ts](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L301), [route.ts](file:///Users/abdullahzaher/vibress/apps/web/src/app/api/verify-site-password/route.ts#L41)) and the `web` service does not receive `VIBRESS_ENCRYPTION_KEY` ([compose.prod.yml](file:///Users/abdullahzaher/vibress/compose.prod.yml#L172)) | Remove fallback; fail closed; pass key to web or verify in API only | Build artifacts scanned: no secret names/keys found | Decide private-site cookie architecture |
| 03 | Secure database access | failed | medium | F-001, F-003, F-004, and F-005 fixed: sends carry `publication_id`, staff context fails closed, directory/roles are publication-scoped, and suppressions carry `publication_id` ([0052_newsletter_sends_publication_scope.sql](file:///Users/abdullahzaher/vibress/packages/database/migrations/0052_newsletter_sends_publication_scope.sql#L1), [0053_email_suppressions_publication_scope.sql](file:///Users/abdullahzaher/vibress/packages/database/migrations/0053_email_suppressions_publication_scope.sql#L1), [admin.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L22), [workspace-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/workspaces/src/application/workspace-service.ts#L126)). Remaining: no RLS and superuser DB role (F-012) | Least-privilege DB role | Newsletter isolation 18/18, runtime multi-publication 45/45, full API 587/587 | Apply migrations 0052/0053 in deploy; approve remaining |
| 04 | Enforce HTTPS | not_verified | medium | Gateway terminates nothing and has no 443/HSTS ([nginx.prod.conf](file:///Users/abdullahzaher/vibress/infrastructure/nginx/nginx.prod.conf#L1)); prod origins in sample are `http://`; HSTS absent from web/SPA/gateway | Enforce HTTPS redirect + staged HSTS at the edge; reject non-HTTPS prod origins | Not run (no authorized staging endpoint) | Verify edge TLS/HSTS in staging |
| 05 | Hash passwords | pass | none | Argon2id; library-generated salt; no password logging ([passwords/index.ts](file:///Users/abdullahzaher/vibress/packages/security/src/passwords/index.ts#L37)) | Set explicit memory/time/parallelism parameters | Unit tests passed | Confirm tuning on smallest target |
| 06 | Server-side validation | pass | low | Zod at most boundaries (`safeParse`); global 1 MB body limit; per-route limits ([main.ts](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L137)); some handlers cast bodies directly (F-017) | Add schemas to collaboration/ai/admin/operations handlers | API tests passed | Schedule hardening |
| 07 | Cross-site scripting | pass | low | parse5 allowlist sanitizer on ingest and render; iframe/URL allowlists; nonce CSP ([sanitize.ts](file:///Users/abdullahzaher/vibress/packages/studio-utils/src/sanitize.ts#L1), [middleware.ts](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L112)); theme HTML is staff-only and unsanitized (F-018) | Sanitize or sandbox theme output | XSS regression tests passed | Decide theme trust model |
| 08 | Logging and monitoring | pass | low | Structured JSON with key-name redaction; no body/header logging; auth/media/post/theme audit events ([observability/index.ts](file:///Users/abdullahzaher/vibress/packages/observability/src/index.ts#L186)); billing audit missing (F-025) | Add billing/offer audit events | Not exercised against a live sink | Confirm alert routing |
| 09 | Restrict admin routes | fixed_verified | low | All admin routes carry `requireStaffSession` + permission; invite enforces an actor→target role ceiling and audit event; the directory and role list are publication-scoped and rank-filtered ([admin.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L22), [#L58](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L58), [#L91](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L91), [authorization/index.ts](file:///Users/abdullahzaher/vibress/packages/security/src/authorization/index.ts#L63)) | Review existing elevated assignments | Security 12/12; staff lifecycle 22/22 | Review existing owner/administrator assignments |
| 10 | Parameterized queries | pass | none | Drizzle builder throughout; raw `sql` templates bind values; dynamic identifiers whitelisted/hashed ([plugin-storage-migrations.ts](file:///Users/abdullahzaher/vibress/packages/domains/plugins/src/infrastructure/drizzle-plugin-storage-migrations.ts#L190)); no user-controlled raw SQL found | None | Reviewed; no injection found | — |
| 11 | Environment variables | failed | medium | `.env`/`.env.prod` untracked; no secret client prefixes; prod guard accepts any `sk_test_*` and non-HTTPS origins ([config/index.ts](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L402), [#L411](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L411)) | Reject `sk_test_`, require `https:` origins | Config tests passed (positive paths) | Fix guard before prod |
| 12 | Rate limiting | failed | medium | Global limiter disabled; per-route limits exist for login/forgot/member/search/comments/webhooks; reset acceptance, invitation acceptance, uploads, exports have none; store is in-memory ([main.ts](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L163), [auth.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L447)) | Add route limits + Redis store | Not load-tested | Approve limits |
| 13 | Restrict CORS | pass | none | Production allowlist union, `credentials: true`, no wildcard; boot fails without prod origin ([main.ts](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L195), [config/index.ts](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L262)); dev reflects any origin (F-011 note) | Require `https:` origins | Reviewed | Verify prod origins |
| 14 | Security headers | failed | medium | Enforced CSP on API/web/SPA; media SVG sandbox; gateway headers set. No HSTS on web/SPA/gateway and no `Permissions-Policy` ([nginx.prod.conf](file:///Users/abdullahzaher/vibress/infrastructure/nginx/nginx.prod.conf#L23), [nginx.spa.conf.template](file:///Users/abdullahzaher/vibress/docker/nginx.spa.conf.template#L14)) | Add HSTS + Permissions-Policy; test staged rollout | Not run against live headers | Verify at edge |
| 15 | Secure cookies | pass | low | `HttpOnly`, `Secure` in production, `SameSite=Lax`, path `/`, 7d staff/30d member ([auth.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L133), [members.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/members.ts#L167)) | Consider `__Host-` prefix and member rotation | No Set-Cookie assertion test | Confirm member TTL |
| 16 | CSRF | failed | medium | Origin/Referer validation applied to most cookie mutations; missing on staff invite/resend/revoke and comment moderation; `GET /members/auth/verify` sets a session with no origin check ([middleware/auth.ts](file:///Users/abdullahzaher/vibress/apps/api/src/middleware/auth.ts#L143), [members.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/members.ts#L200), [admin.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L46)) | Apply `validateOrigin` universally; require POST for verify | CSRF tests exist for covered routes | Approve rollout |
| 17 | Password reset links | pass | low | 32-byte token, SHA-256 at rest, 15 min, row-locked single use, all tokens invalidated, sessions revoked ([auth.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L401), [#L499](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L499)); non-prod returns the raw token (F-021) | Never return token outside tests | Lifecycle tests passed | Confirm production `NODE_ENV` |
| 18 | File uploads | fixed_verified | low | Magic bytes, extension/MIME denylist, SVG active-content checks, traversal stripping, per-type limits ([file-validator.ts](file:///Users/abdullahzaher/vibress/packages/domains/media/src/domain/file-validator.ts#L480)); direct and multipart completion now enforce declared size and per-asset ceilings and verify magic bytes fail-closed ([storage.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/storage.ts#L38), [#L586](file:///Users/abdullahzaher/vibress/apps/api/src/routes/storage.ts#L586), [#L908](file:///Users/abdullahzaher/vibress/apps/api/src/routes/storage.ts#L908)). Remaining: no storage quota (F-020) | Add per-publication quota | Media security 18/18 | Approve quota |
| 19 | Prices and payments | pass | low | Client sends only `planId`/`offerKey`; server resolves price; Stripe signature verified; unique event dedupe ([billing-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/billing/src/application/billing-service.ts#L196), [stripe-provider.ts](file:///Users/abdullahzaher/vibress/packages/domains/billing/src/infrastructure/stripe/stripe-provider.ts#L132)); paid offers are metadata-only and never redeemed/applied (F-015) | Apply discount at provider or remove paid offers | Webhook tests passed (sandbox/fixtures) | Decide offers roadmap |
| 20 | Disable debug in production | pass | low | Production 5xx hides internals; stacks logged server-side; no source maps in client builds; dev setup token gated ([main.ts](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L323), [setup.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/setup.ts#L28)) | Avoid echoing non-5xx provider messages | Reviewed | Verify `NODE_ENV` in every deployment |
| 21 | Vulnerable dependencies | failed | low | `pnpm audit`: 1 high (`nx` local socket exposure), 2 moderate (`nx` migrate traversal, `minimatch` ReDoS) — all development dependencies ([ci.yml](file:///Users/abdullahzaher/vibress/.github/workflows/ci.yml#L42) audits `--prod`) | Upgrade `nx` ≥ 23.2.1 and `minimatch` ≥ 11.0.1 | `pnpm audit` exit 1; no runtime advisories | Schedule dev-dependency bump |
| 22 | Unused packages | not_verified | none | Manifests reviewed at a high level; no unused-package analyzer was available/authorized | Run `knip`/`depcheck` in a separate task | Not run | Optional |
| 23 | Exposed files | pass | low | Public roots clean; no client source maps; media path traversal/containment guarded ([media-stream.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/media-stream.ts#L202)); `.env*` excluded from images; `backups/` still enters the Docker build context (F-023 note) | Add `backups/` and `**/.env*` to `.dockerignore` | Artifact grep found no secrets | Verify with `docker buildx` |
| 24 | Git history secrets | pass | none | Gitleaks 8.30.1 scanned 2,324 commits: 17 findings, all reviewed as synthetic test/CI fixtures; `.env`/`.env.prod` never committed | None for history; keep providers out of commits | Gitleaks exit 0 with `--redact` | — |
| 25 | Revoke and replace exposed keys | not_applicable | none | No confirmed live credential in Git history or client artifacts. Working-tree `.env`, `.env.prod`, and `apps/web/.env.local` contain real-looking secrets but are untracked/ignored | If any file or image leaked, rotate at the provider | Not applicable | Confirm no artifact/image leak |
| 26 | Integrated security review | failed | medium | F-001–F-005 and F-009 fixed and verified; remaining medium issues: CSRF gaps, offers logic, DB role separation, HSTS/HTTPS, in-memory limits (F-006…F-021) | See prioritized actions | Full API 587/587; targeted domain/security suites passed | Approve remaining remediation plan |
| 27 | Test and report | pass | none | 84 security/workspace tests, 18 newsletter domain tests, 12 email domain tests, 18 media upload security tests, 587 API tests, 45 runtime multi-publication tests, and 6 root auth security tests passed; this report covers 01–27 | Expand coverage of remaining findings | See Verification Log | Decide remaining suites |

## Findings by Severity

### Critical
None verified.

### High

#### F-001 — Newsletter sends and audience are not publication-scoped (BOLA)
- **Control:** 03 / 26
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** High (resolved). Any staff member with `newsletters.read`/`newsletters.send` in one publication could read, cancel, or re-trigger another publication's email blast, and could count/create audiences from another publication's newsletter. Exploitation required a staff account only; impact was cross-tenant confidentiality and unauthorized email sending.
- **Original evidence (redacted):** `newsletter_sends` had no `publication_id`; send routes and `getSend`/`cancelSend`/`listSends` operated on bare IDs; `computeAudience` listed all members; `POST /newsletter-sends` resolved `newsletterId` without a publication predicate.
- **Root cause:** Sends and audience were modeled without tenant ownership; CRUD was scoped, sends were not.
- **Fix applied:**
  - `newsletter_sends.publication_id` (NOT NULL, FK, index) plus a backfill/abort migration: [0052_newsletter_sends_publication_scope.sql](file:///Users/abdullahzaher/vibress/packages/database/migrations/0052_newsletter_sends_publication_scope.sql#L1), [schema/email.ts](file:///Users/abdullahzaher/vibress/packages/database/src/schema/email.ts#L90).
  - `createSend` loads the newsletter with the publication predicate and rejects mismatches/archived newsletters: [newsletters-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/newsletters/src/application/newsletters-service.ts#L264).
  - `getSend`/`cancelSend`/`listSends` accept an optional publication and the repository applies `AND publication_id = ?`: [drizzle-newsletter-repositories.ts](file:///Users/abdullahzaher/vibress/packages/domains/newsletters/src/infrastructure/drizzle-newsletter-repositories.ts#L281).
  - `computeAudience` and the audience repository scope members by publication: [newsletters-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/newsletters/src/application/newsletters-service.ts#L240), [billing-aware-member-audience-repository.ts](file:///Users/abdullahzaher/vibress/packages/domains/newsletters/src/infrastructure/billing-aware-member-audience-repository.ts#L23).
  - Every send/audience route now uses `req.publicationContext.publicationId` (list, detail, create, send-now, cancel, audience summary): [admin-newsletters.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin-newsletters.ts#L167), [#L226](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin-newsletters.ts#L226), [#L433](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin-newsletters.ts#L433).
  - The enqueuer requires a publication and verifies the send first; the scheduler uses `send.publicationId` with no fallback; the delivery worker validates the BullMQ scope: [newsletter-send-enqueuer.ts](file:///Users/abdullahzaher/vibress/apps/api/src/newsletter-send-enqueuer.ts#L40), [newsletter-send-scheduler.ts](file:///Users/abdullahzaher/vibress/apps/worker/src/schedules/newsletter-send-scheduler.ts#L64), [email-delivery-worker.ts](file:///Users/abdullahzaher/vibress/apps/worker/src/processors/email-delivery-worker.ts#L108).
- **Test command / expected / observed:** `pnpm vitest run packages/domains/newsletters` → 18/18 passed, including "scopes newsletter sends to their publication" (cross-publication read returns null, cancel rejects, list excludes). `pnpm vitest run apps/api` → 587/587 passed, including "denies cross-publication access to newsletter sends". `pnpm vitest run tests/integration/runtime-multi-publication-isolation.test.ts` → 45/45 passed.
- **Residual risk:** Historical rows are backfilled from their newsletter; the migration aborts if any row cannot be resolved, so rollout must be verified on a copy first. Replays or jobs enqueued before deployment should be drained during the cutover.
- **Approval required:** Schema migration `0052` still needs approval to apply in staging/production (applied locally only).

#### F-002 — Staff invite accepts an arbitrary global role, including `owner`
- **Control:** 09 / 26
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** High (resolved). A staff user with `users.create` (e.g. `administrator`) could invite or promote an account to the global `owner` role. `owner` short-circuits every permission check, so this was a direct privilege escalation.
- **Original evidence (redacted):** `roleKey` was taken from the request and only checked for existence; `assignRoleToUser` had no scope/rank check; `user_roles` is global; `owner` bypasses permission checks.
- **Root cause:** Role assignment was treated as a free-form value with no actor-ceiling invariant.
- **Fix applied:**
  - `canAssignRole` enforces a rank ceiling; `owner` can only be granted by an existing `owner`, and unknown/custom keys are denied on this surface: [authorization/index.ts](file:///Users/abdullahzaher/vibress/packages/security/src/authorization/index.ts#L50).
  - The invite route rejects unauthorized targets with 403 `ROLE_ESCALATION_DENIED` before creating the user, and writes a `staff.invited` audit event with the role key: [admin.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L100), [#L175](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L175).
- **Test command / expected / observed:** `pnpm vitest run packages/security` → 84/84 passed, including owner-only owner grants, ceiling checks, and unknown role keys. `pnpm vitest run apps/api/src/__tests__/staff-auth-lifecycle.test.ts` → 22/22 passed, including "rejects an administrator inviting a global owner (role ceiling)" and a permitted editor invite.
- **Residual risk:** Pre-existing `owner`/`administrator` assignments should be reviewed; other role-assignment surfaces (if added later) must call the same primitive.
- **Approval required:** None for the code change; confirm existing elevated assignments are expected.

#### F-003 — Staff tenant context fails open to `pub_default`
- **Control:** 03 / 26
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** High (resolved). A staff user removed from every publication silently received `editor` on `pub_default` (or `owner` when the publication repository was not wired), granting access to the default publication's admin surface.
- **Original evidence (redacted):** The live fallback returned `role: "editor"`/`"owner"` when no membership was found, and the dormant `!pubRepo` branch returned `owner`; the auth middleware used this to populate request context.
- **Root cause:** A bootstrap convenience fallback was left in the authorization path.
- **Fix applied:**
  - The dormant `!pubRepo` branch now throws `TenantAccessDeniedError` instead of returning `owner`: [workspace-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/workspaces/src/application/workspace-service.ts#L126).
  - The unassigned `pub_default` fallback is restricted to a global `owner`; every other unaffiliated staff member receives `TenantAccessDeniedError` (surfaced as 403 `PUBLICATION_ACCESS_DENIED`): [workspace-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/workspaces/src/application/workspace-service.ts#L226).
  - Test fixtures that exercise RBAC rather than tenant denial now create explicit `publication_memberships`.
- **Test command / expected / observed:** `pnpm vitest run packages/domains/workspaces packages/security` → 84/84 passed, including "denies unaffiliated staff without a publication membership" and "fails closed when no publication repository is configured". `pnpm vitest run tests/integration/runtime-multi-publication-isolation.test.ts` → 45/45 passed. `pnpm vitest run tests/security/auth-api.test.ts` → 6/6 passed.
- **Residual risk:** Operators who relied on implicit default access must be granted an explicit membership. The global `owner` bootstrap exception is intentional for initial setup.
- **Approval required:** None for the code change; document the membership requirement in deployment notes.

### Medium

#### F-004 — Staff directory and role list are not publication-scoped
- **Control:** 03 / 09
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** Medium (resolved). Any holder of `users.read` in one publication could enumerate every staff email and global role across all publications.
- **Original evidence (redacted):** `GET /users` called `usersService.listAll()`; `users`/`user_roles` have no tenant column ([schema/users.ts](file:///Users/abdullahzaher/vibress/packages/database/src/schema/users.ts#L4)); `GET /roles` returned every role regardless of the caller's rank.
- **Root cause:** The directory and role-list read paths had no tenant or rank predicate, unlike the rest of the admin surface.
- **Fix applied:**
  - Added `listPublicationStaffIds(publicationId)`, which unions `publication_memberships` for the publication with workspace-level `owner`/`admin` memberships: [admin.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L22).
  - `GET /users` now returns the full directory only to a global `owner`; every other staff member receives only users in the resolved publication's staff set: [admin.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L58).
  - `GET /roles` returns all roles only to a global `owner`; others receive only roles they are allowed to assign under the existing `canAssignRole` ceiling: [admin.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L91).
- **Test command / expected / observed:** `pnpm vitest run apps/api/src/__tests__/staff-auth-lifecycle.test.ts` → 22/22 passed, including "editor directory excludes users outside its publication", "orphaned global-only user is hidden from an editor but visible to the owner", and "editor role list excludes owner/administrator". Tests create and clean up their own workspace/publication/user fixtures.
- **Residual risk:** A user with no publication membership is intentionally invisible to non-owner staff; owners still see the global directory. Workspace `admin` users see all users in workspace publications through the workspace union.
- **Approval required:** None for the code change; confirm the response-shape change is acceptable to the admin UI.

#### F-005 — Email suppressions are global
- **Control:** 03
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** Medium (resolved). Suppressions were one global list: cross-tenant disclosure of suppressed addresses, and a staff member could un-suppress another publication's bounces/complaints.
- **Original evidence (redacted):** `email_suppressions` had only `(email, reason)` with no tenant column; `GET`/`DELETE /email-suppressions` operated on the whole table by email: [admin-newsletters.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin-newsletters.ts#L464), [#L478](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin-newsletters.ts#L478).
- **Root cause:** Deliverability state was modeled globally even though newsletters and audiences are publication-scoped.
- **Fix applied:**
  - `email_suppressions.publication_id` (nullable FK, cascade) where `NULL` means a provider-level/global suppression; partial unique indexes keep `(email, reason)` unique per scope: [0053_email_suppressions_publication_scope.sql](file:///Users/abdullahzaher/vibress/packages/database/migrations/0053_email_suppressions_publication_scope.sql#L1), [schema/email.ts](file:///Users/abdullahzaher/vibress/packages/database/src/schema/email.ts#L221).
  - Suppression repository and service now scope `isSuppressed`, `list`, and deletion: a publication sees its own rows plus global (`NULL`) rows; a global `owner` may also list/remove global rows; deletes return 404 instead of silently deleting out-of-scope rows: [drizzle-email-repositories.ts](file:///Users/abdullahzaher/vibress/packages/domains/email/src/infrastructure/drizzle-email-repositories.ts#L117), [email-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/email/src/application/email-service.ts#L99).
  - The API derives scope from `req.publicationContext` and grants `includeGlobal` only to `owner`: [admin-newsletters.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin-newsletters.ts#L42).
  - Audience computation, the send scheduler, and the delivery worker pass the send's publication into the suppression check; webhook bounce/complaint suppression resolves the send's publication before inserting: [newsletters-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/newsletters/src/application/newsletters-service.ts#L256), [newsletter-send-scheduler.ts](file:///Users/abdullahzaher/vibress/apps/worker/src/schedules/newsletter-send-scheduler.ts#L36), [email-delivery-worker.ts](file:///Users/abdullahzaher/vibress/apps/worker/src/processors/email-delivery-worker.ts#L58), [email-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/email/src/application/email-service.ts#L235).
  - The admin suppressions panel now deletes by row `id` rather than email, matching the scoped DELETE route: [SuppressionsPanel.tsx](file:///Users/abdullahzaher/vibress/apps/admin/src/components/newsletters/SuppressionsPanel.tsx#L26).
- **Test command / expected / observed:** `pnpm vitest run apps/api/src/__tests__/newsletters-api.test.ts` → 26/26 passed, including "global suppression applies but another publication's row does not", "editor list excludes another publication and global rows", "owner list includes global rows but not another publication's", and delete 404s for out-of-scope/global rows. `pnpm vitest run packages/domains/email` → 12/12 passed, including webhook suppression attributed to the send's publication.
- **Residual risk:** Existing rows migrate as global (`publication_id IS NULL`) and therefore still apply to every publication; operators may want to re-scope historical rows. Access is unaffected by the nullable column, but the migration must be applied before deploying the scoped code.
- **Approval required:** Migration `0053` still needs approval to apply in staging/production (applied locally only).

#### F-009 — Direct/multipart upload completion does not enforce the declared size limit
- **Control:** 18
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** Medium (resolved). A signed-URL upload could exceed the declared/global maximum and still be registered, and providers without `getSignedUrl` skipped magic-byte verification entirely.
- **Original evidence (redacted):** completion checked only `head.size <= 0`; the asset row took `sizeBytes: head.size`; signature verification was conditional on provider support ([storage.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/storage.ts#L586)).
- **Root cause:** Completion trusted the stored object's presence and treated signature verification as best-effort.
- **Fix applied:**
  - Added `maxBytesForAssetType` (image/audio/video/file ceilings from `DEFAULT_MEDIA_LIMITS`) and `readObjectHead`, which range-reads (0–512 bytes) via a short-lived signed URL or falls back to `getObjectBuffer`: [storage.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/storage.ts#L38), [#L56](file:///Users/abdullahzaher/vibress/apps/api/src/routes/storage.ts#L56).
  - Direct-upload completion rejects any object larger than `min(expectedSize, per-asset ceiling)` with 400 `MEDIA_TOO_LARGE`, marks the session failed, and deletes the stored object: [storage.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/storage.ts#L586).
  - Multipart completion applies the same bound to the finalized object before registering it: [storage.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/storage.ts#L908).
  - Signature verification is now unconditional on completion and fails closed: unreadable head → `STORAGE_SIGNATURE_UNAVAILABLE`, unsupported provider → `STORAGE_SIGNATURE_UNSUPPORTED`, and detected/declared mismatch → `MEDIA_MIME_MISMATCH`.
- **Test command / expected / observed:** `pnpm vitest run apps/api/src/__tests__/media-upload-security.test.ts` → 18/18 passed, including oversized-vs-declared, oversized-vs-asset-ceiling, MIME mismatch, unreadable-provider fail-closed, and successful direct/multipart registration for both direct and multipart paths.
- **Residual risk:** The size check is against the head object at completion; a provider that later mutates the object is out of scope. There is still no per-publication storage quota (F-020). Providers that cannot expose a head/read cannot complete uploads by design. The range read assumes the provider honors `Range: bytes=0-512`; one that ignores it would return the whole object (bounded by the size check) for magic-byte inspection.
- **Approval required:** None for the code change; confirm every configured storage provider supports signed range reads or `getObjectBuffer`.

#### F-006 — `GET /members/auth/verify` creates a session without Origin validation
- **Control:** 16
- **Severity / rationale:** Medium. A cross-site GET with a valid magic-link token logs the victim into the token owner's account (login CSRF) and leaks the token via URL/Referer logs.
- **Evidence:** [members.ts:200](file:///Users/abdullahzaher/vibress/apps/api/src/routes/members.ts#L200) sets the cookie at [#L259](file:///Users/abdullahzaher/vibress/apps/api/src/routes/members.ts#L259); no `validateMemberOrigin`.
- **Proposed fix:** Make verification a POST with Origin validation, or require a same-site confirmation step; strip tokens from Referer.
- **Approval:** Yes (flow change).

#### F-007 — Missing Origin checks on several staff mutations
- **Control:** 16
- **Severity / rationale:** Medium (defense in depth; `SameSite=Lax` blunts most cross-site POSTs). Staff invite/resend/revoke and comment moderation rely on session cookies without `validateOrigin`.
- **Evidence:** [admin.ts:46](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L46), [#L195](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L195), [#L308](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L308); [comments.ts:544](file:///Users/abdullahzaher/vibress/apps/api/src/routes/comments.ts#L544) and subsequent moderation routes.
- **Proposed fix:** Add `validateOrigin` to every cookie-authenticated mutation; add a route-metadata test that enumerates them.
- **Approval:** Yes.

#### F-008 — Password reset acceptance has no rate limit
- **Control:** 12
- **Severity / rationale:** Medium. Unlimited token submissions enable CPU-expensive Argon2 work (DoS) and unthrottled guessing (256-bit token makes success infeasible).
- **Evidence:** [auth.ts:447](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L447) has only `validateOrigin`; `forgot-password` is limited at [#L367](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L367).
- **Proposed fix:** Add per-IP + per-account limits and fail-closed throttling.
- **Approval:** Yes.

#### F-010 — Public site-privacy HMAC fallback; web container lacks the key
- **Control:** 02 / 11
- **Severity / rationale:** Medium. The web tier signs/verifies private-site cookies with the literal `vibress-site-privacy-secret` when `VIBRESS_ENCRYPTION_KEY` is absent, while the API signs with the real key. In the shipped compose file the `web` service does not receive the key, so legitimate private-site cookies are rejected (fail closed) and the fallback secret is publicly known. API-side enforcement prevents a full content bypass.
- **Evidence:** [middleware.ts:301](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L301), [route.ts:41](file:///Users/abdullahzaher/vibress/apps/web/src/app/api/verify-site-password/route.ts#L41), [compose.prod.yml:172](file:///Users/abdullahzaher/vibress/compose.prod.yml#L172), [content.ts:280](file:///Users/abdullahzaher/vibress/apps/api/src/routes/content.ts#L280).
- **Proposed fix:** Remove the fallback and fail closed; pass the key to `web` or delegate cookie verification to the API.
- **Approval:** Yes.

#### F-011 — HTTPS/HSTS not enforced by deployable configuration
- **Control:** 04 / 13 / 14
- **Severity / rationale:** Medium. The gateway is HTTP-only and delegates TLS to an external edge; no HSTS is emitted by web/SPA/gateway, and production origins are not required to be `https:`. The sample `.env.prod` uses `http://localhost` origins.
- **Evidence:** [nginx.prod.conf:13](file:///Users/abdullahzaher/vibress/infrastructure/nginx/nginx.prod.conf#L13), [nginx.prod.conf:23](file:///Users/abdullahzaher/vibress/infrastructure/nginx/nginx.prod.conf#L23), [config/index.ts:187](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L187).
- **Proposed fix:** Edge TLS + HTTP→HTTPS redirect + staged HSTS; validate `https:` production origins at boot; add `Permissions-Policy`.
- **Approval:** Yes (deployment + config).

#### F-012 — Database access uses the PostgreSQL owner role; no RLS
- **Control:** 03
- **Severity / rationale:** Medium. The application principal can `DROP`/`ALTER` all tables and bypasses any future RLS; tenant isolation is entirely application-level.
- **Evidence:** [compose.prod.yml:44](file:///Users/abdullahzaher/vibress/compose.prod.yml#L44) initializes with `POSTGRES_USER`; [#L86](file:///Users/abdullahzaher/vibress/compose.prod.yml#L86) reuses it for API/worker/migrate. No `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY` in `packages/database/migrations`.
- **Proposed fix:** Create a least-privilege runtime role (DML only) with a separate migration role; consider RLS for tenant tables.
- **Approval:** Yes (infrastructure + migrations).

#### F-013 — Rate limiter is per-process and several expensive routes are unprotected
- **Control:** 12
- **Severity / rationale:** Medium. Limits reset on restart and are not shared across replicas; uploads, imports/exports, theme ZIP, invitation acceptance, and reset acceptance have no limiter.
- **Evidence:** [main.ts:163](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L163) registers `@fastify/rate-limit` without a Redis store; [media.ts:28](file:///Users/abdullahzaher/vibress/apps/api/src/routes/media.ts#L28), [themes.ts:120](file:///Users/abdullahzaher/vibress/apps/api/src/routes/themes.ts#L120), [operations.ts:604](file:///Users/abdullahzaher/vibress/apps/api/src/routes/operations.ts#L604).
- **Proposed fix:** Use a Redis store and add limits to expensive/abuse-prone routes.
- **Approval:** Yes.

#### F-014 — Production guard accepts test-mode Stripe keys
- **Control:** 11 / 19
- **Severity / rationale:** Medium. Only the exact literal `sk_test_missing` is rejected, so a real `sk_test_*` key boots in production, silently accepting test payments.
- **Evidence:** [config/index.ts:402](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L402).
- **Proposed fix:** Reject any `sk_test_`/`pk_test_` value in production and validate `whsec_` shape.
- **Approval:** Yes.

### Low / Informational

#### F-015 — Paid-plan offers are metadata-only
- **Control:** 19
- **Severity:** Low/medium (business logic). The offer is validated and placed in Stripe metadata, but no discount is applied and redemption is only consumed on the free-plan path ([billing-service.ts:211](file:///Users/abdullahzaher/vibress/packages/domains/billing/src/application/billing-service.ts#L211), [#L248](file:///Users/abdullahzaher/vibress/packages/domains/billing/src/application/billing-service.ts#L248)). Paid offers therefore do nothing and `maxRedemptions` is never enforced for them.
- **Fix:** Apply a provider coupon or compute a discounted price server-side and consume the offer on fulfillment.

#### F-016 — Development-only dependency advisories
- **Control:** 21
- **Severity:** Low (no runtime exposure). `nx` high (local socket access) and moderate (migrate path traversal), `minimatch` moderate (ReDoS) — all under dev tooling. `pnpm audit --prod` passes in CI.
- **Fix:** Upgrade `nx` to ≥ 23.2.1 and `minimatch` to ≥ 11.0.1.

#### F-017 — Handlers that bypass schema validation
- **Control:** 06
- **Severity:** Low. `collaboration.ts`, `admin.ts` (invite body), `ai.ts`, and `operations.ts` read bodies with type assertions only ([collaboration.ts:105](file:///Users/abdullahzaher/vibress/apps/api/src/routes/collaboration.ts#L105), [ai.ts:49](file:///Users/abdullahzaher/vibress/apps/api/src/routes/ai.ts#L49)). All are behind staff auth.

#### F-018 — Theme-package HTML is rendered without sanitization
- **Control:** 07
- **Severity:** Low (staff-only trust boundary + strict CSP). `cleanThemeHtml` strips document wrappers but does not sanitize ([theme-renderer.tsx:218](file:///Users/abdullahzaher/vibress/apps/web/src/lib/theme-renderer.tsx#L218), [#L484](file:///Users/abdullahzaher/vibress/apps/web/src/lib/theme-renderer.tsx#L484)). A malicious `themes.manage` holder can store script content; CSP blocks inline execution but not all exfiltration.
- **Fix:** Sanitize theme output or document theme packages as fully trusted.

#### F-019 — No `Permissions-Policy`
- **Control:** 14
- **Severity:** Low. Only one iframe route sets it ([extension-admin-iframe.ts:226](file:///Users/abdullahzaher/vibress/apps/api/src/routes/extension-admin-iframe.ts#L226)).

#### F-020 — No storage quota
- **Control:** 18
- **Severity:** Low. Per-file limits exist; no per-publication/workspace total-byte quota was found.

#### F-021 — Non-production password reset returns the raw token
- **Control:** 17 / 20
- **Severity:** Low in production (gated on `isProduction`), high if `NODE_ENV` is misconfigured ([auth.ts:441](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L441)). Ensure every deployment sets `NODE_ENV=production`.

#### F-022 — Pages have no per-resource authorship check
- **Control:** 03
- **Severity:** Low (policy dependent). Any `pages.edit` holder can modify any page in the publication ([pages-service.ts:122](file:///Users/abdullahzaher/vibress/packages/domains/pages/src/application/pages-service.ts#L122)); confirm this is intended for pages (unlike posts).

#### F-023 — Docker build context caveats
- **Control:** 23
- **Severity:** Low. `.dockerignore` excludes root `.env`/`.env.*` but not `backups/` (SQL dumps) and uses a non-recursive `.env.*` pattern, so nested `apps/web/.env.local` may enter the build context used by `COPY . .` ([.dockerignore:12](file:///Users/abdullahzaher/vibress/.dockerignore#L12), [api.Dockerfile:12](file:///Users/abdullahzaher/vibress/docker/api.Dockerfile#L12)). Runtime stages copy only `dist`/`.next`, so this affects builder layers/cache, not the running container.
- **Fix:** Add `backups/` and use `**/.env*`; confirm with `docker buildx`.

#### F-024 — Cookie hardening opportunities
- **Control:** 15
- **Severity:** Low. No `__Host-` prefix; member sessions live 30 days with no rotation ([members.ts:167](file:///Users/abdullahzaher/vibress/apps/api/src/routes/members.ts#L167)).

#### F-025 — Billing/offer actions lack audit events
- **Control:** 08
- **Severity:** Low. `packages/domains/billing` has no audit repository; only billing-event records exist.

## Changed Files

Remediation was explicitly authorized for F-001–F-005 and F-009.

**F-001 — publication-scoped newsletter sends**
- `packages/database/migrations/0052_newsletter_sends_publication_scope.sql` (new)
- `packages/database/migrations/meta/_journal.json`
- `packages/database/src/schema/email.ts`
- `packages/domains/newsletters/src/domain/send.ts`
- `packages/domains/newsletters/src/infrastructure/drizzle-newsletter-repositories.ts`
- `packages/domains/newsletters/src/infrastructure/billing-aware-member-audience-repository.ts`
- `packages/domains/newsletters/src/application/newsletters-service.ts`
- `apps/api/src/newsletter-send-enqueuer.ts`
- `apps/api/src/routes/admin-newsletters.ts`
- `apps/worker/src/schedules/newsletter-send-scheduler.ts`
- `apps/worker/src/processors/email-delivery-worker.ts`
- Tests: `packages/domains/newsletters/src/__tests__/newsletters-isolation.test.ts`, `packages/domains/newsletters/tests/newsletters-service.test.ts`, `apps/api/src/__tests__/newsletters-api.test.ts`

**F-002 — invite role ceiling**
- `packages/security/src/authorization/index.ts`
- `apps/api/src/routes/admin.ts`
- Tests: `packages/security/src/__tests__/security.test.ts`, `apps/api/src/__tests__/staff-auth-lifecycle.test.ts`

**F-003 — fail-closed staff tenant context**
- `packages/domains/workspaces/src/application/workspace-service.ts`
- Tests: `packages/domains/workspaces/src/__tests__/drizzle-workspace-context.test.ts`, `packages/domains/workspaces/src/__tests__/tenant-isolation.test.ts`, `tests/security/auth-api.test.ts`

**Fixture updates for the fail-closed context** (RBAC tests now seed explicit `pub_default` memberships): `apps/api/src/__tests__/billing-api.test.ts`, `content-models-lifecycle-and-concurrency.test.ts`, `media-upload-security.test.ts`, `theme-lifecycle-hardening.test.ts`, `whats-new-api.test.ts`, `tests/integration/analytics.test.ts`.

**Migration-journal test maintenance:** `packages/database/src/__tests__/migration-0051-default-theme-legacy-accent.test.ts` now locates 0051 by tag and checks it directly follows 0050 instead of assuming 0051 is the final journal entry.

**F-004 — publication-scoped staff directory and roles**
- `apps/api/src/routes/admin.ts`
- Tests: `apps/api/src/__tests__/staff-auth-lifecycle.test.ts`

**F-005 — publication-scoped email suppressions**
- `packages/database/migrations/0053_email_suppressions_publication_scope.sql` (new)
- `packages/database/migrations/meta/_journal.json`
- `packages/database/src/schema/email.ts`
- `packages/domains/email/src/domain/recipient.ts`
- `packages/domains/email/src/infrastructure/drizzle-email-repositories.ts`
- `packages/domains/email/src/application/email-service.ts`
- `packages/domains/newsletters/src/application/newsletters-service.ts`
- `apps/api/src/services.ts`
- `apps/api/src/routes/admin-newsletters.ts`
- `apps/worker/src/schedules/newsletter-send-scheduler.ts`
- `apps/worker/src/processors/email-delivery-worker.ts`
- `apps/admin/src/components/newsletters/SuppressionsPanel.tsx`
- Tests: `packages/domains/email/tests/email-service.test.ts`, `apps/api/src/__tests__/newsletters-api.test.ts`

**F-009 — upload completion size and signature enforcement**
- `apps/api/src/routes/storage.ts`
- Tests: `apps/api/src/__tests__/media-upload-security.test.ts`

- `SECURITY-REVIEW.md` — this report (updated).
- Pre-existing untracked from the skill install: `.qoder/`, `skills-lock.json`.

> Environment note: running the repository's Vitest global setup executed
> migrations and seeding against the local development Postgres
> (`127.0.0.1:5433`, database `vibress`); migrations `0052` and `0053` were
> applied there. Test-created fixtures were removed with a one-off cleanup after
> the runs; the seed/admin accounts remain. No external system was contacted and
> no credential was changed.

## Verification Log

| Command or method | Environment | Exit / observed | Result | Notes |
|---|---|---|---|---|
| `python3 scripts/preflight.py --root .` | local | exit 0; 5,528 files; 0 symlinks | pass | Filename/metadata inventory only |
| `gitleaks git --redact` (8.30.1) | local, full history | exit 0; 2,324 commits; 17 findings | pass (limited) | All findings reviewed as synthetic test/CI fixtures |
| `git log --all -- .env .env.prod` | local | no output | pass | Env files never committed |
| `pnpm audit --json` | local + npm advisory DB | exit 1; 1 high / 2 moderate | fail (dev-only) | `nx`, `minimatch` |
| `pnpm vitest run packages/domains/workspaces packages/security` | local + dev DB | 10 files / 84 tests passed | pass | Includes fail-closed context, role ceiling, and publication isolation |
| `pnpm vitest run apps/api` | local + dev DB | 58 files / 587 tests passed | pass | Full API unit/integration suite; includes newsletters, staff lifecycle, RBAC, upload security |
| `pnpm vitest run apps/api/src/__tests__/staff-auth-lifecycle.test.ts` | local + dev DB | 1 file / 22 tests passed | pass | Includes F-004 directory/role isolation and cleanup |
| `pnpm vitest run apps/api/src/__tests__/newsletters-api.test.ts` | local + dev DB | 1 file / 26 tests passed | pass | Includes F-005 suppression scope and delete isolation |
| `pnpm vitest run apps/api/src/__tests__/media-upload-security.test.ts` | local + dev DB | 1 file / 18 tests passed | pass | Includes F-009 size ceilings, MIME mismatch, fail-closed provider |
| `pnpm vitest run packages/domains/newsletters` | local + dev DB | 2 files / 18 tests passed | pass | Includes send publication isolation |
| `pnpm vitest run packages/domains/email` | local + dev DB | 12 tests passed | pass | Includes publication-attributed webhook suppressions |
| `pnpm vitest run tests/integration/analytics.test.ts packages/database` | local + dev DB | 21 files / 86 tests passed | pass | Tenant-scoped analytics authorization and migration journal ordering (includes CI failure fixes) |
| `pnpm vitest run tests/integration/runtime-multi-publication-isolation.test.ts` | local + dev DB | 1 file / 45 tests passed | pass | End-to-end multi-publication isolation |
| `pnpm vitest run tests/security/auth-api.test.ts` | local + dev DB | 1 file / 6 tests passed | pass | Auth/authorization API security |
| `pnpm -r --filter @vibress/database --filter @vibress/email --filter @vibress/newsletters --filter @vibress/api --filter @vibress/worker --filter @vibress/admin typecheck` | local | exit 0 | pass | Affected packages only |
| Full monorepo `pnpm vitest run`, E2E, Playwright | not run | — | not_verified | Time/environment; CI runs these |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | not run | — | not_verified | CI covers them |
| Staging/public HTTP, TLS/HSTS checks | not run | — | not_verified | No authorized external target |

## Approvals and Manual Actions

- [x] F-001, F-002, F-003, F-004, F-005, and F-009 remediated and covered by
  negative isolation/authorization tests (authorized 2026-11-13).
- [ ] Approve and apply migrations `0052_newsletter_sends_publication_scope` and
  `0053_email_suppressions_publication_scope` in staging then production; verify
  backfills and drain in-flight send jobs during the cutover.
- [ ] Grant explicit publication memberships to any operator who previously
  relied on implicit `pub_default` access.
- [ ] Decide whether historical global suppressions should be re-scoped to a
  publication (they remain global after migration).
- [ ] Confirm every configured storage provider supports signed range reads or
  `getObjectBuffer`, otherwise uploads fail closed.
- [ ] Approve CSRF rollout (`validateOrigin` on all cookie mutations; POST for
  member verify).
- [ ] Approve rate-limit additions and Redis-backed store.
- [ ] Approve a per-publication storage quota (F-020).
- [ ] Verify edge TLS redirect + HSTS and `https:` production origins in staging.
- [ ] Verify the deployed Stripe key mode and reject `sk_test_*` at boot.
- [ ] Create a least-privilege PostgreSQL runtime role; evaluate RLS.
- [ ] Confirm `NODE_ENV=production` in every deployment (reset-token exposure and
  cookie `Secure` depend on it).
- [ ] If any `.env`/`.env.prod`/`apps/web/.env.local` content or Docker build
  cache was shared outside the trusted host, rotate the affected credentials at
  the provider. No live key was found in Git history.

## Limitations and Residual Risk

- Static review plus scoped local tests only; no live browser, staging, or
  production verification. A green local suite does not prove deployed behavior.
- Edge/CDN TLS, HSTS preload, and gateway header forwarding were not tested;
  the repository delegates them to external infrastructure.
- Docker build-context matching (nested `.env.local`, `backups/`) should be
  confirmed with `docker buildx` before relying on `.dockerignore`.
- The full monorepo regression matrix, E2E, typecheck, lint, and production build
  were not executed; they are not implied by the passing tests above.
- RLS is absent, so database-level isolation claims depend entirely on
  application predicates.
- An independent professional penetration test is advisable before a
  multi-tenant production launch, especially for billing, plugins, collaboration
  WebSockets, and media delivery.
