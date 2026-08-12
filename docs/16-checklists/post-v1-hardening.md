# Post-v1 Hardening Checklist

Live status tracker for the hardening program. Baseline captured from commit
`880366f` (branch `hardening/post-v1-reliability`).

## Baseline inventory

- Git commit SHA: `880366f fix(tests): resolve 403 failures from test isolation and ownership seeding`
- `pnpm audit --prod`: no known vulnerabilities
- Migrations: 16 in `packages/database/migrations`
  - combined SHA-1 of per-migration checksums: `76c14aabab69bd49a354d85ae3a9446db7b8b4c5`
- Direct `process.env` references (TS): 123
- Explicit `any` references (TS/TSX): 421
- Placeholder packages (1-line `index.ts`): config, queue, observability, testing, plugin-core, ui, i18n, domains/files
- No `.transaction(` / `BEGIN` / `COMMIT` / `ROLLBACK` usage in runtime source
- No outbox implementation

### Pre-modification gates (run on `880366f`)

- Typecheck: PASS
- Lint: PASS (35 pre-existing warnings, 0 errors)
- Unit/integration (`pnpm -r test`): FAILS at `@vibress/storage-s3` only —
  pre-existing vitest issue. Root `vitest.config.ts` resolves `./tests/global-setup.ts`
  relative to the package cwd (`packages/storage-s3/tests/global-setup.ts` does
  not exist) plus Vitest 4 `poolOptions` deprecation. Not caused by hardening.
- Test inventory: 58 unit test files, 20 E2E specs, `tests/integration` and
  `tests/security` suites present.
- Engine pins: no `packageManager`, no `engines` in root `package.json`
  (Node v24.16.0, pnpm 11.17.0 observed).
- Generated artifacts tracked in Git: `*.tsbuildinfo` (5), `server*.log` (2),
  `vite.config.js` (2), `packages/storage-s3/src/*.js` + `*.js.map` (12).

### Dependency graph

- `graph.json` exists at repo root; regenerate with Nx after structural changes.

## H0 — Safety branch & architecture lock

- [x] Branch `hardening/post-v1-reliability` created from verified v1 commit
- [x] Full current gates run before first modification (see baseline above)
- [x] Baseline recorded in this file
- [x] `docs/14-decisions/post-v1-hardening-scope.md` added
- [x] Feature additions frozen until P0 complete
- [ ] Link hardening scope from documentation index

## H1 — Database transactions & unit-of-work infrastructure

Status: complete

- [x] TransactionRunner exists in `@vibress/database`
- [x] Repository infrastructure participates in transaction context
- [x] Posts workflows atomic (create/update/publish/unpublish/schedule/cancel/restore/delete)
- [x] Pages workflows atomic
- [x] Author/tag relation setters atomic
- [x] Media reference replacement atomic
- [x] Failure injection proves rollback
- [x] No Drizzle transaction type leaks into public domain API
- [x] Documentation updated (ADR-012)

Design: `runInTransaction()` + AsyncLocalStorage transaction context in
`packages/database/src/transaction/`. `getDb()` returns the transaction-scoped
executor while inside a transaction, so all existing repositories participate
automatically. Nested `run()` reuses the current transaction (no savepoints).

Failure-injection coverage: audit/revision/tag/media insert failures during
post and page creation, publish revision failure, media failure during update,
FK failure during author replacement. 12 tests in
`tests/integration/transactions.test.ts` (all pass).

H1B coverage added transactional wrappers for the remaining multi-write domain
workflows: storage configuration create/update/activate/delete, settings
update, comment creation, member disable, magic-link session creation,
newsletter send start, billing webhook processing, and free-plan checkout.

## H2 — Transactional outbox

Status: complete

- [x] Outbox migration exists
- [x] Important events written inside business transactions
- [x] Dispatcher exists (SKIP LOCKED)
- [x] Redis outage recovery tested
- [x] Duplicate delivery tested
- [x] Consumers idempotent
- [x] Event types strongly typed

