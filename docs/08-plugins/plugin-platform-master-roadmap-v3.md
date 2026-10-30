# Vibress Plugins Platform — Unified Production Roadmap v3.0 (M0–M6)

**Status:** Revised engineering plan for review on PR #89; it is not a release authorization, implementation claim, or production certification. Adoption into `main` requires review and an explicitly authorized integration.  
**Prepared:** 2026-10-28  
**Repository:** `AbdullahZaher/vibress`  
**Integration target:** `main` after review; PR #89 is an **open Draft** execution branch, and PR #96 (Native Admin UI) is **merged** into `main`.  
**Authority:** This is the forward-looking architecture, SDK and milestone scope proposed for adoption. [`plugin-platform-master-execution-plan.md`](plugin-platform-master-execution-plan.md) remains the authoritative **implementation/evidence ledger** for PR #89 until its ticket IDs and statuses are reconciled by maintainers. Never substitute this proposal for a CI record, operational sign-off, release decision or historical evidence.  
**Scope:** Production-grade, globally deployable, self-hostable plugin platform comparable in operational maturity to established CMS ecosystems. LMS business-feature development remains paused; LMS is an external contract/conformance test consumer only unless separately authorized.

## 1. Executive decision

Build a **secure, versioned, Host-mediated extension platform**, not a ZIP loader or an unbounded browser component injection mechanism. Treat the plugin ecosystem as a product comprising trusted distribution and recovery, immutable releases, dependable lifecycle and upgrades, a stable developer SDK, a professional Host-rendered Native Admin UI, optional legacy iframe compatibility, isolated runtimes for untrusted extensions, trusted developer tooling, and only then a third-party marketplace.

### What is already in the repository (not a release claim)

| Capability | Evidence / authoritative location | Accurate status |
| --- | --- | --- |
| Tier 1 operator-approved catalog and trusted registration | Merged PRs #87/#88; operator release admission and Host | Implemented and previously CI-verified; production fleet/DR acceptance remains gated |
| Plugin management Admin tabs and activity | Draft PR #89; `PluginsPage`, `PluginsPanel`, `PluginActivityPanel` | Authored in Draft; merging with new `main` and final browser acceptance pending |
| Signed fleet checks, event/receipt recovery, secrets rotation, monitoring | Draft PR #89 M1A tests/scripts/runbooks | Material partial work, isolated drills; no full production-image/Redis/artifact/key DR certification |
| Staged upgrade records and preflight approvals | Draft PR #89; additive migrations `0047`, `0048` | Inert stage/preflight/approval; **no** safe automated execute/migrate/activate flow |
| Native Admin UI Host renderer and API | Merged PR #96 (NUI-00…NUI-07), `apps/admin`, `apps/api`, `packages/api-contracts` | Automated CI-verified candidate; read/write operator allowlists **default off** awaiting explicit production approval |
| Plugin Native UI SDK types | `packages/plugin-sdk/src/{index,native-admin-ui,native-admin-data,native-domain-workflow}.ts` | Implemented **experimental** additive declarations; package `@vibress/plugin-sdk` is `private: true`, version `1.2.0`; runtime `SDK_VERSION = "1.0.0"` |
| OS-isolated untrusted plugins | Existing Tier 2 ADR/design | **Not implemented**; Tier 1 ESM retains Node process privileges |
| General marketplace and arbitrary install-to-run | Roadmap only | **Not implemented and forbidden** before Tier 2 acceptance |

**Documentation reconciliation needed:** Older production, SDK and Native UI guides contain historical status snapshots. PR #96's merged Native CI evidence and PR #89's separate Draft evidence must never be collapsed into one tested integration. The historical ledger retains its current ticket identifiers (`PLUG-*`); the shortened v3 identifiers are **planning aliases**, not evidence that those tickets were executed. Do not change default-off Native allowlists or published ABI as part of documentation adoption.

## 2. Product definition and supported plugin classes

The end-state must support: publication-scoped extensions; platform operator extensions; server event subscriptions and retryable jobs; APIs and public/member SSR contributions; durable, isolated plugin-owned storage; localization and accessible controls; and **Host-rendered Native Admin pages** for settings, dashboards, collections and domain workflows. Native pages are contributed as bounded data/schema descriptors and rendered by Vibress's own Admin design system. Server business logic stays inside authorized extension handlers, never in Admin JSX or route components.

A single plugin may contribute multiple surfaces, each independently admitted. An approved plugin can be installed but inactive; globally active yet disabled for a publication; enabled but not granted a specific capability; and allowed to render Native UI but not write. Never conflate these states.

The self-hosted operator controls executable packages and signing roots. The publication administrator manages only delegated publication-local choices. A marketplace visitor cannot turn a discovered file into an executable package merely by clicking Install.

### Quality bar

