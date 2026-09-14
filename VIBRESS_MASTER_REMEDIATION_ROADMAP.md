# VIBRESS — MASTER REMEDIATION & EVOLUTION ROADMAP
## Comprehensive Engineering Roadmap Across 15 Core Workstreams

---

## Roadmap Prioritization Structure
- **P0: Immediate Hardening (v1.0.1)** — Critical security flaws, documentation truth alignment, and unhandled failure modes that must be resolved immediately.
- **P1: Production Core Evolution (v1.1)** — True Multi-Publication isolation, RBAC capability refactoring, soft-delete slug fix, and persistent glossary.
- **P2: Real-Time & Intelligence (v1.2)** — Real-Time Collaborative Studio (WebSocket + Yjs + Redis), Content-Aware AI platform, and Translation Memory (TM).
- **P3: Ecosystem & Extensibility (v2.0)** — Theme Marketplace, cryptographically signed plugin distribution, and WebAssembly (WASM) plugin sandboxing.

---

# WORKSTREAM A: Real-Time Collaborative Studio (Priority: P2 — v1.2)

1. **Current State**: Prototype / disconnected. CRDT updates live in an ephemeral in-memory JS `Map`; `PostEditor` passes no collaboration props; no WebSocket server in API.
2. **Evidence**: `apps/api/src/routes/collaboration.ts` lines 283/309; `packages/studio-react/src/collaboration/websocket-collaboration-provider.ts` is unimported.
3. **Problem**: Multiple users editing the same post overwrite each other or hit 409 version conflicts. Zero simultaneous typing or presence exists.
4. **Why It Matters**: Modern CMS teams expect Google Docs-style concurrent editing without data loss.
5. **Target Architecture**: Embedded Fastify WebSocket server (`@fastify/websocket`) + Redis Pub/Sub broadcast + PostgreSQL CRDT append log with snapshot compaction.
6. **Database Changes**: Add `post_crdt_snapshots` (binary Y.Doc state) and `post_crdt_updates` (append-only delta log) tables.
7. **API Changes**: Add `GET /api/v1/collaboration/posts/:postId/ws` WebSocket route handling binary SyncStep1/SyncStep2 and Awareness protocols.
8. **Frontend Changes**: Connect `<CollaborationPlugin>` in `PostEditor.tsx` using `WebSocketCollaborationProvider`, passing live user colors and cursor positions.
9. **Worker Changes**: Add background compaction job compacting `post_crdt_updates` into `post_crdt_snapshots` when log exceeds 200 rows.
10. **Security Implications**: Authenticate WebSocket handshake via session token; enforce `posts.edit` capability and publication boundary; limit binary frame size to 64KB.
11. **Migration Strategy**: Backfill initial snapshot for all existing posts from `posts.content` JSONB.
12. **Backward Compatibility**: Fully backward compatible; fallback to optimistic locking if client fails WebSocket upgrade.
13. **Failure Handling**: Exponential backoff reconnection; client-side offline buffer in Y.Doc; graceful degradation to REST autosave.
14. **Testing Strategy**: Dual-browser Playwright E2E spec verifying simultaneous bidirectional typing and offline reconnect.
15. **Observability**: Prometheus metrics: `vibress_collab_active_connections`, `vibress_collab_message_duration_ms`.
16. **Documentation Changes**: Comprehensive guide on WebSocket reverse proxy configuration for Nginx, Caddy, and Cloudflare.
17. **Acceptance Criteria**: Two separate browsers see each other's live cursors and type in the same document without conflict.
18. **Definition of Done**: Multi-browser Playwright test green in CI; zero in-memory CRDT Maps in API code.
19. **Estimated Complexity**: High (3 weeks, 2 senior engineers).
20. **Dependencies**: Redis Pub/Sub, Fastify WebSocket plugin.
21. **Risks**: High memory usage if large binary snapshots are not compacted regularly.

---

# WORKSTREAM B: Multi-Publication / True Tenant Isolation (Priority: P1 — v1.1)