Design: `outbox_events` stores versioned envelopes in `payload` and uses
`pending -> delivering -> published` for successful delivery, with `failed` as
the terminal retry-exhausted state. `delivering` is a transient claim marker;
stale claims are reclaimed. `EVENT_DELIVERY_MODE=outbox` is the default and
uses the worker dispatcher. `EVENT_DELIVERY_MODE=direct` keeps the legacy
in-process API search relay for local fallback.

Coverage: `tests/integration/outbox.test.ts` verifies transaction rollback,
worker-down pending persistence, SKIP LOCKED claim exclusivity, stale claim
recovery, retry/backoff after relay failure, max-attempt failure, duplicate
delivery tolerance, retention cleanup, and envelope typing/validation.

## H3 — Typed configuration

Status: complete

- [x] `@vibress/config` real, Zod schemas
- [x] Direct runtime env access reduced to zero outside approved files
- [x] Production secrets fail closed
- [x] CORS deployment-configurable
- [x] `.env.example` documents config

Design: `@vibress/config` is the approved runtime env boundary for server
packages/apps. It parses environment with Zod, derives normalized URLs/origin
sets, and throws `ConfigError` for invalid production secrets or missing
production CORS origins. Direct `process.env` reads remain only in approved
surfaces: the config package, tests that intentionally mutate env, build/tool
configs, scripts, and frontend build-time/runtime surfaces.

Coverage: `tests/integration/config.test.ts` verifies development defaults,
production fail-closed secret/origin validation, explicit production origins,
and invalid URL / delivery-mode rejection.

## H4 — API error/CORS/headers

Status: complete

- [x] 5xx message leakage test
- [x] Dynamic origins test
- [x] Production header snapshot tests

Design: the central Fastify error handler preserves explicit 4xx/domain error
messages but returns generic `INTERNAL_ERROR` / `Internal Server Error` for
production 5xx responses. CORS uses `@vibress/config` origin lists, and Helmet
security headers remain enabled globally with CSP intentionally disabled until a
theme-safe policy is designed.

Coverage: `apps/api/src/__tests__/api-hardening.test.ts` verifies production
5xx non-leakage, 4xx message preservation, configured/unknown production CORS
origins, and security header snapshots.

## H5 — SSRF correctness

Status: complete

- [x] False-positive regex removed (`packages/security/src/http/safe-fetch.ts:29`)
- [x] Reserved ranges accurately covered
- [x] SSRF tests expanded

Design: `isPrivateIP` in `packages/security/src/http/safe-fetch.ts` was refactored
to eliminate false positives on public IP ranges (such as DoD/Akamai `22.x` and `23.x`)
while strictly blocking IPv4 loopback (`127.0.0.0/8`), private (`10.0.0.0/8`, `172.16.0.0/12`,
`192.168.0.0/16`), link-local/cloud-metadata (`169.254.0.0/16`), CGNAT (`100.64.0.0/10`),
multicast/reserved (`>= 224.0.0.0`), IPv6 loopback (`::1`), link-local (`fe80::/10`),
unique-local (`fc00::/7`), multicast (`ff00::/8`), and IPv4-mapped IPv6 formats.

Coverage: `packages/security/src/__tests__/safe-fetch.test.ts` (14 unit tests).

## H6 — Local media streaming

Status: complete

- [x] No whole-file `readFile` for large local media delivery
- [x] Audio/video Range requests work
- [x] Memory stays bounded

Design: the manual local media delivery route `/content/media/*` in `apps/api/src/main.ts`
was upgraded from whole-file `fs.promises.readFile` to stream-based `fs.createReadStream`.
HTTP `Range` headers (`bytes=start-end`, `bytes=start-`, `bytes=-suffix`) return `206 Partial Content`
with `Content-Range`, `Content-Length`, `Accept-Ranges: bytes`, and MIME type headers, keeping Node.js
memory usage bounded regardless of file size. Invalid ranges return `416 Range Not Satisfiable`.

Coverage: `apps/api/src/__tests__/media-upload.test.ts` (Range streaming & 206/416 tests).