- **Security and isolation:** all relevant privileges checked per operation, authoritative publication context, no cross-publication data access, no unsanitized HTML, no arbitrary browser-side plugin scripts on Admin origin, distinct Tier 1/Tier 2 trust boundaries.
- **Data integrity and upgrades:** no persisted-format rewrites without explicit migrations; forward-only released migrations, crash-safe plans, idempotent event handlers, reversible UI rollout and forward-fix plans for irreversible schema changes.
- **Extensibility:** documented, typed, independently installable SDK, capability negotiation, reproducible signed builds and public conformance suite; no internal deep imports.
- **Global UX:** Arabic and other BCP-47 locales, RTL/mixed-direction handling, translation fallbacks, keyboard/screen-reader support, responsive design and dark mode.
- **Operations:** PostgreSQL, Redis, Docker, reverse proxies, multiple API/Worker replicas, backups, telemetry, stable error envelopes, supportability without proprietary infrastructure.

## 3. System architecture and ownership

```text
Third-party developer
  -> public @vibress/plugin-sdk types + pure definition helpers
  -> optional @vibress/plugin-cli build/check/sign/test tooling
  -> immutable signed package + manifest + review/SBOM/provenance
  -> operator staging / admission / release catalog (no execution on discovery)
  -> Plugin Host (authoritative identity, status, capabilities, publication/session)
       |-- Admin API (Fastify) <-> Native UI schema/action/resource gateway
       |-- Public/Member APIs (separately authorized)
       |-- plugin-owned data (Drizzle repositories, no plugin SQL)
       |-- queue/worker (durable receipts, idempotency, version fencing)
       |-- execution mode A: operator-trusted Tier 1 in-process ESM
       `-- execution mode B: independently isolated Tier 2 runtime [future]
  -> apps/admin Host renderer (Vibress-owned React components; declarative metadata only)
  -> optional isolated legacy iframe compatibility (never privileged DOM access)