1. **Current State**: Prototype / disconnected. `workspaces` and `publications` exist as tables, but core content tables have no `publication_id`.
2. **Evidence**: `posts.ts`, `pages.ts`, `media.ts`, `members.ts` lack `publication_id`. `WorkspaceService` is only called in unit tests with in-memory mocks.
3. **Problem**: Total cross-tenant data bleed. Any staff member can view or mutate resources belonging to any publication.
4. **Why It Matters**: True multi-tenancy is required for multi-brand media networks, agencies, and enterprise organizations.
5. **Target Architecture**: Strict multi-tenant data architecture where every content entity is partitioned by `publication_id`, and Fastify request context decorates `req.tenant`.
6. **Database Changes**: Add `publication_id TEXT NOT NULL REFERENCES publications(id)` to `posts`, `pages`, `media`, `tags`, `members`, `newsletters`, `search_documents`, `content_translations`.
7. **API Changes**: Introduce `resolveTenantContext` middleware; scope all route queries by `req.tenant.publicationId`.
8. **Frontend Changes**: Add Publication Switcher dropdown in Admin sidebar header; persist active publication in session context.
9. **Worker Changes**: Wrap all BullMQ job payloads in `TracedJobEnvelope` containing `publicationId`.
10. **Security Implications**: Complete elimination of IDOR vulnerabilities between publications.
11. **Migration Strategy**: 3-phase migration: 1) Add nullable column, 2) Backfill default publication ID, 3) Set NOT NULL and create composite unique indexes.
12. **Backward Compatibility**: Single-publication installations automatically operate with the default publication without UX changes.
13. **Failure Handling**: Return HTTP 404 (not 403) on cross-tenant resource requests to prevent tenant metadata enumeration.
14. **Testing Strategy**: Dedicated cross-publication attack test suite (`tests/integration/tenant-isolation-boundary.test.ts`).
15. **Observability**: Add `publication_id` tag to all Pino logs, OpenTelemetry traces, and Prometheus metrics.
16. **Documentation Changes**: Multi-publication administration guide and domain mapping docs.
17. **Acceptance Criteria**: User in Publication A cannot read or mutate any post, page, member, or tag in Publication B.
18. **Definition of Done**: 100% of repository queries enforce `publication_id`; zero global queries.
19. **Estimated Complexity**: Very High (4 weeks, 2 engineers).
20. **Dependencies**: None.
21. **Risks**: Data corruption during backfill if migration script fails midway (mitigated by transactional DDL).

---

# WORKSTREAM C: Authorization / RBAC Hardening (Priority: P1 — v1.1)

1. **Current State**: Implemented but contains dangerous hardcoded role string bypasses.
2. **Evidence**: `packages/security/src/authorization/index.ts` lines 6, 42, 65 check `userRoles.includes("owner")`, `"administrator"`, `"editor"`.
3. **Problem**: Custom restricted roles cannot be created because hardcoded role strings bypass fine-grained capability checks.
4. **Why It Matters**: Enterprise compliance (SOC2, ISO27001) requires principle of least privilege.
5. **Target Architecture**: Pure capability-based access control. Roles are merely collections of permissions; code evaluates capabilities only.
6. **Database Changes**: Seed initial universal capability set (`*`) to the Owner role in `role_permissions` table.
7. **API Changes**: Deprecate role-checking functions; replace with `hasCapability(actor, requiredCapability)`.
8. **Frontend Changes**: Update Admin UI to dynamically check capabilities rather than role names.
9. **Worker Changes**: Workers verifying jobs assert specific capability tokens.
10. **Security Implications**: Closes vertical privilege escalation loopholes.
11. **Migration Strategy**: Data migration ensuring all existing owners have the full permission grant list.
12. **Backward Compatibility**: Fully backward compatible with standard role definitions.
13. **Failure Handling**: Fail closed on missing or null permissions.
14. **Testing Strategy**: Mutation testing asserting that removing a single permission denies access even if the user has role `"editor"`.
15. **Observability**: Log all `PERMISSION_DENIED` events with actor ID, requested capability, and request ID.
16. **Documentation Changes**: RBAC administration guide detailing all 42 granular capability keys.
17. **Acceptance Criteria**: An editor stripped of `posts.delete` cannot delete posts under any circumstances.
18. **Definition of Done**: Zero role string literal checks remaining in `@vibress/security`.
19. **Estimated Complexity**: Medium (1.5 weeks, 1 engineer).
20. **Dependencies**: None.
21. **Risks**: Locking out existing administrators if migration doesn't grant full permissions.

