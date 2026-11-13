# Prelaunch Security Review — Vibress

> Audit plus owner-authorized remediation of F-001, F-002, F-003, F-004, F-005,
> F-006, F-007, F-008, F-009, F-010, F-011, F-012, and F-014. No other findings
> were changed. This report is not a certification and does not replace an
> independent penetration test.

## Scope

- **Project / revision:** `vibress-monorepo` at `85e58dd5` (`main`) plus the
  uncommitted F-012 runtime-role change in the working tree; version 1.2.0. The
  audit baseline was `67a4de4b`.
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
  maps inspection of a deployed artifact, no full monorepo test run (the API,
  `tests/integration`, `tests/security`, and affected domain suites were run),
  typecheck only for affected packages, no lint/build run, no RLS runtime test,
  no independent pentest. Edge
  TLS configuration is outside this repository. Migrations `0052` and `0053`
  were applied to the local Docker database, which the owner designated as the
  staging rehearsal on 2026-11-13; no external staging or production database
  was contacted.

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
  7. F-014 — production boot rejects any test-mode Stripe key (`sk_test_`,
     `rk_test_`, `pk_test_`) and any webhook secret that is not a `whsec_`
     signing secret, so test payments can no longer silently reach production.
  8. F-011 — production boot rejects any non-`https:` origin (`SITE_URL`,
     `PORTAL_URL`, `API_URL`, CORS allowlist), and web, SPA, gateway, and API
     responses now emit staged HSTS (`max-age=300`) plus a restrictive
     `Permissions-Policy`.
  9. F-007 — every cookie-authenticated staff mutation (invite/resend/revoke,
     all comment moderation/report actions, What's New dismissal) now runs
     `validateOrigin`, and a scanner test fails if a future mutation lacks the
     matching member/staff Origin guard.
  10. F-008 — password reset acceptance is limited to 5 requests/minute per
      client IP in production, matching forgot-password, so unauthenticated
      submissions can no longer spend unbounded Argon2 CPU.
  11. F-010 — web private-site verification now uses only the shared
      `VIBRESS_ENCRYPTION_KEY` and fails closed without it; the public fallback
      secret is removed from both verification and cookie minting, and the
      production compose passes the key to `web`.
  12. F-006 — magic-link verification is POST-only. The GET handler that
      consumed tokens and set the session cookie without any Origin check is
      removed; the portal already verified through POST.
  13. F-012 — `api`/`worker` now connect through a provisioned, non-owner
      runtime role (DML plus plugin-storage DDL, no ownership); only the
      one-shot migrate job keeps the database owner credential. RLS was
      evaluated and deferred.
- **Verified medium issues still open:** the in-memory rate limiter with
  several unprotected expensive routes (F-013). Edge TLS/redirect and the HSTS
  max-age ramp remain deployment actions; the shipped HSTS value is
  intentionally short.
- **Remaining approvals:** the remaining medium-severity fixes and the
  production rollout of migrations `0052`/`0053` still require owner approval;
  see [Approvals and Manual Actions](#approvals-and-manual-actions).
- **Unverified areas:** live TLS/HSTS, Docker build-context matching, full test
  matrix, dependency tree unused-package analysis, runtime RLS behavior.

## 27-Point Control Matrix

| ID | Control | Status | Severity | Evidence | Fix | Test result | Owner action |
|---|---|---|---|---|---|---|---|
| 01 | Authentication | pass | low | Opaque 32-byte sessions stored as SHA-256, revoked/expiry checked per request; per-request role reload ([auth-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/auth/src/application/auth-service.ts#L82), [middleware/auth.ts](file:///Users/abdullahzaher/vibress/apps/api/src/middleware/auth.ts#L42), [drizzle-session-repository.ts](file:///Users/abdullahzaher/vibress/packages/domains/auth/src/infrastructure/drizzle-session-repository.ts#L33)) | Wire MFA/SSO or document them as not shipped; add idle timeout | 82 unit + 98 API tests passed | Confirm MFA expectation for launch |
| 02 | Protect API keys | fixed_verified | medium | No server secret in client bundles; only `NEXT_PUBLIC_SITE_URL` is public. Site-privacy verification now uses only `VIBRESS_ENCRYPTION_KEY` and fails closed without it ([middleware.ts](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L315)); the web cookie-minting fallback is removed and `web` receives the key in compose ([route.ts](file:///Users/abdullahzaher/vibress/apps/web/src/app/api/verify-site-password/route.ts#L37), [compose.prod.yml](file:///Users/abdullahzaher/vibress/compose.prod.yml#L183)) | Keep the key shared between `api` and `web` | Middleware/route 22/22; build artifacts scanned previously: no secret names/keys | Confirm the key is set for `web` at deployment |
| 03 | Secure database access | fixed_verified | medium | F-001, F-003, F-004, and F-005 fixed, and F-012 role separation applied: `api`/`worker` connect as a non-owner runtime role with DML but no ownership of core tables, while the migrate job keeps the owner credential ([runtime-role.ts](file:///Users/abdullahzaher/vibress/packages/database/src/runtime-role.ts#L33), [migrate.ts](file:///Users/abdullahzaher/vibress/packages/database/src/migrate.ts#L36), [compose.prod.yml](file:///Users/abdullahzaher/vibress/compose.prod.yml#L88)). RLS remains disabled by design | Add `POSTGRES_APP_PASSWORD` at deploy; approve an RLS project if required | DB 20 files / 58 tests (incl. 7 role tests); runtime probe denied DROP/TRUNCATE; full API 594/594; integration/security 532/532 | Confirm runtime-role credentials per deployment |
| 04 | Enforce HTTPS | needs_approval | medium | Boot now rejects any non-`https:` production origin (`SITE_URL`, `PORTAL_URL`, `API_URL`, every CORS origin) ([config/index.ts](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L435)); staged HSTS (`max-age=300`) is emitted by web middleware, the gateway, both SPAs, and the API. The gateway itself still listens on HTTP and relies on an external edge for TLS + HTTP→HTTPS redirect ([nginx.prod.conf](file:///Users/abdullahzaher/vibress/infrastructure/nginx/nginx.prod.conf#L13)) | Configure edge TLS + redirect, then raise HSTS max-age after staging verification | Config tests 9/9; middleware 20/20 | Approve edge deployment and HSTS ramp |
| 05 | Hash passwords | pass | none | Argon2id; library-generated salt; no password logging ([passwords/index.ts](file:///Users/abdullahzaher/vibress/packages/security/src/passwords/index.ts#L37)) | Set explicit memory/time/parallelism parameters | Unit tests passed | Confirm tuning on smallest target |
| 06 | Server-side validation | pass | low | Zod at most boundaries (`safeParse`); global 1 MB body limit; per-route limits ([main.ts](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L137)); some handlers cast bodies directly (F-017) | Add schemas to collaboration/ai/admin/operations handlers | API tests passed | Schedule hardening |
| 07 | Cross-site scripting | pass | low | parse5 allowlist sanitizer on ingest and render; iframe/URL allowlists; nonce CSP ([sanitize.ts](file:///Users/abdullahzaher/vibress/packages/studio-utils/src/sanitize.ts#L1), [middleware.ts](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L124)); theme HTML is staff-only and unsanitized (F-018) | Sanitize or sandbox theme output | XSS regression tests passed | Decide theme trust model |
| 08 | Logging and monitoring | pass | low | Structured JSON with key-name redaction; no body/header logging; auth/media/post/theme audit events ([observability/index.ts](file:///Users/abdullahzaher/vibress/packages/observability/src/index.ts#L186)); billing audit missing (F-025) | Add billing/offer audit events | Not exercised against a live sink | Confirm alert routing |
| 09 | Restrict admin routes | fixed_verified | low | All admin routes carry `requireStaffSession` + permission; invite enforces an actor→target role ceiling and audit event; the directory and role list are publication-scoped and rank-filtered ([admin.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L22), [#L58](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L58), [#L91](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L91), [authorization/index.ts](file:///Users/abdullahzaher/vibress/packages/security/src/authorization/index.ts#L63)) | Review existing elevated assignments | Security 12/12; staff lifecycle 23/23 | Review existing owner/administrator assignments |
| 10 | Parameterized queries | pass | none | Drizzle builder throughout; raw `sql` templates bind values; dynamic identifiers whitelisted/hashed ([plugin-storage-migrations.ts](file:///Users/abdullahzaher/vibress/packages/domains/plugins/src/infrastructure/drizzle-plugin-storage-migrations.ts#L190)); no user-controlled raw SQL found | None | Reviewed; no injection found | — |
| 11 | Environment variables | pass | low | `.env`/`.env.prod` untracked; no secret client prefixes; the production guard now rejects any non-live Stripe key, a malformed webhook secret, and non-HTTPS origins ([config/index.ts](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L405)) | Keep runtime secrets out of images | Config tests 9/9 (positive + negative) | Confirm production secrets |
| 12 | Rate limiting | failed | medium | Global limiter disabled; per-route limits exist for login/forgot/member/search/comments/webhooks, and reset acceptance is now limited to 5/min per IP in production ([auth.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L449)). Remaining: invitation acceptance, uploads, exports, theme ZIP have no limiter and the store is in-memory ([main.ts](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L163)) | Add remaining route limits + Redis store | Auth hardening (reset 429) passed; full API 594/594; not load-tested | Approve remaining limits and Redis store |
| 13 | Restrict CORS | pass | none | Production allowlist union, `credentials: true`, no wildcard; boot fails without a production origin and now rejects any non-`https:` origin ([main.ts](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L195), [config/index.ts](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L435)); dev reflects any origin | None | Config tests 9/9 | Verify prod origins |
| 14 | Security headers | fixed_verified | medium | Enforced CSP on API/web/SPA; media SVG sandbox; gateway headers set. Staged HSTS (`max-age=300`) and a restrictive `Permissions-Policy` are now emitted by web middleware, the gateway, both SPAs, and API Helmet ([middleware.ts](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L8), [nginx.prod.conf](file:///Users/abdullahzaher/vibress/infrastructure/nginx/nginx.prod.conf#L23), [nginx.spa.conf.template](file:///Users/abdullahzaher/vibress/docker/nginx.spa.conf.template#L12), [main.ts](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L176)) | Raise HSTS max-age after edge verification | Middleware 20/20; API hardening 20/20; nginx config reviewed, not executed | Verify live headers at edge |
| 15 | Secure cookies | pass | low | `HttpOnly`, `Secure` in production, `SameSite=Lax`, path `/`, 7d staff/30d member ([auth.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L133), [members.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/members.ts#L167)) | Consider `__Host-` prefix and member rotation | No Set-Cookie assertion test | Confirm member TTL |
| 16 | CSRF | fixed_verified | medium | Cookie-authenticated staff mutations validate Origin (F-007), and magic-link verification is POST-only: the unguarded GET handler is removed, so a cross-site navigation cannot consume a token or set a session (F-006) ([middleware/auth.ts](file:///Users/abdullahzaher/vibress/apps/api/src/middleware/auth.ts#L143), [members.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/members.ts#L107), [csrf-origin-coverage.test.ts](file:///Users/abdullahzaher/vibress/apps/api/src/__tests__/csrf-origin-coverage.test.ts#L17)) | — | CSRF negative tests passed; cross-site GET returns 404 with no cookie; full API 594/594 | None |
| 17 | Password reset links | pass | low | 32-byte token, SHA-256 at rest, 15 min, row-locked single use, all tokens invalidated, sessions revoked ([auth.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L401), [#L499](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L499)); non-prod returns the raw token (F-021) | Never return token outside tests | Lifecycle tests passed | Confirm production `NODE_ENV` |
| 18 | File uploads | fixed_verified | low | Magic bytes, extension/MIME denylist, SVG active-content checks, traversal stripping, per-type limits ([file-validator.ts](file:///Users/abdullahzaher/vibress/packages/domains/media/src/domain/file-validator.ts#L480)); direct and multipart completion now enforce declared size and per-asset ceilings and verify magic bytes fail-closed ([storage.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/storage.ts#L38), [#L586](file:///Users/abdullahzaher/vibress/apps/api/src/routes/storage.ts#L586), [#L908](file:///Users/abdullahzaher/vibress/apps/api/src/routes/storage.ts#L908)). Remaining: no storage quota (F-020) | Add per-publication quota | Media security 18/18 | Approve quota |
| 19 | Prices and payments | pass | low | Client sends only `planId`/`offerKey`; server resolves price; Stripe signature verified; unique event dedupe ([billing-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/billing/src/application/billing-service.ts#L196), [stripe-provider.ts](file:///Users/abdullahzaher/vibress/packages/domains/billing/src/infrastructure/stripe/stripe-provider.ts#L132)); production boot now rejects test-mode Stripe keys and a malformed `whsec_` secret ([config/index.ts](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L405)); paid offers are metadata-only and never redeemed/applied (F-015) | Apply discount at provider or remove paid offers | Config tests 9/9; webhook tests passed (sandbox/fixtures) | Decide offers roadmap |
| 20 | Disable debug in production | pass | low | Production 5xx hides internals; stacks logged server-side; no source maps in client builds; dev setup token gated ([main.ts](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L323), [setup.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/setup.ts#L28)) | Avoid echoing non-5xx provider messages | Reviewed | Verify `NODE_ENV` in every deployment |
| 21 | Vulnerable dependencies | failed | low | `pnpm audit`: 1 high (`nx` local socket exposure), 2 moderate (`nx` migrate traversal, `minimatch` ReDoS) — all development dependencies ([ci.yml](file:///Users/abdullahzaher/vibress/.github/workflows/ci.yml#L42) audits `--prod`) | Upgrade `nx` ≥ 23.2.1 and `minimatch` ≥ 11.0.1 | `pnpm audit` exit 1; no runtime advisories | Schedule dev-dependency bump |
| 22 | Unused packages | not_verified | none | Manifests reviewed at a high level; no unused-package analyzer was available/authorized | Run `knip`/`depcheck` in a separate task | Not run | Optional |
| 23 | Exposed files | pass | low | Public roots clean; no client source maps; media path traversal/containment guarded ([media-stream.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/media-stream.ts#L202)); `.env*` excluded from images; `backups/` still enters the Docker build context (F-023 note) | Add `backups/` and `**/.env*` to `.dockerignore` | Artifact grep found no secrets | Verify with `docker buildx` |
| 24 | Git history secrets | pass | none | Gitleaks 8.30.1 scanned 2,324 commits: 17 findings, all reviewed as synthetic test/CI fixtures; `.env`/`.env.prod` never committed | None for history; keep providers out of commits | Gitleaks exit 0 with `--redact` | — |
| 25 | Revoke and replace exposed keys | not_applicable | none | No confirmed live credential in Git history or client artifacts. Working-tree `.env`, `.env.prod`, and `apps/web/.env.local` contain real-looking secrets but are untracked/ignored | If any file or image leaked, rotate at the provider | Not applicable | Confirm no artifact/image leak |
| 26 | Integrated security review | failed | medium | F-001–F-012 and F-014 fixed and verified; remaining medium issue: in-memory/unprotected rate limits (F-013) | See prioritized actions | Full API 594/594; integration/security 532/532; DB 59/59; targeted config/middleware suites passed | Approve remaining remediation plan |
| 27 | Test and report | pass | none | 84 security/workspace tests, 18 newsletter domain tests, 12 email domain tests, 18 media upload security tests, 59 database tests (incl. 8 runtime-role), 594 API tests, 532 integration/security tests, 45 runtime multi-publication tests, 9 config tests, 20 web middleware tests, and 2 private-site route tests passed; this report covers 01–27 | Expand coverage of remaining findings | See Verification Log | Decide remaining suites |

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
- **Test command / expected / observed:** `pnpm vitest run packages/domains/newsletters` → 18/18 passed, including "scopes newsletter sends to their publication" (cross-publication read returns null, cancel rejects, list excludes). `pnpm vitest run apps/api` → 593/593 passed, including "denies cross-publication access to newsletter sends". `pnpm vitest run tests/integration/runtime-multi-publication-isolation.test.ts` → 45/45 passed.
- **Residual risk:** Historical rows are backfilled from their newsletter; the migration aborts if any row cannot be resolved, so rollout must be verified on a copy first. Replays or jobs enqueued before deployment should be drained during the cutover.
- **Approval required:** Migration `0052` is applied and verified in the owner-designated local Docker staging rehearsal; approval is still required for the external staging/production deployment.

#### F-002 — Staff invite accepts an arbitrary global role, including `owner`
- **Control:** 09 / 26
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** High (resolved). A staff user with `users.create` (e.g. `administrator`) could invite or promote an account to the global `owner` role. `owner` short-circuits every permission check, so this was a direct privilege escalation.
- **Original evidence (redacted):** `roleKey` was taken from the request and only checked for existence; `assignRoleToUser` had no scope/rank check; `user_roles` is global; `owner` bypasses permission checks.
- **Root cause:** Role assignment was treated as a free-form value with no actor-ceiling invariant.
- **Fix applied:**
  - `canAssignRole` enforces a rank ceiling; `owner` can only be granted by an existing `owner`, and unknown/custom keys are denied on this surface: [authorization/index.ts](file:///Users/abdullahzaher/vibress/packages/security/src/authorization/index.ts#L50).
  - The invite route rejects unauthorized targets with 403 `ROLE_ESCALATION_DENIED` before creating the user, and writes a `staff.invited` audit event with the role key: [admin.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L100), [#L175](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L175).
- **Test command / expected / observed:** `pnpm vitest run packages/security` → 84/84 passed, including owner-only owner grants, ceiling checks, and unknown role keys. `pnpm vitest run apps/api/src/__tests__/staff-auth-lifecycle.test.ts` → 23/23 passed, including "rejects an administrator inviting a global owner (role ceiling)" and a permitted editor invite.
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
- **Test command / expected / observed:** `pnpm vitest run apps/api/src/__tests__/staff-auth-lifecycle.test.ts` → 23/23 passed, including "editor directory excludes users outside its publication", "orphaned global-only user is hidden from an editor but visible to the owner", and "editor role list excludes owner/administrator". Tests create and clean up their own workspace/publication/user fixtures.
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
- **Approval required:** Migration `0053` is applied and verified in the owner-designated local Docker staging rehearsal; approval is still required for the external staging/production deployment.

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

#### F-011 — HTTPS/HSTS not enforced by deployable configuration
- **Control:** 04 / 13 / 14
- **Status:** `fixed_verified` (2026-11-13) for code/config; edge TLS remains a deployment action
- **Severity / rationale:** Medium (mitigated). The gateway is HTTP-only and delegates TLS to an external edge; previously no HSTS was emitted by web/SPA/gateway, and production origins were not required to be `https:`, so an `http://` value could silently downgrade transport security.
- **Original evidence (redacted):** [nginx.prod.conf](file:///Users/abdullahzaher/vibress/infrastructure/nginx/nginx.prod.conf#L23) had no HSTS, [nginx.spa.conf.template](file:///Users/abdullahzaher/vibress/docker/nginx.spa.conf.template#L12) had no HSTS, and the production guard accepted any origin scheme ([config/index.ts](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L387)).
- **Fix applied:**
  - `enforceProductionGuards` now rejects any production origin that is not `https:` — `SITE_URL`, `PORTAL_URL`, `API_URL`, and every CORS allowlist entry — listing the offending values in the startup error: [config/index.ts](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L425).
  - Web middleware sets `Strict-Transport-Security: max-age=300` and a restrictive `Permissions-Policy` on both normal and localized error responses: [middleware.ts](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L8), [#L209](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L209), [#L226](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L226).
  - The gateway and both SPA images emit the same staged HSTS and `Permissions-Policy`: [nginx.prod.conf](file:///Users/abdullahzaher/vibress/infrastructure/nginx/nginx.prod.conf#L28), [nginx.spa.conf.template](file:///Users/abdullahzaher/vibress/docker/nginx.spa.conf.template#L15).
  - API Helmet now uses the matching staged `maxAge: 300` instead of its 180-day default: [main.ts](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L180).
- **Test command / expected / observed:** `pnpm vitest run tests/integration/config.test.ts apps/web/src/__tests__/middleware.test.ts` → 26/26 passed, including rejection of `http://` `SITE_URL`, `PORTAL_URL`, `API_URL`, and a mixed CORS list, plus `Strict-Transport-Security: max-age=300` and restrictive `Permissions-Policy` on page responses. `pnpm vitest run apps/api` → 593/593 passed with `SITE_URL` set in production fixtures. `pnpm vitest run tests/integration tests/security` → 532/532 passed.
- **Residual risk:** The repository cannot enforce TLS at an external load balancer/CDN. `max-age=300` is deliberately short: raise it (e.g. `31536000; includeSubDomains`) only after confirming the edge always serves HTTPS and redirects HTTP. Browsers ignore HSTS received over plain HTTP. A local `compose.prod` rehearsal now needs HTTPS-form origins (or an internal TLS edge) to boot.
- **Approval required:** Yes for the edge deployment (TLS termination, HTTP→HTTPS redirect, HSTS ramp). The code/config change needs no further approval.

#### F-014 — Production guard accepted test-mode Stripe keys
- **Control:** 11 / 19
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** Medium (resolved). Only the literal `sk_test_missing` was rejected, so a real `sk_test_*` key could boot in production and silently accept test payments.
- **Original evidence (redacted):** The guard compared the secret key to `sk_test_missing` only and checked the webhook secret for presence ([config/index.ts](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L387)).
- **Fix applied:**
  - The production guard now requires `STRIPE_SECRET_KEY` to match `sk_live_` or `rk_live_`; any test-mode or malformed value aborts startup: [config/index.ts](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L402).
  - `STRIPE_WEBHOOK_SECRET` must be a `whsec_` signing secret: [config/index.ts](file:///Users/abdullahzaher/vibress/packages/config/src/index.ts#L412).
- **Test command / expected / observed:** `pnpm vitest run tests/integration/config.test.ts` → 9/9 passed, including rejection of `sk_test_real`, `rk_test_real`, `pk_test_real`, a non-`whsec_` webhook secret, and a clean boot with live-mode values. `pnpm vitest run apps/api/src/__tests__/api-hardening.test.ts apps/api/src/__tests__/auth-hardening.test.ts` → 20/20 passed.
- **Residual risk:** The guard checks key shape, not that the live key belongs to the intended account; rotate keys at the provider if a test key ever reached production. Publishable keys (`pk_*`) are not part of the server config.
- **Approval required:** None for the code change; confirm production secrets are live-mode before deployment.

#### F-007 — Missing Origin checks on several staff mutations
- **Control:** 16
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** Medium (resolved). Staff invite/resend/revoke, comment moderation, and What's New dismissal rely on session cookies without `validateOrigin`; `SameSite=Lax` blunts most cross-site POSTs, so this was defense in depth rather than a directly exploitable CSRF.
- **Original evidence (redacted):** The route blocks for invite, resend, revoke, the ten comment moderation/report routes, and `POST /whats-new/:id/dismiss` listed `requireStaffSession`/`requirePermission` only, unlike the rest of the staff surface.
- **Root cause:** Origin validation was added per-route and these handlers were missed; nothing detected new cookie mutations that lacked it.
- **Fix applied:**
  - `validateOrigin` is now the last entry in `preHandler` for staff invite, resend, and revoke: [admin.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L104), [#L277](file:///Users/abdullahzaher/vibress/apps/api/src/routes/admin.ts#L390).
  - All ten staff comment moderation/report mutations now validate Origin: [comments.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/comments.ts#L543).
  - Staff What's New dismissal validates Origin: [whats-new.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/whats-new.ts#L33).
  - New regression test statically enumerates every `fastify.get|post|put|patch|delete` route under `apps/api/src/routes`, selects those guarded by `requireStaffSession`/`requireMemberSession`, and fails if a mutation's route block omits the matching `validateOrigin`/`validateMemberOrigin`: [csrf-origin-coverage.test.ts](file:///Users/abdullahzaher/vibress/apps/api/src/__tests__/csrf-origin-coverage.test.ts#L17).
  - Existing tests now send the trusted Origin, and negative tests assert 403 `INVALID_ORIGIN` for an untrusted staff invite origin, an untrusted comment moderation origin, and a dismissal with no Origin.
- **Test command / expected / observed:** `pnpm vitest run apps/api` → 59 files / 593 tests passed (includes the 2 scanner tests and the three negative tests). `pnpm vitest run tests/integration tests/security` → 50 files / 532 tests passed. `pnpm --filter @vibress/api exec tsc --noEmit` → clean.
- **Residual risk:** The scanner uses a regex over route literals, so routes registered through a helper or `fastify.route({...})` are not enumerated; any such future route needs its own review. Browser clients send `Origin` automatically; non-browser cookie clients must send an allowlisted origin. GET requests are skipped by `validateOrigin` by design.
- **Approval required:** None for the code change. Confirm every admin/portal deployment origin is present in the staff/member CORS allowlist, or legitimate mutations will be rejected with 403.

#### F-008 — Password reset acceptance has no rate limit
- **Control:** 12
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** Medium (resolved). Unlimited reset submissions let anyone spend server CPU on Argon2 hashing; 256-bit tokens make guessing success infeasible.
- **Original evidence (redacted):** `POST /reset-password` had only `validateOrigin`, while `POST /forgot-password` was limited per client IP.
- **Root cause:** The limiter was applied to the request half of the flow but not the acceptance half.
- **Fix applied:** Reset acceptance now uses `@fastify/rate-limit` scoped to the route, 5 requests/minute per client IP in production (1000 in development), matching forgot-password: [auth.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/auth.ts#L449).
- **Test command / expected / observed:** `pnpm vitest run apps/api/src/__tests__/auth-hardening.test.ts` → passed, including "rate-limits password reset acceptance per client IP": five invalid-token submissions return 400, the sixth returns 429 `TOO_MANY_REQUESTS`. Full `pnpm vitest run apps/api` → 593/593 passed.
- **Residual risk:** The limit is per IP and shared by users behind NAT; the limiter depends on `TRUST_PROXY` being configured so `req.ip` reflects the client. Throttle state is per API instance unless the limiter store is shared, so horizontal scaling multiplies the effective budget.
- **Approval required:** None for the code change; confirm the proxy/trust configuration in production.

#### F-010 — Public site-privacy HMAC fallback; web container lacks the key
- **Control:** 02 / 11
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** Medium (resolved). The web tier verified private-site cookies with the literal `vibress-site-privacy-secret` when `VIBRESS_ENCRYPTION_KEY` was absent, and minted a v1 cookie with that same literal when the API's `Set-Cookie` was missing. Because the shipped compose file did not give `web` the key, legitimate API-signed cookies failed verification while the fallback secret was publicly known.
- **Original evidence (redacted):** [middleware.ts](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L316), [route.ts](file:///Users/abdullahzaher/vibress/apps/web/src/app/api/verify-site-password/route.ts#L41), [compose.prod.yml](file:///Users/abdullahzaher/vibress/compose.prod.yml#L172).
- **Root cause:** The verification key was optional with a shared fallback, and the web deployment was never wired to the API's key.
- **Fix applied:**
  - Web middleware now reads only `VIBRESS_ENCRYPTION_KEY` and returns false (redirect to `/private`) when it is absent; the public literal is gone: [middleware.ts](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L315).
  - `POST /api/verify-site-password` no longer signs its own cookie. It forwards the API's `Set-Cookie`; if the API reports success without one, it fails closed with 502 instead of minting a v1 token: [route.ts](file:///Users/abdullahzaher/vibress/apps/web/src/app/api/verify-site-password/route.ts#L37).
  - `web` now receives `VIBRESS_ENCRYPTION_KEY` in `compose.prod.yml`, and the setup-e2e compose passes the same fixture key: [compose.prod.yml](file:///Users/abdullahzaher/vibress/compose.prod.yml#L183), [compose.setup-e2e.yml](file:///Users/abdullahzaher/vibress/compose.setup-e2e.yml#L107).
  - Deployment docs note that the web tier needs the key and fails closed without it: [production.md](file:///Users/abdullahzaher/vibress/docs/12-infrastructure/production.md#L112).
- **Test command / expected / observed:** `pnpm vitest run apps/web/src/__tests__/middleware.test.ts apps/web/src/__tests__/verify-site-password-route.test.ts` → 22/22 passed, including "allows a v2 cookie signed with the shared key", "fails closed when the shared key is absent", "rejects a cookie signed with the former public fallback secret", and "fails closed instead of minting a cookie with a shared fallback secret". `pnpm --filter @vibress/web exec tsc --noEmit` → clean.
- **Residual risk:** The API still has a development-only literal default (`getSitePrivacySecret`/`content.ts`), but production boot refuses to start without a real key, so it cannot reach a deployment. A misconfigured deployment without the web key now locks private sites rather than accepting forged cookies; the browser access flow itself was not exercised end-to-end.
- **Approval required:** None for the code change. Confirm `VIBRESS_ENCRYPTION_KEY` is present in the `web` environment at deployment and reflects the same value as `api`.

#### F-006 — `GET /members/auth/verify` creates a session without Origin validation
- **Control:** 16
- **Status:** `fixed_verified` (2026-11-13)
- **Severity / rationale:** Medium (resolved). A cross-site GET navigation with a valid magic-link token consumed the token, set the member session cookie, and logged the victim into the token owner's account (login CSRF); the token also leaked into URL/Referer logs.
- **Original evidence (redacted):** `GET /members/auth/verify` duplicated the POST handler's throttle/verify/`setCookie` logic with no Origin guard ([members.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/members.ts#L199)).
- **Root cause:** The GET route was a "browser navigation convenience" predating the portal verify page; `validateMemberOrigin` skips GET by design and only applies when a member cookie already exists, so no guard could protect this path.
- **Fix applied:**
  - Removed the GET handler entirely. Magic-link tokens are consumed only by `POST /auth/verify`, which is rate-limited and reachable from browser clients only via a JSON request subject to CORS preflight: [members.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/members.ts#L107), [#L199](file:///Users/abdullahzaher/vibress/apps/api/src/routes/members.ts#L199).
  - The emailed link already targets `{portalBase}/portal/auth/verify?token=...`, whose page submits the token through `memberApi.verifyToken` (POST), so no client depended on the GET route: [member-auth-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/members/src/application/member-auth-service.ts#L262), [VerifyPage.tsx](file:///Users/abdullahzaher/vibress/apps/portal/src/pages/VerifyPage.tsx#L52).
  - Regression test: a cross-site GET with a fresh valid token returns 404 with no `Set-Cookie`, and a subsequent POST with the same token succeeds, proving the token was not consumed: [member-auth-api.test.ts](file:///Users/abdullahzaher/vibress/apps/api/src/__tests__/member-auth-api.test.ts#L130).
  - Docs now state verification is POST-only: [member-api.md](file:///Users/abdullahzaher/vibress/docs/10-api/member-api.md#L46), [member-authentication.md](file:///Users/abdullahzaher/vibress/docs/06-security/member-authentication.md#L48).
- **Test command / expected / observed:** `pnpm vitest run apps/api/src/__tests__/member-auth-api.test.ts apps/api/src/__tests__/csrf-origin-coverage.test.ts` → 12/12 passed, including "does not create a session from a cross-site GET to the verify endpoint" (GET 404, no cookie; POST 200). Full `pnpm vitest run apps/api` → 59 files / 594 tests passed. `pnpm --filter @vibress/api exec tsc --noEmit` → clean.
- **Residual risk:** `validateMemberOrigin` does not challenge an unauthenticated cross-site POST, so the POST path relies on the JSON `Content-Type` requiring a CORS preflight that the allowlist blocks; keep that content-type requirement and CORS policy intact. Tokens may still appear in mail-provider or proxy logs for the portal URL and should be treated as sensitive until expiry.
- **Approval required:** None for the code change. Any external integration that relied on the removed GET endpoint must switch to the portal verify page or `POST /auth/verify`.

#### F-012 — Database access uses the PostgreSQL owner role; no RLS
- **Control:** 03
- **Status:** `fixed_verified` (2026-11-13) for role separation; RLS evaluated and deferred (see residual risk)
- **Severity / rationale:** Medium (role separation resolved). `api`/`worker` connected as the database owner, so the application principal could `DROP`/`ALTER` every table and would bypass any future RLS; tenant isolation was entirely application-level.
- **Original evidence (redacted):** [compose.prod.yml](file:///Users/abdullahzaher/vibress/compose.prod.yml#L86) reused `POSTGRES_USER` for API/worker/migrate; no `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY` existed in `packages/database/migrations`.
- **Root cause:** A single credential was used both to apply schema migrations and to serve requests, so runtime and DDL privileges were identical.
- **Fix applied:**
  - A new provisioning step creates or refreshes a least-privilege runtime role (`POSTGRES_APP_USER`, default `vibress_app`): login-only, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS` ([runtime-role.ts](file:///Users/abdullahzaher/vibress/packages/database/src/runtime-role.ts#L33)).
  - It grants `CONNECT`, schema `USAGE`, DML on all current and future tables, sequence `USAGE/SELECT`, function `EXECUTE`, and schema `CREATE` (required because the runtime provisions operator-approved plugin storage tables on demand). Core tables stay owned by the migration role, so the runtime cannot `ALTER`, `DROP`, or `TRUNCATE` them.
  - The migrate entrypoint runs provisioning after migrations, idempotently, and fails closed on error ([migrate.ts](file:///Users/abdullahzaher/vibress/packages/database/src/migrate.ts#L36)); it is skipped when `POSTGRES_APP_PASSWORD` is unset (local tests/dev).
  - `compose.prod.yml` gives `api`/`worker` a `DATABASE_URL` for the runtime role while the one-shot `migrate` service keeps the owner URL ([compose.prod.yml](file:///Users/abdullahzaher/vibress/compose.prod.yml#L88), [#L171](file:///Users/abdullahzaher/vibress/compose.prod.yml#L171)). `env.prod.example`, deployment docs ([production.md](file:///Users/abdullahzaher/vibress/docs/12-infrastructure/production.md#L117)), drill fixtures, and the deploy preflight were updated.
  - Regression test provisions a throwaway role, connects as it, and asserts no superuser/createdb/createrole, DML allowed, `TRUNCATE` denied, core `DROP` denied (42501), and plugin-style `CREATE`/`DROP` allowed; config parsing, invalid-role-name rejection, and the refusal to provision the migration/owner role are covered too ([runtime-role.test.ts](file:///Users/abdullahzaher/vibress/packages/database/src/__tests__/runtime-role.test.ts#L64)).
- **Test command / expected / observed:** `pnpm vitest run packages/database` → 20 files / 59 tests passed (including the 8 runtime-role tests). `pnpm --filter @vibress/database exec tsc --noEmit` → clean. Migrate entrypoint run against the local dev DB provisioned `vibress_app_verify`; a connection as that role read `publications`, created/dropped a probe table, and `DROP TABLE publications` failed with `42501`. The verification role was removed afterwards. `docker compose -f compose.prod.yml config` renders the app role for `api`/`worker` and the owner for `migrate`. Full API 594/594; integration/security 532/532.
- **Residual risk:** RLS is still not enabled. Enabling it requires a per-request tenant context (including workers, public-site requests, and cross-publication platform operations); doing it blind would break legitimate flows. Until then, cross-tenant reads depend on application-level scoping and its test suites, and the runtime role can still run DML on any tenant's rows. The runtime also holds schema `CREATE` for plugin storage, so it can create/drop its own tables; that is required by design. Existing deployments must add `POSTGRES_APP_PASSWORD`; managed PostgreSQL owners that cannot create roles need the role pre-created by a superuser.
- **Approval required:** None for the code change. Approve a future RLS project if defense-in-depth tenant isolation is required before launch; confirm every deployment adds the runtime-role credentials and that the migrate job completes before API/worker start.

#### F-013 — Rate limiter is per-process and several expensive routes are unprotected
- **Control:** 12
- **Severity / rationale:** Medium. Limits reset on restart and are not shared across replicas; uploads, imports/exports, theme ZIP, and invitation acceptance have no limiter. Reset acceptance is now limited (F-008), but the shared-store gap remains.
- **Evidence:** [main.ts:163](file:///Users/abdullahzaher/vibress/apps/api/src/main.ts#L163) registers `@fastify/rate-limit` without a Redis store; [media.ts:28](file:///Users/abdullahzaher/vibress/apps/api/src/routes/media.ts#L28), [themes.ts:120](file:///Users/abdullahzaher/vibress/apps/api/src/routes/themes.ts#L120), [operations.ts:604](file:///Users/abdullahzaher/vibress/apps/api/src/routes/operations.ts#L604).
- **Proposed fix:** Use a Redis store and add limits to expensive/abuse-prone routes.
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

#### F-019 — `Permissions-Policy` was only set on one iframe route
- **Control:** 14
- **Status:** `fixed_verified` (2026-11-13)
- **Original severity:** Low. Only one iframe route set it ([extension-admin-iframe.ts:226](file:///Users/abdullahzaher/vibress/apps/api/src/routes/extension-admin-iframe.ts#L226)).
- **Fix applied:** Web middleware, the gateway, both SPA images, and the API (Helmet) now emit a restrictive policy denying camera, microphone, geolocation, USB, and payment ([middleware.ts](file:///Users/abdullahzaher/vibress/apps/web/src/middleware.ts#L9), [nginx.prod.conf](file:///Users/abdullahzaher/vibress/infrastructure/nginx/nginx.prod.conf#L29)). Verified by the middleware header assertions (20/20).

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

Remediation was explicitly authorized for F-001–F-005, F-007–F-011, and F-014.

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

**F-011 — HTTPS origins, staged HSTS, and Permissions-Policy**
- `packages/config/src/index.ts`
- `apps/web/src/middleware.ts`
- `apps/api/src/main.ts`
- `infrastructure/nginx/nginx.prod.conf`
- `docker/nginx.spa.conf.template`
- Tests: `tests/integration/config.test.ts`, `apps/web/src/__tests__/middleware.test.ts`, `apps/api/src/__tests__/api-hardening.test.ts`, `apps/api/src/__tests__/auth-hardening.test.ts`

**F-014 — reject test-mode Stripe keys in production**
- `packages/config/src/index.ts`
- Tests: `tests/integration/config.test.ts`

**F-007 — Origin validation on cookie-authenticated staff mutations**
- `apps/api/src/routes/admin.ts`
- `apps/api/src/routes/comments.ts`
- `apps/api/src/routes/whats-new.ts`
- Tests: `apps/api/src/__tests__/csrf-origin-coverage.test.ts` (new),
  `apps/api/src/__tests__/staff-auth-lifecycle.test.ts`,
  `apps/api/src/__tests__/comments-closure-gates.test.ts`,
  `apps/api/src/__tests__/whats-new-api.test.ts` (existing requests updated to
  send a trusted Origin)

**F-008 — rate-limit password reset acceptance**
- `apps/api/src/routes/auth.ts`
- Tests: `apps/api/src/__tests__/auth-hardening.test.ts`

**F-010 — shared private-site HMAC key, fail closed**
- `apps/web/src/middleware.ts`
- `apps/web/src/app/api/verify-site-password/route.ts`
- `compose.prod.yml`
- `compose.setup-e2e.yml`
- `docs/12-infrastructure/production.md`
- Tests: `apps/web/src/__tests__/middleware.test.ts`,
  `apps/web/src/__tests__/verify-site-password-route.test.ts` (new)

**Fixture update for the fail-closed tenant context:** `tests/integration/translations-management.test.ts` now creates an explicit `pub_default` membership for its fixture users, because other suites truncate `users` and cascade the membership away.

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
| `pnpm vitest run apps/api` | local + dev DB | 59 files / 594 tests passed | pass | Full API unit/integration suite; includes newsletters, staff lifecycle, RBAC, upload security, and the cross-site GET verify regression |
| `pnpm vitest run apps/api/src/__tests__/member-auth-api.test.ts apps/api/src/__tests__/csrf-origin-coverage.test.ts` | local + dev DB | 2 files / 12 tests passed | pass | F-006: cross-site GET verify returns 404 without `Set-Cookie`; same token then verifies via POST |
| `pnpm exec eslint apps/api/src/routes/members.ts apps/api/src/__tests__/member-auth-api.test.ts` | local | exit 0 | pass | No findings on changed files |
| `pnpm vitest run packages/database` | local + dev DB | 20 files / 59 tests passed | pass | F-012 runtime role: config parsing, non-superuser, DML allowed, TRUNCATE/DROP denied, plugin-style DDL allowed, owner-role guard rejects self-provisioning; throwaway role removed |
| `pnpm --filter @vibress/database run db:migrate` with `POSTGRES_APP_*` | local + dev DB | migrator exit 0; "Runtime role \"vibress_app_verify\" provisioned" | pass | Exercise of the real migrate entrypoint; verification role dropped afterwards |
| `docker compose -f compose.prod.yml config` (fixture env) | local | renders app role URL for `api`/`worker`, owner URL for `migrate` | pass | No secrets printed |
| `bash -n` deploy/drill scripts; `pnpm --filter @vibress/database exec tsc --noEmit` | local | exit 0 | pass | Preflight placeholder check and role-module typecheck |
| `pnpm vitest run apps/api/src/__tests__/staff-auth-lifecycle.test.ts` | local + dev DB | 1 file / 22 tests passed | pass | Includes F-004 directory/role isolation and cleanup |
| `pnpm vitest run apps/api/src/__tests__/newsletters-api.test.ts` | local + dev DB | 1 file / 26 tests passed | pass | Includes F-005 suppression scope and delete isolation |
| `pnpm vitest run apps/api/src/__tests__/media-upload-security.test.ts` | local + dev DB | 1 file / 18 tests passed | pass | Includes F-009 size ceilings, MIME mismatch, fail-closed provider |
| `pnpm vitest run packages/domains/newsletters` | local + dev DB | 2 files / 18 tests passed | pass | Includes send publication isolation |
| `pnpm vitest run packages/domains/email` | local + dev DB | 12 tests passed | pass | Includes publication-attributed webhook suppressions |
| `pnpm vitest run tests/integration/analytics.test.ts packages/database` | local + dev DB | 21 files / 72 tests passed | pass | Tenant-scoped analytics authorization and migration journal ordering (includes CI failure fixes) |
| `pnpm vitest run tests/integration/runtime-multi-publication-isolation.test.ts` | local + dev DB | 1 file / 45 tests passed | pass | End-to-end multi-publication isolation |
| `pnpm vitest run tests/security/auth-api.test.ts` | local + dev DB | 1 file / 6 tests passed | pass | Auth/authorization API security |
| `pnpm vitest run tests/integration/config.test.ts apps/web/src/__tests__/middleware.test.ts` | local | 2 files / 29 tests passed | pass | F-014 test/live/malformed key modes and webhook shape; F-011 non-HTTPS origins rejected; HSTS/Permissions-Policy assertions; F-010 shared-key accept/deny |
| `pnpm vitest run apps/web/src/__tests__/middleware.test.ts apps/web/src/__tests__/verify-site-password-route.test.ts` | local | 2 files / 22 tests passed | pass | Private-site cookie signed with the shared key allowed; missing key and former fallback secret rejected; API Set-Cookie forwarded; missing Set-Cookie fails closed with 502 |
| `pnpm vitest run apps/api/src/__tests__/api-hardening.test.ts apps/api/src/__tests__/auth-hardening.test.ts` | local + dev DB | 2 files / 20 tests passed | pass | Production fixtures boot with `SITE_URL` and live-mode keys; reset acceptance returns 429 after 5 submissions |
| `pnpm vitest run` on the six F-007/F-008 suites (`csrf-origin-coverage`, `staff-auth-lifecycle`, `comments-closure-gates`, `whats-new-api`, `api-hardening`, `auth-hardening`) | local + dev DB | 6 files / 66 tests passed | pass | Scanner coverage, three untrusted/no-Origin 403 tests, reset 429 |
| `pnpm vitest run tests/integration tests/security` | local + dev DB | 50 files / 532 tests passed | pass | Includes the translations fixture membership fix |
| `pnpm --filter @vibress/config exec tsc --noEmit` and `@vibress/web`, `@vibress/api` | local | exit 0 | pass | Config guard, middleware headers, Helmet option |
| `pnpm -r --filter @vibress/database --filter @vibress/email --filter @vibress/newsletters --filter @vibress/api --filter @vibress/worker --filter @vibress/admin typecheck` | local | exit 0 | pass | Affected packages only |
| `pnpm db:migrate` + psql invariant checks | local Docker staging rehearsal | migrator exit 0; 54 migrations; 0 null/mismatched `newsletter_sends.publication_id`; both columns, FKs, and all suppression indexes present | pass | Re-ran migrator as no-op after 0052/0053; no external target contacted |
| Full monorepo `pnpm vitest run`, E2E, Playwright | not run | — | not_verified | Time/environment; CI runs these |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | not run | — | not_verified | CI covers them |
| Staging/public HTTP, TLS/HSTS checks | not run | — | not_verified | No authorized external target |

## Approvals and Manual Actions

- [x] F-001, F-002, F-003, F-004, F-005, F-006, F-007, F-008, F-009, F-010,
  F-011, F-012, and F-014 remediated and covered by negative isolation/
  authorization/config/CSRF/rate/private-site/verify-flow/privilege tests
  (authorized 2026-11-13). F-011's edge TLS/redirect and HSTS ramp remain
  deployment actions.
- [x] Applied and verified migrations `0052_newsletter_sends_publication_scope`
  and `0053_email_suppressions_publication_scope` in the local Docker staging
  rehearsal (2026-11-13).
- [ ] Apply the same migrations to the external staging then production
  deployment; verify backfills and drain in-flight send jobs during the cutover.
- [ ] Grant explicit publication memberships to any operator who previously
  relied on implicit `pub_default` access.
- [ ] Decide whether historical global suppressions should be re-scoped to a
  publication (they remain global after migration).
- [ ] Confirm every configured storage provider supports signed range reads or
  `getObjectBuffer`, otherwise uploads fail closed.
- [x] Staff-mutation Origin rollout (F-007) applied and enforced by a
  route-scanner test.
- [x] Member magic-link verification made POST-only; the unguarded GET handler
  is removed and a cross-site GET regression test is in place (F-006).
- [x] Reset-acceptance rate limit (F-008) applied.
- [x] Private-site HMAC fallback removed and `web` wired to the shared key
  (F-010).
- [ ] Approve the remaining rate limits (invitation acceptance, uploads,
  exports, theme ZIP) and a Redis-backed store (F-013).
- [ ] Approve a per-publication storage quota (F-020).
- [ ] Verify edge TLS termination, HTTP→HTTPS redirect, and the emitted HSTS
  value in staging; then raise `max-age` and consider `includeSubDomains`.
- [ ] Confirm production `SITE_URL`, `PORTAL_URL`, `API_URL`, and CORS origins
  are `https:` and the Stripe secret is live-mode (`sk_live_`/`rk_live_`) with a
  `whsec_` webhook secret before deployment.
- [ ] Confirm `VIBRESS_ENCRYPTION_KEY` is present in the `web` environment and
  matches the API value (private-site access locks out if it is missing).
- [x] Least-privilege runtime role added (F-012): migrate provisions it and
  `api`/`worker` use it instead of the owner.
- [ ] Add `POSTGRES_APP_USER`/`POSTGRES_APP_PASSWORD` to each deployment `.env`
  and confirm the migrate job completes before API/worker start.
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
- RLS is not enabled. The runtime role cannot alter or drop core tables, but it
  can read and write every tenant's rows; database-level tenant isolation would
  require a per-request tenant context across the API, workers, and public-site
  flows. This was evaluated and deferred.
- The compose/prod runtime-role path was exercised with rendered config and a
  local provision/probe, not a full container boot; confirm it in staging.
- An independent professional penetration test is advisable before a
  multi-tenant production launch, especially for billing, plugins, collaboration
  WebSockets, and media delivery.