## H7 — Platform packages

Status: complete

- [x] config implemented (H3)
- [x] queue implemented
- [x] observability implemented
- [x] testing implemented
- [x] plugin-core implemented
- [x] ui minimal implemented
- [x] i18n decision made
- [x] files domain removed/merged

Design: all 1-line placeholder platform packages have been replaced with typed implementations:
- `@vibress/config`: Zod env validation & production guards (H3)
- `@vibress/queue`: BullMQ constants (`QUEUE_NAMES`), payload interfaces, and typed `createTypedQueue` / `createTypedWorker` helpers
- `@vibress/observability`: AsyncLocalStorage request tracing (`setRequestTraceContext`), structured JSON `Logger` with redaction, and `metrics` registry
- `@vibress/testing`: Shared test entity factories (`createMockUser`, `createMockPost`, `createMockMember`), `truncateAllTestTables`, and `withMockEnv`
- `@vibress/plugin-core`: `VibressPlugin`, `PluginManifest` schema validation, and lifecycle contract
- `@vibress/ui`: Classname joiner `cn(...)` and `designTokens` (colors, typography, spacing, radii)
- `@vibress/i18n`: Lightweight `Translator` with locale fallback & template interpolation
- `@vibress/files`: Domain placeholder consolidated into `@vibress/media` & `@vibress/storage-core`

Coverage: `tests/integration/platform-packages.test.ts` (12 integration tests).

## H8 — Type safety

Status: complete

- [x] Structured error classes
- [x] No `(err as any).code` in core domains
- [x] Typed events/jobs
- [x] Explicit-any count < 100 in core domain logic

Design: domain error classes (`PostDomainError`, `PageDomainError`, `UserDomainError`,
`AuthDomainError`, `RoleDomainError`, `TagDomainError`) were added across core domains
and substituted for all dynamic `(err as any).code = ...` error mutations. Route handlers
in `apps/api/src/routes/` and application services use typed `catch (err: unknown)` blocks
with `instanceof` checks. Event payloads in `@vibress/events` and queue payloads in `@vibress/queue`
are strongly typed.

Coverage: 62 integration tests and full API route test suite pass.

## H9 — Maintainability

Status: complete

- [x] `apps/admin/src/lib/api.ts` split
- [x] Large settings components split
- [x] `apps/api/src/main.ts` split
- [x] Cycle count reduced

Design: `apps/admin/src/lib/api.ts` (944 lines) was split into a
`lib/api/` directory of domain modules (client, media, storage, themes,
members, billing, newsletters, comments, recommendations, platform,
intelligence, operations) with a barrel `index.ts` re-exporting the same
named exports, so all existing component imports are unchanged. Large
settings components were split into per-tab panels under
`components/{billing,platform,operations,community,newsletters,intelligence}/`;
panels stay mounted with CSS `hidden` toggling so form state survives tab
switches: BillingSettings (474→139), PlatformSettings (450→143),
OperationsSettings (414→147), NewslettersSettings (393→122),
CommunitySettings (392→122), IntelligenceSettings (334→131). The
`apps/api/src/main.ts` media-stream and health handlers were extracted into
`routes/media-stream.ts` and `routes/health.ts` (404→231 lines). Import
cycles were eliminated: `packages/database` gained `connection.ts`
(`getDbPool`/`getDb`/`closeDbPool`) so `migrate.ts`, `seed.ts`, and
`transaction-runner.ts` no longer import the package barrel, and
`NativeImportProcessor`/`NativeExportCollector` now receive
`settingsService`/`redirectsService` via constructor injection instead of
importing `services.ts`. madge reports 0 circular dependencies across the
workspace source tree.

Coverage: full API route suite (187 tests), transactions (12), outbox (13),
config (4), and platform-packages (12) integration suites pass.

## H10 — Repository hygiene

Status: complete

- [x] Generated artifacts removed from source
- [x] `packageManager` + `engines` pinned
- [x] Build leaves clean Git tree
- [x] CI detects generated pollution