---

# WORKSTREAM D: Plugin Runtime & Security Model (Priority: P0 for deprecation, P3 for WASM)

1. **Current State**: 1 bundled plugin; `sandbox.ts` uses insecure `node:vm`; `extension-host.ts` is a mock.
2. **Evidence**: `packages/plugin-core/src/sandbox.ts` lines 45-52.
3. **Problem**: `node:vm` is susceptible to prototype breakout and arbitrary host RCE.
4. **Why It Matters**: Prevents catastrophic security breaches from untrusted plugin code.
5. **Target Architecture**: Deprecate `node:vm` immediately; enforce bundled plugins for v1.x; adopt WebAssembly (WASI) for v2.0.
6. **Database Changes**: None for v1.x.
7. **API Changes**: Remove dynamic `executeSandboxedPluginCode()` from public API routes.
8. **Frontend Changes**: Display "Bundled Only" status on Plugins page in Admin.
9. **Worker Changes**: None.
10. **Security Implications**: Eliminates primary RCE attack surface.
11. **Migration Strategy**: Mark `sandbox.ts` deprecated immediately with security warnings.
12. **Backward Compatibility**: Bundled plugins continue working without change.
13. **Failure Handling**: Fail closed if any unverified plugin is encountered.
14. **Testing Strategy**: Security regression test verifying prototype breakout attempts fail.
15. **Observability**: Audit log on plugin registration and execution.
16. **Documentation Changes**: Explicitly document that Vibress v1.x supports first-party bundled plugins only.
17. **Acceptance Criteria**: No arbitrary code execution paths in the codebase.
18. **Definition of Done**: `node:vm` execution removed; documentation reflects bundled standard.
19. **Estimated Complexity**: Low for P0 deprecation (3 days); High for P3 WASM (4 weeks).
20. **Dependencies**: None for deprecation.
21. **Risks**: Developer expectation management regarding third-party marketplace.

---

# WORKSTREAM E: Studio Reliability & Conflict Handling (Priority: P0 — v1.0.1)

1. **Current State**: Real / Partial. Studio editing works, but concurrent edits trigger a blunt reload prompt.
2. **Evidence**: `apps/admin/src/components/PostEditor.tsx` lines 697-711.
3. **Problem**: If version conflict occurs, unsaved work in the active editor is lost upon clicking "Reload Latest".
4. **Why It Matters**: Author productivity and data loss prevention during drafting.
5. **Target Architecture**: In-browser local recovery buffer (IndexedDB) + side-by-side visual merge resolution modal.
6. **Database Changes**: None.
7. **API Changes**: Add `POST /posts/:id/draft-backup` endpoint.
8. **Frontend Changes**:
   - Save local drafts to IndexedDB on every keystroke.
   - On 409 conflict, open Visual Conflict Resolver showing side-by-side diff between local unsaved text and remote server text.