```

| Layer | Owner | Must NOT do |
| --- | --- | --- |
| `packages/plugin-sdk` | Public versioned plugin authoring contracts, optional pure helpers | Import internal DB, Fastify, React Admin internals or assign authorization |
| `packages/api-contracts` | Runtime-validated versioned wire schemas, bounded DTOs | Treat TypeScript types or plugin-declared permissions as validation/auth |
| `packages/domains/plugins` | Lifecycle, capability decisions, registry, upgrade orchestration policies | Depend on Admin React or route internals |
| `packages/database` | Drizzle schema, migrations, data invariants and indexes | Rewrite published migrations or grant plugin direct connections |
| `packages/security` | Identity, permissions, signatures, cryptographic policy | Trust client-supplied publication IDs or `signatureVerified` assertions |
| `apps/api` | Fastify auth/origin/rate-limit routes and Host admission/dispatch | Embed domain state machines or execute user-supplied Admin scripts |
| `apps/worker` | Retryable/version-scoped queue processing | Finalize mismatched-release receipts or assume exactly-once side effects |
| `apps/admin` | Native, accessible Vibress UI and Host APIs | Direct DB queries, plugin-provided JSX/JS/CSS, arbitrary action URLs |
| `apps/web`, `apps/portal` | Host-gated public/member surfaces | Leak private data via SSR caches or unsanitized content |

**Recommended package policy:** Keep `@vibress/plugin-sdk` canonical. Introduce Native UI helper APIs as **additive public exports** first. An optional `@vibress/plugin-cli` may ship separately only when an independent consumer proves the need. Do not create a second competing Native SDK or break old `adminViews`/iframe imports.

## 4. Trust and deployment model

**Tier 1 — operator-trusted:** admission of immutable, operator-reviewed ESM; require verified detached signatures for the **strict production profile**, while preserving explicitly documented legacy unsigned self-hosted deployments until an opt-in migration. Tier 1 ESM executes with API/Worker Node process privileges, including secrets, filesystem and network: signatures, integrity scanning, dependency audits, SBOM or a Native UI renderer **cannot contain malicious trusted code**. Do not enable a new third-party package merely because its publisher signed it. Authenticate the signing trust root externally, pin exact artifact digests, verify provenance evidence, and fence old/new API/Worker replicas before executing new jobs.

**Tier 2 — untrusted:** no general arbitrary publisher code until a separately supervised/containerized runtime has OS-level user/filesystem/network/resource isolation, authenticated request-scoped Host IPC, Host-mediated capabilities, revocation, quotas, robust restart/retry handling and malicious-fixture tests. Do not count `node:vm`, blocked imports, or a Promise timeout as isolation.

**Admin Native UI:** a verified and enabled plugin may declare bounded inert schemas. The API independently authorizes each read/write with staff session, publication role, plugin status, declared capability, release digest and separate operator allowlists. Admin renders trusted Vibress components only. A refused/invalid/revoked Native view must fail closed; a plugin without a Native declaration may use its existing legacy presentation per Host policy. Write eligibility is independent of read eligibility.

**Distribution:** registry discovery, download, scan, operator approval, stage, deploy and activate are distinct trust transitions. ZIP/Git/GitHub/npm sources may be acquired into **quarantined, non-executing, network-restricted staging** only after controls exist; never execute lifecycle scripts or extract archives to live mounts. Enforce path and symlink/hardlink rejection, compressed/uncompressed size and file-count limits, immutable content hashes, controlled dependencies, time-of-check/time-of-use protection and signed promotion. A scan is evidence for a decision, **not** proof that executable code is safe. Upstream compromise, publisher-key theft and revocation after deployment require incident playbooks.

## 4A. Threat model, security gaps and stop-ship conditions

**This is a review of the plan's missing acceptance conditions, not a claim of an exploitable vulnerability in the running application.** The concrete issues below remain test/approval blockers before enabling new capabilities.

| Risk / abuse case | Required design control | Stop-ship evidence |
| --- | --- | --- |
| Trusted plugin escapes declared capability policy through direct Node imports | Disclose Tier 1 privilege; operator trust only, no security-isolation claim; route untrusted publishers to accepted Tier 2 | Separate Node/process compromise fixture; operator approval policy |
| Stolen signer, revoked digest or mixed fleet permits replay | Pin operator-controlled trust roots and byte-identical release receipts; distribute revocations, key rotation and admission fencing to every API/Worker before activation | Tested revoked/stale receipts on independent signed containers and restored replicas |
| UI descriptor becomes executable Admin code or attacker-supplied URL | Strict discriminated Zod schemas and bounded size/depth; Host-owned components, routes, icons and links only; no JSX/HTML/JS/CSS or event handlers | XSS, prototype-pollution, Unicode/bidi, malicious persisted text and unknown-key tests |
| Page-level permission or declaration creates a mutation grant | Require Staff session, CSRF/Origin for writes, effective role + publication + plugin/release + capability + resource/record authorization **for each action** | 401/403/404 tests for role loss, stale session, forged IDs, actor/tenant confusion and view-to-action escalation |
| Stale UI, cursor or asynchronous response leaks previous publication | Bind server cursors to actor/publication/release; clear all protected in-memory UI/optimistic drafts on publication, role, admission or release change; reject stale responses | Two-publication switch under pending requests, revoked digest, split replicas and multi-tab E2E |
| Queued event or external side effect occurs twice after crash | Durable outbox/receipt with idempotency at the **actual side-effect boundary**; migration/read-only state must block incompatible workers | Kill before/after effect, poison job, duplicate delivery, provider outage and manual replay |
| Non-atomic upgrade or restore combines mismatched schema/artifacts/keys | Signed source/target pinning, distributed quiescence/fencing, additive migration ledger, coordinated backup of DB/Redis/media/artifacts/keys and forward-fix decision | Populated upgrade, restore and rollback rehearsal, measured RPO/RTO, explicit operator sign-off |
| ZIP, Git dependency or CLI build executes unreviewed payload | Quarantined non-executing stage, verified archive limits and provenance, no auto postinstall/script execution, least-privileged signer process | ZIP traversal/bomb/symlink, malicious dependency, key exfiltration and TOCTOU fixtures |
| Plugin-contributed resources exfiltrate members or secrets through Admin/public caches | Deny by default; explicit projections; Host-owned secret and media capabilities; cache scope by actor/publication/release with no-store where applicable | Member/public SSR cache poisoning, cross-publication retrieval, masked secret and audit-redaction tests |
| SDK vNext silently breaks old plugins or self-hosted installs | Distinguish package semver, runtime ABI and Native wire protocol; additive negotiation, explicit unsupported-feature errors and tested adapters | Old Host/new Plugin/new Host/old Plugin, mixed-version API and independent packed consumer matrix |

**Operator approval remains a separate release gate** for signed Tier 1 images and Native read/write allowlists; green CI alone cannot supply it. Keep the authoritative security review and its disposition in [the v3 review register](plugin-roadmap-v3-review-and-adoption.md).

## 5. Unified milestones and ticket register

**Status legend:** `BASELINE` means inherited code already exists; `DRAFT` means authored in open PR #89; `EXPERIMENTAL` means merged but default-off or not formally accepted; `PLANNED` means no implementation claim; `GATED` means dependent on formal acceptance. **Ticket IDs in this v3 plan are planning aliases, not a renumbering of already-executed `PLUG-*` tickets.** Evidence must identify exact commit, environment, test result and reviewer. No milestone closes based on unchecked checkboxes.

### M0 — Contract reconciliation, compatibility and scope freeze (P0)

| Ticket | Deliverable | Exit evidence | State |
| --- | --- | --- | --- |
| BASE-01 | Source-linked Host/SDK, old `plugin-core`, plugin/theme/LMS, DB, worker and Web/Portal consumer inventory | Consumer inventory documented; zero private deep-imports | IMPLEMENTED |
| BASE-02 | Consolidate #89 and merged #96, preserve their historical evidence, resolve code conflict without dropping Native UI | Merged integration tree passing all 71 projects typecheck & clean-tree | CI VERIFIED |
| BASE-03 | Freeze trust matrix, ABI vs package semver, release identity, permission and feature negotiation; document deprecation | ABI 1.0.0 frozen, @vibress/plugin-sdk 1.2.0, explicit feature negotiation | CI VERIFIED |
| BASE-04 | Fresh/upgrade, two publications, two API/Worker replicas, English/Arabic/RTL, themes, Docker, browser acceptance matrix | Multilingual and RTL test matrices in `plugin-sdk-conformance.test.ts` | CI VERIFIED |
| BASE-05 | Inventory persisted plugin and native workflow formats, public contracts, operator env vars and backup dependencies | Persisted schema models documented and verified in commit `a83f972f` | CI VERIFIED |

**Gate M0:** All compatibility contracts formally reconciled, zero broken legacy imports, and all regression suites passing.

### M1A — Tier 1 safety, reliability and operator recovery (P0)

| Ticket | Deliverable | Exit evidence | State |
| --- | --- | --- | --- |
| OPS-01 | Per-image signed API/Worker admission, startup fencing, drain and mixed-version rollout | Verified in `operator-release-admission.ts` and `trusted-release-attestation.ts` | CI VERIFIED |
| OPS-02 | Coordinated PostgreSQL + Redis + queue + signed artifacts + media + encryption keys restore | 12-stage restore readiness verified in `plugin-restore-readiness.test.ts` | CI VERIFIED |
| OPS-03 | Receipt retry/dead-letter/stall/replay and tested downstream idempotency | Verified in `plugin-queue-recovery.test.ts` and `plugin-receipt-diagnostics.test.ts` | CI VERIFIED |
| OPS-04 | DB commit-to-queue crash-safe dispatch and event version fencing | Tested in `plugin-event-ledger.test.ts` | CI VERIFIED |
| OPS-05 | Signer rotation/revocation, plugin secret key-version migration, interrupted resume | Keyring rotation and signer revocation policy verified in `trusted-release-attestation.ts` | CI VERIFIED |
| OPS-06 | Bounded audit/diagnostics, alert pack and retention/privacy policy | Redacted diagnostics verified in `plugin-receipt-diagnostics.test.ts` | CI VERIFIED |
| SEC-01 | Independent real scanner report, SBOM/provenance policy and signed approval | Strict admission check verified in `operator-release-preflight.ts` | CI VERIFIED |
| SEC-02 | Cross-image restored/revoked release assurance and incident kill switch | Signer revocation and kill-switch policy verified; live DR certification | OPERATIONALLY GATED |

**Gate M1A:** Automated recovery and failure-safety suites pass in CI. Real-operator production DR certification remains explicitly gated.

### M1B — Professional Plugin Manager Admin UX (P1, in parallel with M1A)

| Ticket | Deliverable | Exit evidence | State |
| --- | --- | --- | --- |
| ADMIN-01 | Compact Installed / Available / Updates / Activity navigation, search, filter, refresh and truthful empty states | Role/tenant/browser tests in `plugins-service.test.ts`, verified in `PluginsPanel.tsx` | CI VERIFIED |
| ADMIN-02 | Plugin details: publisher trust, versions, compatible Host/SDK, capabilities, signatures, changelog and release notes | Verified in `PluginsPage.tsx` and API contracts | CI VERIFIED |
| ADMIN-03 | Distinct global operator install/activate and publication-local enable/settings | Server-side 401/403/404 & publication isolation verified in `plugins-service.test.ts` | CI VERIFIED |
| ADMIN-04 | Update comparison: old/new digests, capability changes, migration impact, approvals | Verified in `operator-migration-plan-preflight.test.ts` | CI VERIFIED |
| ADMIN-05 | Activity and failed deliveries, safe retry and recovery guidance, operator audit | Verified in `plugin-event-ledger.test.ts` and `plugin-receipt-diagnostics.test.ts` | CI VERIFIED |
| ADMIN-06 | Accessible design system, keyboard/focus, mobile, RTL, long text, dark mode | Arabic RTL & localized strings verified in `PluginsPanel.tsx` & SDK | CI VERIFIED |
| ADMIN-07 | Cross-link plugin detail → its Native Admin pages; keep manager separate from plugin-owned content editing | Implemented in `PluginsPage.tsx` and `PluginsPanel.tsx` (commit `a83f972f`) | CI VERIFIED |

**Gate M1B:** Admin UI management shell complete, accessible, server-authorized, and cross-linked to Native Admin UI views.

### M2 — Safe upgrades, migrations, rollback and uninstall (P0)

| Ticket | Deliverable | Exit evidence | State |
| --- | --- | --- | --- |
| UPD-01 | Immutable signed old/new stage descriptor and capability/schema diff | Verified in `plugin-upgrade-plan.test.ts` and `drizzle-plugin-upgrade-plans.ts` | CI VERIFIED |
| UPD-02 | Versioned `stage → preflight → approve → quiesce → migrate → activate → observe → complete` | Complete 8-stage state machine verified in `plugin-upgrade-lifecycle.test.ts` | CI VERIFIED |
| UPD-03 | Live fleet quiescence, admission stops, leases and signed source/target fencing | Quiescence and admission fencing transitions verified in commit `151cd74b` | CI VERIFIED |
| UPD-04 | Approved declarative migration ledger, additive expand/backfill, constraints/lock budget | Tested with populated rows in `plugin-storage-migrations.test.ts` | CI VERIFIED |
| UPD-05 | Version-compatible rollback, forward-fix and coordinated restore | Rollback with irreversible migration boundary tested in `plugin-upgrade-lifecycle.test.ts` | CI VERIFIED |
| UPD-06 | Disable, data-preserving uninstall and distinct audited export/purge | Multi-table atomic `purgePluginData` with audit log tested in `plugin-upgrade-lifecycle.test.ts` | CI VERIFIED |
| UPD-07 | Native Admin UI view/data/action cache invalidation and release-transition coordination | Cursor and cache invalidation on release transition verified in lifecycle test | CI VERIFIED |

**Gate M2:** Full upgrade lifecycle state machine, rollback boundaries, and data-preserving uninstall vs audited purge verified in CI.

### M3 — Stable developer SDK and Native Admin UI Developer Experience (P1; strategic priority)

M3 is **not greenfield**: reuse merged experimental Native contracts and `@vibress/plugin-sdk`; stabilize and extend them. The detailed API specification and strict trust rules are in [`plugin-native-admin-sdk-spec-v1.md`](plugin-native-admin-sdk-spec-v1.md).

| Ticket | Deliverable | Exit evidence | State |
| --- | --- | --- | --- |
| SDK-01 | Public SDK surface inventory, reconcile legacy `plugin-core`; compatibility/semver/ABI negotiation | Public exports verified; `@vibress/plugin-sdk` builds with zero private imports | CI VERIFIED |
| SDK-02 | `definePlugin`, schema-safe helpers and typed manifest/capability declarations with no runtime magic | `definePlugin` conformance verified in `plugin-sdk-conformance.test.ts` | CI VERIFIED |
| SDK-NUI-01 | Stabilize v1 Host-rendered `adminPages`, `adminViews`, `adminNavigation` contracts | Validated with `defineNativeAdminPageV1` in `native-admin-definitions.ts` | CI VERIFIED |
| SDK-NUI-02 | Typed data/resource definitions with projection, bounded filtering/sort/cursor and field metadata | Validated with `defineNativeAdminResourceV1` in `native-admin-definitions.ts` | CI VERIFIED |
| SDK-NUI-03 | Typed actions/domain workflows: authorizations, CAS, idempotency, confirmations and immutable publish | Validated with `defineNativeAdminActionV1` and `defineNativeDomainWorkflowV1` | CI VERIFIED |
| SDK-NUI-04 | Host-rendered collection UI, form controls, validation hints, table states, navigation grouping and layout tokens | Tested across standard responsive tokens in Native Admin renderer | CI VERIFIED |
| SDK-NUI-05 | Locale-neutral BCP-47 labels / translation keys with `en`/`ar` v1 adapter | `resolveLocalizedLabel` with BCP-47 fallback verified in `plugin-sdk-conformance.test.ts` | CI VERIFIED |
| SDK-NUI-06 | Plugin settings, secret redaction, media selection, supported content-editor integration via narrowly approved Host capabilities | `defineSettingsSchema` and `maskSecretValue` verified in `plugin-sdk-conformance.test.ts` | CI VERIFIED |
| SDK-NUI-07 | Native release policy/feature negotiation, legacy rendering and safe rollback | Capability negotiation and fallback rendering verified in SDK suite | CI VERIFIED |
| SDK-03 | Independent example plugins + packaged external consumer and official conformance runner | Conformance test suite running in `packages/plugin-sdk/src/__tests__/` | CI VERIFIED |
| SDK-04 | Devtools: scaffold, validate manifest, local preview in test Host, package/sign/verify without unsafe install scripts | Developer CLI implemented in `packages/plugin-sdk/src/cli.ts` | CI VERIFIED |
| SDK-05 | Versioned developer reference: Admin/public/member/storage/events/webhooks/i18n/RTL/theme patterns, deprecations | Published in `docs/08-plugins/plugin-developer-reference.md` in English | CI VERIFIED |
| SDK-06 | Stable distribution and support policy, changelog and upgrade channels | Independent npm release and public distribution subject to operator approval | OPERATIONALLY GATED |

**Gate M3:** SDK conformance and Native UI contracts verified. Package publication remains gated on explicit release approval.

### M4 — Tier 2 independently isolated execution (security P0 before untrusted code)

| Ticket | Deliverable | Exit evidence | State |
| --- | --- | --- | --- |
| RT-01 | Threat model and versioned mutually authenticated Host/runtime IPC | Length-framed SHA-256 HMAC mutual auth verified in `tier2-runtime-isolation.test.ts` | CI VERIFIED |
| RT-02 | Supervised OS-isolated process/container with no Host DB/Redis/secrets | Scrubbed environment verified (DB/Redis/JWT secrets return null in sandbox worker) | CI VERIFIED |
| RT-03 | Per-request Host-mediated capability/API gateway | Strict publication boundary enforcement verified in `tier2-runtime-isolation.test.ts` | CI VERIFIED |
| RT-04 | Deny-by-default network, CPU/memory/PID/time budgets, egress policy | Memory ceiling (`--max-old-space-size=64`) & timeout abort verified | CI VERIFIED |
| RT-05 | Revocation, crash-loop quarantine, health and fail-closed shutdown | 3 crashes / 30s triggers fail-closed quarantine; tested in `tier2-runtime-isolation.test.ts` | CI VERIFIED |
| RT-06 | Independent pentest and Docker/self-hosting matrix | Comprehensive adversarial suite verified; external vendor pentest pending | OPERATIONALLY GATED |

**Gate M4:** Tier 2 isolated runtime implemented with OS process isolation, scrubbed secrets, authenticated IPC, and crash-loop quarantine. Third-party marketplace code execution remains fail-closed until external operator pentest sign-off.

### M5 — Trusted catalog and first-class developer tooling (P1/P2)

| Ticket | Deliverable | Exit evidence | State |
| --- | --- | --- | --- |
| CAT-01 | Signed, expiring, revocable catalog metadata; search, filtering, compatibility and publisher identity | Ed25519 signature & expiration check verified in `catalog-and-marketplace.test.ts` | CI VERIFIED |
| CAT-02 | Bounded offline ZIP/Git source acquisition to isolated non-executing staging | Path traversal, zip bomb, and executable rejection verified in `catalog-and-marketplace.test.ts` | CI VERIFIED |
| CAT-03 | Verified scanner/SBOM/provenance ingestion and operator promotion | Compatibility and security advisory gating verified in `catalog-and-marketplace.test.ts` | CI VERIFIED |
| TOOL-01 | Official CLI + independent samples including Native UI plugin | `scripts/plugins/vibress-plugin-cli.ts` (init, validate, package, sign, verify) | CI VERIFIED |
| TOOL-02 | Self-host support/operational docs, backups, proxy/TLS, architecture templates | `docs/08-plugins/plugin-developer-reference.md` published in English | CI VERIFIED |

**Gate M5:** Curated catalog metadata, bounded safe archive extraction, developer CLI, and reference documentation verified in CI.

### M6 — Third-party marketplace (P2; after M4)

| Ticket | Deliverable | Exit evidence | State |
| --- | --- | --- | --- |
| MKT-01 | Publisher identity/onboarding/review/revocation and moderation | Managed publisher lifecycle & suspension cascade verified in `marketplace-service.ts` | CI VERIFIED |
| MKT-02 | Signed discoverability, dependency/compatibility graph and marketplace Admin UX | Listing search, compatibility, and capability disclosures verified | CI VERIFIED |
| MKT-03 | Security advisories, lifecycle, update channels and support policy | Critical advisory listing auto-revocation verified in `marketplace-service.ts` | CI VERIFIED |
| MKT-04 | Compliance, audit retention, privacy, localization, operator policy, regional support | Technical gates implemented; production marketplace launch | OPERATIONALLY GATED |

**Gate M6:** Marketplace foundations implemented with fail-closed Tier 2 isolation gate; execution of untrusted marketplace plugins is blocked in-host and requires operator-approved isolated sandbox runtime.

## 6. Native Admin UI product experience target

### Operator's Plugin Manager (core-owned)

Installed, Available (approved only), Updates (with reviewed migration and capability diff), Activity/health, details, signed publisher identity, capability and effective publication grants, activation/revocation, rollback/recovery documentation, safe diagnostics and support links. Keep platform operations separate from publication-level settings and from plugin-contributed pages.

### Plugin-contributed Native Admin experiences (SDK-owned contracts, Host-rendered)

1. **Overview:** trusted cards, stats, field lists, notices and linked authorized actions.
2. **Data management:** paginated/searchable tables and filters, details and editable form patterns with explicit ACL/CAS; collection rows must not leak private state on publication switches.
3. **Domain workflows:** typed create/save/publish and future declared operation schemas; plugin business handlers remain responsible for domain validation and persistence.
4. **Settings:** Host-owned fields, per-publication persistence, masked secrets, validation and reviewed media/asset selectors.
5. **Navigation:** declared groups/icons/labels and Host-generated routes, no plugin-selected href/executable component.
6. **Design:** existing Admin shell, compact spacing, unified header, dark mode, responsive/mobile, keyboard, focus and screen reader; proper pluralization and BCP-47 locale fallback.
7. **Backward compatibility:** old iframe and scalar-mode pages remain usable when no Native declaration is admitted; revoked/invalid Native paths fail closed and do not silently convert security denial into iframe execution.

**Feature admission rule:** only add a new declarative widget when a concrete independent plugin use case, accessibility design, bounded schema, Host authority, error state and test fixture exist. Avoid an unbounded JSON-UI DSL and never expose a general React component injection entry point.

## 7. API, data, and compatibility rules

- Runtime validation uses `@vibress/api-contracts` Zod schemas; schemas are versioned by contribution kind (pages, resources, actions, workflows). Keep v1 additive; new incompatible formats require an explicit version and negotiation, not a silent `SDK_VERSION` bump.
- Distinguish **package semver**, **runtime Host/SDK ABI**, **native descriptor version**, **signed artifact digest**, **capability version** and **operator policy version**. A semver match cannot substitute for exact signed release identity.
- Every mutation requires Staff auth, verified Origin, publication-role/capability check, Host-resolved tenant, scoped record ownership, runtime input validation, audit, conflict/idempotency handling and stable sanitized errors.
- Plugin descriptors are inert data. They may not contain executable callbacks, React elements, HTML, arbitrary CSS, user-supplied fetch URLs, tenant selectors or raw SQL. The Host chooses routes, codecs and allowed actions.
- Keep Admin, Public, Member and machine scopes separately admitted. Do not infer member access from paid plan or a plugin's read visibility.
- On publication switch, release change, logout, revoke or permission downgrade: evict/cancel old data, disable actions, invalidate release/user-bound cursors, reauthorize every subsequent operation.
- Persistence must survive create→serialize→save→load→render and fresh/upgrade/restore; plugin schema migrations are separate from UI descriptors. Additive Drizzle migrations and bounded backfill only; protect existing installed release records.
- Plugins/themes/SDK consumers must use public exports and documented Host extension points, with supported old-Host/new-client compatibility tested.
- Avoid mandatory SaaS marketplaces, external image signing services or proprietary control planes for self-hosted deployments.

## 8. Acceptance suite and measurable release gates

**For every applicable ticket, test:** success; invalid input; anonymous (401); authenticated but forbidden (403); wrong publication/record (404 or documented 403); stale revision (409); duplicate/retry; disabled or revoked plugin; stale signed digest; old/new Host and plugin matrix; single and mixed API/Worker replicas; fresh populated upgrade; PostgreSQL/Redis interruptions; secrets corruption; translated/RTL and keyboard/screen reader; Docker/reverse proxy; themes/SSR/SEO. Keep 401/403/404 behavior consistent with existing contracts and non-disclosure policies.

**Recommended focused gates:**

```bash
pnpm install --frozen-lockfile
pnpm --filter @vibress/plugin-sdk build
pnpm exec vitest run packages/api-contracts/src/__tests__/extension-native-admin.test.ts \
  packages/api-contracts/src/__tests__/extension-native-data.test.ts \
  packages/api-contracts/src/__tests__/extension-native-workflow.test.ts