Design: 21 generated artifacts (5 `*.tsbuildinfo`, 2 `server*.log`,
2 `vite.config.js`, 12 `packages/storage-s3` build-emitted `.js`/`.js.map`
plus 6 `.d.ts`) were removed from Git tracking and covered by `.gitignore`
(`*.tsbuildinfo`, `*.js.map`, `server*.log`, `vite.config.js`, and
storage-s3 source-emission patterns). Root `package.json` now pins
`packageManager: pnpm@11.17.0` and `engines` (node `>=24 <25`, pnpm
`>=11.17.0`). `scripts/verify-clean-tree.mjs` fails when
`git status --porcelain` reports a dirty tree; CI runs it after `pnpm build`
so any tool writing artifacts into tracked locations breaks the build.
Verified: `pnpm build` regenerates the previously-tracked artifacts on disk
but they are all ignored, leaving `git status` free of generated pollution.

## H11 — Production deployment

Status: complete

- [x] Production Dockerfiles exist
- [x] Non-root containers
- [x] Private DB/Redis network
- [x] Container scan passes

Design: five Dockerfiles under `docker/` (api, worker, web, spa, gateway)
build from the repo root with pnpm 11.17.0 on node:24-alpine and multi-stage
layers (install → build → minimal non-root runtime). Node runtimes run as
`USER node` (uid 1000); admin/portal/gateway use nginx-unprivileged (uid
101); postgres/redis run their built-in non-root users. `compose.prod.yml`
defines two networks: `frontend` (gateway + apps) and `backend`
(`internal: true` — postgres/redis attach only to it and publish no host
ports; the only exposed port in the stack is the gateway's host `7777`).
The gateway (`infrastructure/nginx/nginx.prod.conf`) routes `/`,
`/admin/`, `/portal/`, `/api/` (+ exact `/api`, `/health/live`,
`/health/ready`), `/content/media/`, `/worker-health/` (prefix-stripped),
and `/metrics` (restricted to RFC1918 + loopback). A one-shot `migrate`
service (reuses the API image, `backend`-only, `restart: "no"`) runs
drizzle migrations; `pnpm prod:up` / `prod:migrate` / `bootstrap:owner`
are the first-boot sequence (see `docs/12-infrastructure/production.md`).
The `container-scan` CI job builds the api/worker images with GHA layer
cache and runs Trivy with `exit-code 1` on HIGH/CRITICAL,
`ignore-unfixed: true`.

Verified: local `compose.prod.yml` full-stack boot — all 8 services
healthy; gateway round trips to web (Next standalone), both SPAs, API
(login returns structured errors against a fresh database — proving the
plumbing), health probes, and Prometheus `/metrics`. Containers confirmed
non-root (`id -u` → 1000/101). Swept: standalone output mirrors the
monorepo path (`.next/standalone/apps/web/server.js`), and workspace
TypeScript sources require tsx at runtime (`start` scripts → `tsx
src/main.ts`; `node dist/main.js` cannot resolve `main: src/index.ts`
directory imports — pre-existing, now documented in production.md).

## H12 — Observability

Status: complete

- [x] Central logger
- [x] Metrics endpoint
- [x] Optional tracing
- [x] Runbooks updated

Design: `@vibress/observability` is now the single log pathway for API and
worker. Fastify runs with `logger: false`; `apps/api/src/observability.ts`
provides `appLogger` (JSON-structured, redacted, requestId+traceId) plus
trace/response hooks and the metrics route; the worker logs every
start/stop/failure through `createLogger('worker')`. `GET /metrics`
(API:7780 and worker health:7782, gated by `METRICS_ENABLED`, Prometheus
text format via `exportMetricsText()`) exposes `http_requests_total`
(route-template paths, status classes), `http_errors_total`,
`nodejs_process_*` gauges, and 1 s-sampled event-loop lag. Tracing is
optional via `TRACING_ENABLED`: when on, an AsyncLocalStorage context
(requestId, W3C `traceparent` traceId, method, path, ip) is attached per
request; when off, no context is set. `METRICS_ENABLED`/`TRACING_ENABLED`
were added to `@vibress/config`.

Coverage: API hardening suite gained metrics-on/metrics-off tests;
`platform-packages` covers the Prometheus exporter (type headers, label
escaping, process gauges); config tests cover the new observability flags.
Gates: API 176 tests + integration suites pass, typecheck 68/68, lint
clean. `docs/12-infrastructure/observability.md` documents the log format,
metric series, and traceparent propagation; `production.md` records the
deployment topology.

## H13 — UI/i18n

Status: complete

- [x] Accessibility debt fixed
- [x] i18n decision implemented

Design: accessibility fixes across the web themes and admin:

- `SubscribeModal` backdrop click-close is now a real `<button>` with
  `aria-label` (previously a clickable `<div>`); dialog is labelled via
  `aria-labelledby`; the close button receives initial focus; Escape plus
  the explicit close button still work. A new `.subscribe-modal-backdrop-hit`
  CSS class keeps the visual layout unchanged.
- Missing `type="button"` added to interactive buttons in the default and
  molten theme headers.
- Admin: the bare `✕` close button in `MediaPicker` gained `aria-label`
  and `type`; search input and type filter select gained `aria-label`;
  `PostEditor`/`PageEditor` title textareas gained `aria-label`;
  icon-only sidebar buttons (theme toggle, sign out, dismiss banner) gained
  `aria-label` alongside their `title` tooltips.

i18n implementation: `@vibress/i18n` `Translator` gained a default `locale`
option and `setLocale()`/`getLocale()` so dictionaries can be scoped to a
runtime locale with `fallbackLocale` fallback. A new `apps/web/src/lib/i18n.ts`
module ships the web `en` dictionary (41 keys covering navigation, subscribe
modal/form, feed, pagination, archives, share) and a `t()` helper backed by
`SITE_LOCALE` (default `en`). All 14 theme components now resolve user-facing
strings through `t()` (interpolated pagination/read-time templates), and
hardcoded `en-US`/`en-GB` date formatting in 10 components now uses
`site.locale`. Unused `themeSetting`/placeholder strings removed where
replaced.

Coverage: `tests/integration/web-i18n.test.ts` (5 tests: dictionary key
coverage, resolution, interpolation, non-English fallback, `SITE_LOCALE`
default) plus 3 new `@vibress/i18n` cases in `platform-packages.test.ts`.

## H14 — License/docs

Status: complete

- [x] License decision complete
- [x] Docs match code

Design: license decision is MIT.

- Added root `LICENSE` (MIT, Copyright (c) 2026 Vibress) and a README
  "License" section; added `"license": "MIT"` to the root and all 35
  app/package `package.json` files.
- Docs alignment: `docs/manifest.json` refreshed (document_count 97, full
  decisions list including ADR-012 and all boundary decision docs);
  `architecture-decisions.md` index gained the missing ADR-012 entry;
  `domain-catalog.md` no longer lists the removed `files/` domain;
  `DOCUMENTATION_TREE.md` regenerated to list all 97 markdown files with
  section folders.

Verification: `pnpm typecheck` 68/68, `pnpm lint` clean, full integration
suite 241 tests green (21 new across web-i18n + platform-packages i18n,
others re-run), `pnpm build` green; git tree contains only intentional
pre-existing changes plus this H13/H14 work.

## H15 — Final verification gate

Status: pending

- [ ] All gates pass (install, lint, typecheck, unit, integration, E2E, build)
- [ ] Migration gates pass
- [ ] Failure drills pass
- [ ] Performance regression checked
- [ ] Clean backup/restore passes

## H16 — Final production polish (ISR fix, CSP enforcement, OTel exporter, Member /me benchmark, type safety)

Status: complete (except container re-scan — see note)

### 1. Public post-by-slug ISR / revalidation

Root cause of the earlier "public post 404 (ISR)" report: the route was always
configured dynamically (`revalidate = 0` + `cache: 'no-store'`), and dev/runtime
verification confirms it is server-rendered on demand (`ƒ (Dynamic)` in the
route table). No ISR revalidation path is needed and none is used. The earlier
404 was a stale dev-server module graph after node_modules churn, not an ISR
cache.

Verified (dev + production compose):
- draft → web 404; publish → web 200 with SSR content
- title/content update → reflected immediately
- slug change → old 404, new 200
- unpublish → 404; delete → 404
- members/paid visibility → 404 on public API/web (new enforcement, see below)

Chosen strategy: **Option A — dynamic rendering** with explicit
`revalidate = 0` and `cache: 'no-store'` fetches; runtime publish → 200 without
rebuild. Documented in this file and verified against `compose.prod.yml` on a
clean database (create → publish → `GET /posts/:slug` = 200).

### 2. Restricted-content leak fix (new security finding)

`findPublishedBySlug`/`list()` for posts AND pages did not filter
`visibility` — members/paid content was served by the public content API and
web routes. Fixed by adding `visibility: 'public'` enforcement:

- `ListPostsFilter`/`ListPagesFilter` gained `visibility`
- `findPublishedBySlug` (posts + pages repos) now requires `visibility = 'public'`
- Public content routes pass `visibility: 'public'` (posts, pages, tag posts,
  author posts)
- Search content sources already filtered `visibility !== 'public'` (verified)

Coverage: `tests/security/content-api.test.ts` gained a restricted-content
non-leak test (post + page); runtime verification shows 404 on public routes
while admin API still serves the entity.

### 3. CSP enforcement

CSP moved from report-only to enforced at all layers:

- **API (Fastify Helmet):** `default-src 'none'` + explicit
  `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri 'none'`, `form-action 'none'` — no `unsafe-inline`, no `unsafe-eval`.
- **Web (Next.js):** per-request nonce via `apps/web/src/middleware.ts`. Next.js
  15.5 reads the nonce from the CSP request header and applies it to its inline
  bootstrap scripts. `script-src 'self' 'nonce-…'` (no unsafe-inline, no
  unsafe-eval); `style-src 'self' 'nonce-…' 'unsafe-inline'` (documented
  exception for React inline style attributes in themes).
- **Admin/Portal SPAs:** strict CSP in `docker/nginx.spa.conf.template`
  (`script-src 'self'`, `style-src 'self' 'unsafe-inline'` — React style
  attribute exception; Vite builds emit external scripts only).
- **Gateway:** global CSP `add_header` removed (per-app policies replace it);
  other security headers retained.

Verified: header assertions in `apps/api/src/__tests__/api-hardening.test.ts`
(enforced, no report-only header, no unsafe-inline); web headers carry
matching nonces; E2E 66/66 (Admin, Portal, Web, themes, media, member portal,
checkout redirect) pass with enforcement active; production compose header
checks pass at all three layers.

### 4. OpenTelemetry exporter

`@vibress/observability` gained a full optional OTel exporter
(`packages/observability/src/tracing.ts`):

- Config: `TRACING_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_SAMPLING_RATIO`,
  `OTEL_RESOURCE_ATTRIBUTES` (typed via `@vibress/config`).
- `TRACING_ENABLED=false` → no provider/exporter (noop handle).
- Collector unavailable → fail-open (2 s export timeout, spans dropped, app
  keeps serving).
- Instrumentation: HTTP spans (auto-instrumentation), `safeFetch` outbound
  spans, `queue.enqueue.*` spans via `enqueueTraced`, `worker.job.*` spans via
  `tracedProcessor`, `outbox.relay.deliver` spans, `db.transaction` spans.
- Context propagation: HTTP `traceparent` → ALS → outbox envelope `trace`
  field → dispatcher continues remote trace → queue job `traceparent` →
  worker job span. Runtime-verified: a request carrying
  `traceparent: 00-4bf9…-01` produced an outbox row with the identical
  traceId.
- Secret redaction: `safeFetch` spans record `url.full` without query string;
  span attributes never carry secrets.
- Coverage: `tests/integration/platform-packages.test.ts` (trace context
  helpers, remote continuation, invalid input no-op, fail-open) and
  `tests/integration/outbox.test.ts` (envelope trace propagation).

### 5. Type safety (explicit-any)

- Previous count: 245 (42% reduction from 421 baseline).
- Final count: **0** explicit-any type usages in production source
  (15 `z.any()` → `z.unknown()`; remaining 9 `\bany\b` hits are comments).
- Regression guard: `scripts/count-explicit-any.mjs` (`pnpm verify:explicit-any`,
  wired into CI) fails above 120.
- No `(err as any).code` mutations remain.

### 6. Member `/me` benchmark (real member session)

Benchmarked `GET /api/members/v1/me` with a REAL member session obtained via
the full magic-link flow (Mailpit token extraction → verify → session cookie):

| Concurrency | Duration | r/s | p50 | p90 | p97.5 | p99 | max | errors |
|---|---|---|---|---|---|---|---|---|
| 10 | 30 s | 2,867 | 16 ms | 29 | 33 | 34 | 60 | 0 |
| 50 | 60 s | 3,058 | 35 ms | 65 | 70 | 74 | 98 | 0 |
| 100 | 60 s | 3,008 | 37 ms | 68 | 72 | 77 | 298 | 0 |

(autocannon JSON exposes p90/p97.5/p99, not p95.)

Security regression: no cookie → 401; staff cookie → 401; member cookie → 200;
revoked session (logout) → 401; disabled member → 401. API CPU ~115% at
c100 (single-core bound), RSS stable ~758 MB.

### 7. Dependency/container hygiene

- `pnpm audit --prod`: **clean** after adding `sharp ^0.35.0` override
  (CVE-2026-33327/33328/35590/35591 in libvips < 0.35.0; web app does not use
  `next/image` so runtime impact is nil).
- Container scan (Trivy, all 6 images, HIGH/CRITICAL + ignore-unfixed):
  **clean (0 findings)** after three fixes:
  1. Go-stdlib CVEs (CVE-2026-42499/42504) in esbuild binaries — esbuild
     0.18.20 via deprecated `@esbuild-kit/core-utils` and 0.25.12 via
     `drizzle-kit` → `esbuild: 0.28.1` override (0.28.1 ships a patched Go
     toolchain).
  2. npm-CLI-bundled deps (brace-expansion 5.0.6, ip-address 10.2.0,
     tar 7.5.16, undici 6.26.0 in `/usr/local/lib/node_modules/npm` of the
     node:24-alpine base) → runtime images now remove the bundled npm CLI
     after pnpm bootstrap (`api`/`worker`/`web` Dockerfiles).
  3. OS-level CVEs in the nginx alpine bases (openssl, zlib, musl, …) →
     `apk upgrade --no-cache` added to `gateway`/`spa` Dockerfiles.
  Verified locally: all 6 images scan 0 HIGH/CRITICAL; workspace lockfile
  overrides (sharp ^0.35.0, brace-expansion ^5.0.9, uuid ^11.1.1) make
  `pnpm audit` fully clean; hardened stack boots, migrates a fresh DB, serves
  published posts, and passes all health checks.

### Gates summary (this batch)

- `pnpm typecheck` — pass (0 errors)
- `pnpm lint` — pass (0 errors; pre-existing warnings unchanged)
- `npx vitest run` — 554 tests pass
- `pnpm build` — pass (all apps incl. 4 UI bundles + Next standalone)
- `pnpm audit --prod` — clean (after sharp override)
- Playwright E2E — 66/66 pass
- Production compose: 8/8 healthy; runtime-created published post returns 200
  on web route; unpublish/delete → 404; restricted → 404; CSP headers verified
  at web/api/admin layers; migrations applied on a clean database.
- `pnpm verify:explicit-any` — 0 (max 120)
- Clean backup/restore: unchanged schema (no migrations added) — previous
  hardened restore evidence remains valid (release-verification.md §4).