9. **Worker Changes**: None.
10. **Security Implications**: None (client-side UX hardening).
11. **Migration Strategy**: Transparent client upgrade.
12. **Backward Compatibility**: Fully compatible.
13. **Failure Handling**: Restore from IndexedDB if browser crashes or tab is closed accidentally.
14. **Testing Strategy**: Playwright test simulating simulated 409 conflict and verifying zero text loss.
15. **Observability**: Track client-side conflict occurrences via telemetry.
16. **Documentation Changes**: Author recovery and conflict resolution guide.
17. **Acceptance Criteria**: An author experiencing a conflict can copy or merge their changes without data loss.
18. **Definition of Done**: IndexedDB draft caching active on all Studio edit pages.
19. **Estimated Complexity**: Medium (1.5 weeks, 1 frontend engineer).
20. **Dependencies**: None.
21. **Risks**: Stale IndexedDB cache causing confusion if not invalidated on successful publish.

---

# WORKSTREAM F: AI-Native Content Platform (Priority: P2 — v1.2)

1. **Current State**: Real / Partial. Multi-provider gateway exists, but rate limits/budgets are in-memory, and AI has zero content context.
2. **Evidence**: `packages/domains/ai/src/application/ai-gateway-service.ts` lines 49-50.
3. **Problem**: Budget resets on server reboot; AI output sounds generic because it has no access to brand voice or internal link graph.
4. **Why It Matters**: High-value differentiator against WordPress and Ghost.
5. **Target Architecture**: Content-Aware AI Engine with Redis-backed distributed token buckets and publication-level brand voice injection.
6. **Database Changes**: Add `publication_ai_settings` and `ai_prompt_templates` tables.
7. **API Changes**: Update AI completion route to ingest publication context, brand guidelines, and Lexical document AST.
8. **Frontend Changes**: Add AI Brand Voice configuration screen in Admin Settings; add inline Alt-Text generator in Media Library.
9. **Worker Changes**: None.
10. **Security Implications**: Encrypt publication custom API keys at rest; sanitize prompt injection delimiters.
11. **Migration Strategy**: Create default AI settings for existing publications.
12. **Backward Compatibility**: Default prompt templates match current behavior.
13. **Failure Handling**: Graceful fallback across providers (Ollama → OpenAI → Anthropic) on rate limit or 5xx.
14. **Testing Strategy**: Integration tests verifying Redis budget incrementation and prompt hydration.
15. **Observability**: Prometheus metrics: `vibress_ai_tokens_consumed_total`, `vibress_ai_request_latency_seconds`.
16. **Documentation Changes**: Guide to configuring local Ollama models and publication brand personas.
17. **Acceptance Criteria**: AI generates completions matching configured brand voice without exceeding monthly token cap.
18. **Definition of Done**: Distributed rate limiting verified across multiple container replicas.
19. **Estimated Complexity**: Medium-High (2.5 weeks, 1 senior engineer).
20. **Dependencies**: Redis.
21. **Risks**: LLM API latency spikes impacting user typing flow (mitigated by streaming responses).

---

# WORKSTREAM G: Translation Memory & Persistent Glossary (Priority: P1 — v1.1)

1. **Current State**: Real / Partial. Translation workflow is solid, but glossary is static in-memory and TM is absent.
2. **Evidence**: `packages/i18n/src/glossary.ts` lines 54-67.
3. **Problem**: Inability to manage custom publication terminology; repetitive translation costs for identical sentences.
4. **Why It Matters**: Crucial for high-volume multilingual newsrooms and global enterprises.
5. **Target Architecture**: PostgreSQL-backed `publication_glossaries` and `translation_memory_units` with trigram fuzzy matching.
6. **Database Changes**: Create `publication_glossaries` and `translation_memory_units` tables.
7. **API Changes**: Add CRUD endpoints for glossaries; add TM segment match endpoint `POST /translations/match-segment`.
8. **Frontend Changes**: Add Glossary Manager screen in Admin; show TM matches and automated quality score badge in Translation Editor.
9. **Worker Changes**: None.
10. **Security Implications**: Scope glossaries and TM units strictly by `publication_id`.
11. **Migration Strategy**: Seed default Arabic/English terms into `publication_glossaries`.
12. **Backward Compatibility**: Existing translation records remain intact.
13. **Failure Handling**: Fall back to pure AI/human translation if TM returns no match.
14. **Testing Strategy**: Unit tests asserting 100% exact match and >70% fuzzy match retrieval.
15. **Observability**: Track TM reuse rate (`vibress_tm_cache_hit_ratio`).
16. **Documentation Changes**: Multilingual publishing handbook explaining glossary enforcement.
17. **Acceptance Criteria**: An editor adding "Vibress" → "فايبرس" in Glossary sees it enforced in all subsequent AI translations.
18. **Definition of Done**: Persistent glossary and TM unit indexing operational in Admin.
19. **Estimated Complexity**: Medium (2 weeks, 1 engineer).
20. **Dependencies**: `pg_trgm` extension.
21. **Risks**: Inaccurate fuzzy matches if similarity threshold is set too low (keep threshold ≥ 75%).