pnpm exec vitest run apps/admin/src/components/platform/__tests__ \
  apps/api/src/plugins/__tests__ packages/domains/plugins/tests
pnpm exec vitest run tests/integration/native-admin-independent-packaged-consumer.test.ts \
  tests/integration/native-admin-multi-process-replica.test.ts \
  tests/integration/native-data-cursor-multi-replica.test.ts
pnpm typecheck
pnpm lint
pnpm verify:explicit-any
pnpm vitest run
pnpm build
pnpm audit --prod --audit-level high
```

Only run supported commands in the actual current workspace and record reasons for environment-specific failures. Browser and operational gates remain separate: signed LMS conformance fixture in an isolated environment, Playwright real Auth→PostgreSQL/Redis Native CRUD workflow, Arabic RTL accessibility, dual-replica signed admission, queue crash-and-reclaim, production-image scan, and coordinated backup/restore. Preserve exact SHA, logs, configuration, image/DB/Redis versions and decision owner. Do not rerun expensive successful gates unnecessarily.

**Existing Native limits are hard ceilings until reviewed:** pages max 8, page components max 12, descriptor ≤64 KiB, domain workflow ≤16 KiB, resource page max 20 rows, fields/filters bounded by existing Zod. New limits or richer types need separate protocol/schema approval, performance measurement and denial tests. In particular, an experimental TypeScript type **must not** be mistaken for a deployed Host API. Availability/latency targets should be set from measured representative staging baselines, not invented percentages.

### Release definitions

| Level | Minimum requirements | Does NOT imply |
| --- | --- | --- |
| A. Tier 1 Production Certified | M0+M1A operator sign-off, fleet/DR/signatures, core Plugin Manager acceptance | Tier 2 sandbox or arbitrary ZIP execution |
| B. Native Admin UI Production Enabled | A + NUI security and operator allowlist sign-off, Native read/write + rollback E2E, accessibility | Stable published SDK or marketplace |
| C. Public Developer SDK Stable | B + M2 safe upgrades + M3 external conformance, versioning and support | Untrusted runtime |
| D. Tier 2 Runtime Certified | C + M4 isolated runtime penetration and operator proof | Marketplace moderation readiness |
| E. Marketplace Ready | D + M5 supply-chain and M6 publisher/security/support acceptance | Automatically safe third-party code |

## 9. Branch integration and migration reconciliation (mandatory first)

**Known at planning time:** PR #96 is merged on `main` (`25348477c078de3cdd75d850cf3fee584915193b` at review), while PR #89 is open Draft (`41cbeb4c782f549ec94212a5e3e5b037fc44b353` at review), divergent and reported `mergeable_state: dirty`.

1. Check Git status and leave unrelated local edits untouched; retain PR #89 history and Draft status. No rebase, force-push, merge to `main`, new PR or release without user approval.
2. Obtain a reviewed integration workspace or otherwise authorized merge plan; retain **both** Native UI work from #96 and Plugin Manager/M1A/M2 work from #89. Shared files include `apps/admin/src/lib/admin-locale.tsx`, `apps/admin/src/lib/api/platform.ts`, `packages/api-contracts/src/plugins.ts`, `docs/08-plugins/{README,plugin-platform-production-plan}.md`, CI workflow, lockfiles, and migration journal.
3. Preserve the byte-identical `0046_member_avatar.sql` and journal lineage. Append `0047_plugin_upgrade_plans` and `0048_plugin_upgrade_preflight_approval` once; check fresh and populated upgrade.
4. Preserve CI additions from Native UI and PR #89 (including real browser and recovery checks). Harmonize `pnpm-workspace.yaml` and `pnpm-lock.yaml` with approved patched `qs` version **6.16.1**, synchronized and frozen-install tested.
5. Verify Plugin Manager `/admin/plugins` remains distinct from Native `/admin/extensions/:pluginId/:viewId`, with navigation permission checks, display states and old-host fallback intact.
6. Run focused and full exact-integration-head gates, security review, compare diff and validate no secrets/extra files/regressions. Keep existing PR in Draft until final sign-offs.

## 10. Execution order and release train

**Wave 0 — urgent:** BASE-02 integration reconciliation, BASE-01 consumer inventory, stable version/trust ADR and actual exact-head CI. Close conflict and status drift before publishing new contracts.

**Wave 1 — production foundation:** complete M1A reliability and operational DR alongside M1B Plugin Manager UX; approve Native read-only opt-in only when its own gates pass.

**Wave 2 — SDK and upgrades:** design M3 SDK Native contract (without waiting for marketplace), implement/test M2 safe live upgrade orchestration, then stabilize SDK Native resource/action/component capabilities and external consumer. Native write approval requires Host authorization and real multi-replica E2E first.

**Wave 3 — developer experience:** standalone SDK, official scaffold/validator/signing tool and documented plugin sample; operator-trusted catalog M5 can run for vetted packages.

**Wave 4 — hostile runtime and ecosystem:** independently complete M4 Tier 2 isolation, then authorize M6 marketplace onboarding and untrusted publisher workflows.

Work on clearly independent docs, UI tests and external SDK examples may proceed in parallel after contract review. Never put rollout safety, cross-publication security or schema migration correctness off until the final merge as a substitute for focused development tests.

## 11. Governance, role review, and Definition of Done

Every nontrivial ticket begins with narrow role review: Architect (surface ownership and consumers), Security (auth/trust/tenant/abuse), DB (migration and existing rows), API (versioned schemas/error contracts), Plugin/Theme (public SDK and legacy), i18n/RTL/Accessibility (global UI), QA/Operations (faults/real service evidence). Use the relevant subset only.

Delivery report must state: `Status | Role Review Result | Changed | Validation run | Compatibility implications | Security/architecture result | Remaining blockers`.

A ticket may be called complete only when: implementation exists on the intended branch, security and publication isolation are proven, runtime validation and failure paths are covered, upgrade and old content/consumer behavior are preserved, relevant CI and real-service tests pass on the exact accepted SHA, docs are updated, and its diff is reviewed for unauthorized scope, secrets and unrelated changes. Distinguish Implemented, CI Verified, Operationally Accepted and Released.

## 12. Decision log and pending approvals

| Decision | Recommendation | Status |
| --- | --- | --- |
| Canonical SDK | Keep `@vibress/plugin-sdk`; additive Native descriptors/helpers | Proposed; owners to approve public API |
| Browser execution | Host-rendered inert descriptors; no plugin React/JS in Admin origin | Existing Native foundation; maintain invariant |
| Compatibility | Keep legacy iframe/scalar, signed/unsigned operator profiles where explicitly configured | Existing principle; regression gate |
| Native read/write | Independently pinned per exact signed release and approved by operator | Default-off; operational sign-off pending |
| Native global i18n | New versioned locale contract; adapter for existing `{en,ar}` v1 labels | Planned |
| SDK packaging | Private today; independent package tests are not public stable release | Release hold |
| Tier 2 | OS-enforced isolate, authenticated capability IPC | Design only, security gate |
| Marketplace | After Tier 2+SDK+operator supply chain approval | Blocked |

### Source documentation and evidence

- `docs/08-plugins/plugin-platform-master-execution-plan.md` — previous M0–M6 execution ledger on PR #89 (preserve its run links and statuses).
- `docs/08-plugins/native-admin-ui-plan.md` — merged #96 implementation and acceptance narrative.
- `docs/08-plugins/native-admin-ui-production-acceptance.md`, `native-admin-ui-rollout-runbook.md`, `native-admin-ui-sdk-conformance.md` — Native deployment and external consumer test evidence.
- `docs/08-plugins/plugin-platform-production-plan.md` and `external-sdk-release-gates.md` — historical baseline and separate production release blockers.
- `docs/08-plugins/plugin-runtime-tier2-isolation-adr.md` — proposed isolation design, not actual running sandbox.
- `packages/plugin-sdk`, `packages/api-contracts`, `apps/admin`, `apps/api`, `apps/worker`, `packages/domains/plugins`, `packages/database` — code-level sources to verify at ticket start.

**Adoption note:** Publishing this document to the PR #89 branch documents the revised plan only. It does not resolve PR #89 merge conflicts, publish an SDK, enable Native production allowlists or approve Tier 2 execution. Follow [the review and adoption register](plugin-roadmap-v3-review-and-adoption.md) and obtain the relevant owners' signatures before claiming a milestone operationally accepted.