---

# WORKSTREAM H: Theme Ecosystem & Developer SDK (Priority: P3 — v2.0)

1. **Current State**: Real / Complete for local Liquid rendering and zip validation; missing marketplace and CLI SDK.
2. **Evidence**: `packages/theme-core/src/theme-engine.ts`; absence of theme CLI.
3. **Problem**: Third-party designers cannot easily test themes locally or publish to a marketplace.
4. **Why It Matters**: Rich theme ecosystems drive open-source CMS adoption (WordPress/Shopify model).
5. **Target Architecture**: Public Theme Registry API + `@vibress/theme-cli` developer tool + in-Admin 1-click theme installer.
6. **Database Changes**: Add `marketplace_theme_cache` table.
7. **API Changes**: Add `GET /themes/marketplace` and `POST /themes/install-remote`.
8. **Frontend Changes**: Add Marketplace tab to Themes page in Admin with live preview and 1-click install.
9. **Worker Changes**: Background job downloading and verifying theme packages from registry.
10. **Security Implications**: Cryptographic signature verification (Cosign) on all remote theme downloads.
11. **Migration Strategy**: Existing installed themes continue functioning.
12. **Backward Compatibility**: Fully backward compatible.
13. **Failure Handling**: Safe rollback if new theme version fails certification.
14. **Testing Strategy**: CLI test suite verifying theme linter against standard and broken themes.
15. **Observability**: Track theme installation and render durations.
16. **Documentation Changes**: Theme Developer Handbook and Liquid filter reference.
17. **Acceptance Criteria**: Designer can run `npx @vibress/theme-cli validate` locally and publish to registry.
18. **Definition of Done**: Theme CLI published to npm; marketplace tab active in Admin.
19. **Estimated Complexity**: High (3.5 weeks, 2 engineers).
20. **Dependencies**: None.
21. **Risks**: Theme compatibility issues across major Vibress version releases (enforce `themeApi` version gate).

---

# WORKSTREAM I: Search Engine Modernization (Priority: P1 — v1.1)

1. **Current State**: Real / Partial. Functional trigram fuzzy search with Arabic normalization, but lacks `publication_id` and tsvector.
2. **Evidence**: `packages/domains/search/src/infrastructure/drizzle-search-repository.ts`.
3. **Problem**: Cross-tenant search leak; trigram scans on millions of rows can become slow under load.
4. **Why It Matters**: Fast, accurate search is core to content discovery and reader retention.
5. **Target Architecture**: Partitioned `search_documents` by `publication_id` + Hybrid PostgreSQL FTS (`tsvector` with dictionary stemmers for English and Arabic) combined with `pg_trgm` for fuzzy typos.
6. **Database Changes**:
   - Add `publication_id` FK to `search_documents`.
   - Add generated `tsv` column: `tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || body_text)) STORED`.
   - Add GIN index on `(publication_id, tsv)`.
7. **API Changes**: Add publication filter to `GET /search`.
8. **Frontend Changes**: Display highlighted search snippets in Reader search results.
9. **Worker Changes**: Search indexer worker populates `publication_id` and regenerates vector indexes.
10. **Security Implications**: Complete search isolation between publications.
11. **Migration Strategy**: Background re-indexing job populates the new table without search downtime.
12. **Backward Compatibility**: Search API contract remains identical.
13. **Failure Handling**: Fall back to trigram matching if tsvector query syntax errors occur.
14. **Testing Strategy**: Search accuracy and latency benchmark across 50,000 documents.
15. **Observability**: Prometheus histogram: `vibress_search_duration_seconds`.
16. **Documentation Changes**: Documentation on PostgreSQL search tuning and index maintenance.
17. **Acceptance Criteria**: Search returns relevant results in <20ms across 50k posts with 0 cross-tenant bleed.
18. **Definition of Done**: Hybrid FTS/trigram index deployed and verified in CI.
19. **Estimated Complexity**: Medium (2 weeks, 1 engineer).
20. **Dependencies**: PostgreSQL GIN.
21. **Risks**: Index storage size growth (manageable with simple dictionary stemming).

---

# WORKSTREAM J: What's New Single-Notification System (Priority: Complete — Maintain)

1. **Current State**: REAL / COMPLETE. Remote GitHub JSON feed, SSRF-safe fetch, 1h cache, SemVer evaluation, exact single-card rule, permanent DB dismissal.
2. **Evidence**: `.github/whats-new.json`, `apps/api/src/whats-new-service.ts`, `packages/utils/src/whats-new.ts`.
3. **Problem**: None. Successfully certified and verified in CI.
4. **Why It Matters**: Informs self-hosters of new features and security releases without nagging or spam.
5. **Target Architecture**: Maintain current architecture.
6. **Database Changes**: None.
7. **API Changes**: None.
8. **Frontend Changes**: None.
9. **Worker Changes**: None.
10. **Security Implications**: Maintained: SSRF protection, plain-text rendering, protocol validation.
11. **Migration Strategy**: Active in production.
12. **Backward Compatibility**: 100% compliant.
13. **Failure Handling**: Stale cache fallback on GitHub outage; returns HTTP 200 with empty items.
14. **Testing Strategy**: Maintained: unit tests + browser Playwright E2E tests.
15. **Observability**: Monitored via API request metrics.
16. **Documentation Changes**: Maintain maintainer guide in `docs/03-domains/whats-new.md`.
17. **Acceptance Criteria**: Verified: exactly 1 card displayed; dismissal is permanent per user account across all devices.
18. **Definition of Done**: Complete and in production.
19. **Estimated Complexity**: Zero (Complete).
20. **Dependencies**: None.
21. **Risks**: None.

---

# WORKSTREAM K: Workers, Outbox & Event Reliability (Priority: P0 — v1.0.1)

1. **Current State**: REAL / COMPLETE. Transactional outbox pattern using `FOR UPDATE SKIP LOCKED` is fully functional.
2. **Evidence**: `packages/events/src/outbox-dispatcher.ts`, `apps/worker/src/processors/outbox-dispatcher.ts`.
3. **Problem**: Published and failed outbox events accumulate indefinitely in the database if no active purging schedule runs.
4. **Why It Matters**: Prevents table bloat and performance degradation on high-volume publishing sites.
5. **Target Architecture**: Dedicated cron-based outbox maintenance job running every midnight to delete published events older than 7 days.
6. **Database Changes**: Add index on `outbox_events (status, created_at)` for efficient purge scans.
7. **API Changes**: None.
8. **Frontend Changes**: Add Outbox Health widget to System Status in Admin.
9. **Worker Changes**: Add daily scheduled maintenance task `purgeExpiredOutboxEvents()`.
10. **Security Implications**: None.
11. **Migration Strategy**: Apply index migration.
12. **Backward Compatibility**: Fully compatible.
13. **Failure Handling**: Purge in small batches (e.g. 5,000 rows) with sleep intervals to avoid locking the table.
14. **Testing Strategy**: Integration test asserting that records older than 7 days are deleted while recent records are retained.
15. **Observability**: Gauge metric: `vibress_outbox_pending_count`, `vibress_outbox_failed_count`.
16. **Documentation Changes**: Operational maintenance runbook.
17. **Acceptance Criteria**: Outbox table automatically prunes historical records without manual SQL maintenance.
18. **Definition of Done**: Maintenance scheduler verified in worker test suite.
19. **Estimated Complexity**: Low (3 days, 1 engineer).
20. **Dependencies**: None.
21. **Risks**: Table lock during purge (mitigated by batching and index).

---

# WORKSTREAM L: Production Operations & DevOps (Priority: P0 — v1.0.1)

1. **Current State**: Real / Complete. Production Docker Compose topology with isolated internal networks and unprivileged non-root users.
2. **Evidence**: `compose.prod.yml`, `docker/*.Dockerfile`.
3. **Problem**: Claims of "zero-downtime rolling deployment" are untrue for single-host Docker Compose.
4. **Why It Matters**: Transparent operational expectations for DevOps engineers and self-hosters.
5. **Target Architecture**: Provide an official **Kubernetes Helm Chart** and **Docker Swarm compose file** for true zero-downtime rolling updates.
6. **Database Changes**: None.
7. **API Changes**: Add Kubernetes-compatible liveness (`/health/live`) and readiness (`/health/ready`) endpoints.
8. **Frontend Changes**: None.
9. **Worker Changes**: Add graceful shutdown handling (`SIGTERM`) allowing active jobs up to 30 seconds to finish.
10. **Security Implications**: Run containers with read-only root filesystems where possible.
11. **Migration Strategy**: Ship Helm chart in `infrastructure/helm/`.
12. **Backward Compatibility**: `compose.prod.yml` remains the standard for single-server self-hosters.
13. **Failure Handling**: Readiness probes remove failing pods from ingress before connections drop.
14. **Testing Strategy**: Automated CI smoke test running backup and restore drill against production compose stack.
15. **Observability**: Prometheus scrape annotations and pre-configured Grafana dashboard templates.
16. **Documentation Changes**: Production Operations Manual with documented RPO/RTO measurements.
17. **Acceptance Criteria**: Helm chart deploys cleanly on minikube/EKS; rolling update completes with 0 dropped HTTP requests.
18. **Definition of Done**: Helm chart tested in GitHub Actions CI workflow.
19. **Estimated Complexity**: Medium (2 weeks, 1 DevOps engineer).
20. **Dependencies**: Docker, Helm.
21. **Risks**: Complexity of managing multiple deployment templates (keep compose and helm in parity).

---

# WORKSTREAM M: Test Quality & Verification Hardening (Priority: P0 — v1.0.1)

1. **Current State**: Implemented but contains critical mock illusions in collaboration and tenancy tests.
2. **Evidence**: Detailed in [VIBRESS_TEST_QUALITY_AUDIT.md](file:///Users/abdullahzaher/vibress/VIBRESS_TEST_QUALITY_AUDIT.md).
3. **Problem**: Tests pass green in CI while underlying runtime wiring is disconnected.
4. **Why It Matters**: Prevents shipping regression bugs and builds genuine confidence in release certifications.
5. **Target Architecture**: End-to-end verification gates testing actual network protocols and database tables.
6. **Database Changes**: None.
7. **API Changes**: None.
8. **Frontend Changes**: Add deterministic test identifiers (`data-testid`) across Admin components.
9. **Worker Changes**: None.
10. **Security Implications**: Validates that security boundaries hold under adversarial input.
11. **Migration Strategy**: Add new test specs to existing Vitest and Playwright configurations.
12. **Backward Compatibility**: Fully compatible.
13. **Failure Handling**: Flaky test detection and automated retry in CI.
14. **Testing Strategy**: Replace shallow mock tests with real database integration tests.
15. **Observability**: CI test duration and coverage reporting.
16. **Documentation Changes**: Testing guidelines for open-source contributors in `CONTRIBUTING.md`.
17. **Acceptance Criteria**: Zero tests asserting mock objects when testing core security or data boundaries.
18. **Definition of Done**: All 4 required new test suites passing in GitHub Actions.
19. **Estimated Complexity**: Medium (1.5 weeks, 1 QA/DevOps engineer).
20. **Dependencies**: Playwright.
21. **Risks**: Longer CI run times (mitigate with test parallelization and shard runners).

---

# WORKSTREAM N: Documentation Truth & Public Alignment (Priority: P0 — Immediate)

1. **Current State**: Several public claims in README, CHANGELOG, and reports are FALSE or MISLEADING.
2. **Evidence**: Detailed in [VIBRESS_DOCUMENTATION_TRUTH_AUDIT.md](file:///Users/abdullahzaher/vibress/VIBRESS_DOCUMENTATION_TRUTH_AUDIT.md).
3. **Problem**: Marketing claims exceed runtime reality, risking open-source developer backlash.
4. **Why It Matters**: Absolute technical integrity is the foundation of developer adoption.
5. **Target Architecture**: 100% alignment between documentation and codebase reality.
6. **Database Changes**: None.
7. **API Changes**: None.
8. **Frontend Changes**: None.
9. **Worker Changes**: None.
10. **Security Implications**: Accurately informs users of security boundaries.
11. **Migration Strategy**: Immediate PR updating documentation.
12. **Backward Compatibility**: Fully compatible.
13. **Failure Handling**: None.
14. **Testing Strategy**: Markdown link and claim review.
15. **Observability**: None.
16. **Documentation Changes**:
   - Update `README.md` (remove real-time collaboration claim; update microservices terminology).
   - Update `CHANGELOG.md` to reflect real v1.0 capabilities.
   - Publish [VIBRESS_FEATURE_REALITY_MATRIX.md](file:///Users/abdullahzaher/vibress/VIBRESS_FEATURE_REALITY_MATRIX.md).
17. **Acceptance Criteria**: Every feature listed in `README.md` can be exercised and verified in a running deployment.
18. **Definition of Done**: Documentation changes merged to `main`.
19. **Estimated Complexity**: Low (2 days, 1 engineer).
20. **Dependencies**: None.
21. **Risks**: None.

---

# WORKSTREAM O: Open-Source Community & Ecosystem (Priority: P1 — v1.1)

1. **Current State**: Good baseline docs (`CONTRIBUTING.md`, `LICENSE`, `SECURITY.md`), but lacks issue templates, local dev container, and good-first-issue tags.
2. **Evidence**: Root repository inspection.
3. **Problem**: High barrier to entry for external contributors.
4. **Why It Matters**: Long-term vitality of an open-source project depends on contributor velocity.
5. **Target Architecture**: Turnkey developer onboarding (`.devcontainer`), automated triage GitHub Actions, and contributor reward recognition.
6. **Database Changes**: None.
7. **API Changes**: None.
8. **Frontend Changes**: Add "Contribute" link in Admin footer.
9. **Worker Changes**: None.
10. **Security Implications**: Dependabot and automated secret scanning active.
11. **Migration Strategy**: Commit standard GitHub issue templates and devcontainer configs.
12. **Backward Compatibility**: Fully compatible.
13. **Failure Handling**: None.
14. **Testing Strategy**: Verify fresh contributor setup script on clean macOS and Linux environments.
15. **Observability**: Track GitHub stargazers, forks, and PR merge cycle times.
16. **Documentation Changes**: Contributor onboarding walkthrough and architectural orientation guide.
17. **Acceptance Criteria**: A new contributor can clone the repo and run tests cleanly within 5 minutes.
18. **Definition of Done**: Devcontainer functional in VS Code and GitHub Codespaces.
19. **Estimated Complexity**: Low (1 week, 1 engineer).
20. **Dependencies**: GitHub Actions.
21. **Risks**: Triage overhead (mitigated by automated GitHub action labels).
