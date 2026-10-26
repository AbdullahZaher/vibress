# Vibress Plugins — Master Execution & Release Acceptance Plan

**Status:** Approved execution direction; individual milestones are NOT deemed delivered by this document.  
**Planning baseline:** `main` at `782d7499ad695bafe90411b1512596380e667ca8` (PRs #87 and #88 merged).  
**Execution branch:** `feat/plugin-platform-roadmap-execution-20261024`.  
**Owner:** Vibress core engineering.  
**Excluded:** LMS feature development (paused); only external consumer/conformance checks permitted.

## 0. Purpose and source of truth

Deliver a production-grade, self-hostable plugins ecosystem while preserving existing publications, installed plugins, stored content, queued jobs, themes, public/member APIs, Arabic/RTL, and operator-managed Docker deployments.

This document is the **master sequencing, milestone and acceptance tracker**, not a replacement for the detailed contracts. Consult:

- [Existing plugin production plan](plugin-platform-production-plan.md): current P0-1..P0-4 baseline, signed admission and lifecycle.
- [SDK release gates](external-sdk-release-gates.md): independent external SDK and operational release blockers.
- [External extension roadmap](external-extensions-roadmap.md): EXT implementation/contract dependencies.
- [Security and operations](external-extensions-security-operations.md): threat model, data and rollout controls.
- [Tier 2 isolation ADR](plugin-runtime-tier2-isolation-adr.md): proposed untrusted runtime; **not implemented**.
- [Security closure register](plugin-security-closure-20261024.md): remediated findings and unverified operational gates.
- [Operator admission runbook](secure-operator-release-admission.md): signed operator release staging.
- [SDK compatibility RFC](external-extensions-sdk-compatibility.md): legacy `plugin-core` versus `@vibress/plugin-sdk`.

When source code and historical documents disagree, verify against the current branch and update the status tracker instead of rewriting history. Only mark a gate verified with a reproducible run linked to the exact commit.

## 1. Verified baseline and security decisions

- PR #87 implemented the Tier 1 approved-release catalog, release metadata, signed offline admission controls, and first P0-4 lifecycle UX; PR #88 validated the branch in CI and made a limited Next.js build configuration/docs change.
- PR #88 CI reported 2,171/2,171 Vitest passing and successful build, container scan and E2E. **Green CI alone does not certify live disaster recovery, multi-replica rollout, SDK release or third-party execution.**
- Tier 1 operator-approved ESM runs **inside API/Worker Node.js** with process-level privileges. Ed25519, SHA-256 and declared capabilities are admission controls, **not a sandbox, filesystem/network restriction or SSRF boundary**.
- Tier 2 may execute publisher-untrusted code **only after** independent process/container isolation, authenticated mediated capabilities, quotas and adversarial testing pass.
- No direct arbitrary ZIP/GitHub/npm install-to-execute from Admin. Discovery, downloading/staging, validation, approval and execution are distinct trust transitions.
- Operator global lifecycle versus publication-local enablement are separate authorities. Never trust a tenant ID alone.
- `@vibress/plugin-sdk` package version and runtime `SDK_VERSION` ABI are separate compatibility contracts. Legacy `plugin-core` consumers need an explicit inventory/adapter decision; do not simply un-private and publish the current package.
- Do not silently change legacy unsigned operator deployments to strict signed-mode. Provide an explicit, documented migration and immutable artifact snapshots.
- Never rewrite released migrations, purge plugin-owned data via standard uninstall, run plugin SQL outside approved DB workflows, or hot-swap executable bytes under active workloads.

## 2. Engineering workflow

Before each nontrivial ticket: check Git status and branch head; use only relevant reviewers (Architect, Security, DB, API, Implementer, Plugin/Theme, i18n/RTL, QA); inspect one existing pattern plus relevant consumers; make the smallest additive change; write denial/failure/upgrade regression tests; run progressively broader checks; inspect the exact diff. No unrelated refactors, LMS work, force push, main merges or releases.

**Change units:** one ticket or closely related security fixes per coherent commit/PR. This execution branch holds the planning baseline and can be used for the first implementation increment. Avoid one unrevisable all-phases PR; if the work grows, create separate feature branches/PRs from the current accepted base while maintaining this file as the master tracker. Do not mark a milestone complete because its code was merely drafted.

**Evidence levels:**
1. `Planned` — no implementation evidence.
2. `Implemented` — code and regression tests authored.
3. `CI Verified` — focused/full relevant CI passed on identified commit.
4. `Operationally Accepted` — real deployment/restore/quiescence drills completed with retained artifacts and sign-off.
5. `Released` — publication/upgrade/support documentation and release procedures approved.

## 3. Milestones and detailed tickets

### M0 — Baseline, contracts & acceptance (P0; FIRST)

| Ticket | Smallest deliverable | Exit test/evidence |
| --- | --- | --- |
| PLUG-BASE-01 | Inventory existing Host/SDK/`plugin-core` consumers, publication APIs, plugins, themes, public SSR, workers and installed data shapes | Source-linked compatibility matrix; no unsupported consumer silently discarded |
| PLUG-BASE-02 | Reconcile historical roadmap/status docs; maintain this master tracker and operator acceptance evidence links | Distinct labels for implemented, CI-verified and operationally accepted |
| PLUG-BASE-03 | Document release identity, Host ABI vs package semver, trusted/untrusted runtime tiers, publisher/revocation and deprecation policy | Architecture/security approval and backward-compatibility tests specified |
| PLUG-BASE-04 | Publish test/support matrix: fresh/upgrade, two publications, API/Worker replicas, Docker, Arabic/RTL, keyboard, themes, SDK versions | Concrete fixtures/scripts and pass/fail conditions, no fictional claims |

**M0 gate:** approved contracts, dependency graph and reproducible release acceptance checklist. Only docs/tests/necessary contract corrections; **no speculative redesign**.

### M1A — Tier 1 operational reliability (P0; parallel with M1B)

| Ticket | Deliverable | Mandatory acceptance |
| --- | --- | --- |
| PLUG-OPS-01 | Per-release API/Worker identity checks and safe mixed-version startup/admission; drain protocol | Two-replica mismatch, stale Worker, restart and rejected replay evidence |
| PLUG-OPS-02 | Coordinated PostgreSQL, Redis/queue, signed artifact and encryption-key restore process | Fresh + populated upgrade, backup/restore checksum equality, documented RPO/RTO |
| PLUG-OPS-03 | Crash/retry/duplicate/dead-letter handling, version-scoped jobs | Real queue and DB fault injection, idempotency, wrong publication denial |
| PLUG-OPS-04 | Assess and close DB-commit-to-queue gap with transactional outbox where required | Crash between transaction and enqueue does not silently lose the event |
| PLUG-OPS-05 | Safe signer-key rotation, revocation, secrets key-version migration and rollback | Unknown/revoked signer fails closed; old encrypted records remain readable until migrated |
| PLUG-OPS-06 | Bounded plugin activity/audit, health, telemetry and operator diagnosis | No secret/PII leakage, low-cardinality metrics, plugin outage does not misreport core health |
| PLUG-SEC-01 | Verify authentic scanner outputs/SBOM/provenance against signed artifact and reviewed policy | Tampered/expired/high-critical findings rejected, raw scan evidence retained |
| PLUG-SEC-02 | Prove approved release revocation, anti-replay and integrity through deployment/restore | Replayed artifact and mixed-key replicas fail closed |

**M1A gate:** reproducible real Docker + PostgreSQL + Redis drills, per-replica binary/release equality, complete recovery steps and verified operator backup restoration; CI green is necessary but not sufficient.

### M1B — Professional Admin plugin UX (P1; parallel with M1A)

| Ticket | Deliverable | Acceptance |
| --- | --- | --- |
| PLUG-ADMIN-01 | Installed / Available / Updates / Activity sections; compact responsive list, search and status filter; preserve existing routes | No new data access outside APIs; empty/loading/error states, pagination only if justified |
| PLUG-ADMIN-02 | Accessible plugin details with installed/approved version, publisher trust, permissions, compatibility and provenance limitations | Truthful approval/readiness status, no exposure of operator paths/key material |
| PLUG-ADMIN-03 | Guarded global registration/activation/deactivation vs publication-level enablement controls | Wrong role and publication denied **on server**, not only hidden in UI |
| PLUG-ADMIN-04 | Approved old/new release diff with explicit permission/migration consequences before update | Stale approval pin rejected; cannot update active ESM |
| PLUG-ADMIN-05 | Failed event/activity surface, safe retry vs offline stuck-transition recovery guidance | Error messages actionable but sanitized; never offer unsafe one-click recovery |
| PLUG-ADMIN-06 | Arabic/RTL, long translated labels, mobile, focus and screen reader improvements | Automated accessibility and bilingual E2E/keyboard test matrix |

**M1B gate:** coherent Admin experience using existing domain/service contracts, no capability escalation, approval misleadingness or cross-publication leakage. Do not build a mock marketplace backend.

### M2 — Staged update, migrations & recovery (P0 for operational correctness; after necessary M1A gates)

| Ticket | Deliverable | Acceptance |
| --- | --- | --- |
| PLUG-UPD-01 | Durable release upgrade plan: old/new signed identities, capability/schema diff, compatibility and operator consent | Exact old/new digests verified against persisted/staged state; fail closed on stale change |
| PLUG-UPD-02 | Stage → Preflight → Approve → Quiesce → Migrate → Activate → Observe → Complete | Interrupt each step: no partial unsafe execution or hidden data loss |
| PLUG-UPD-03 | Fleet coordination, job draining and release fencing for API/Worker | Old workers cannot consume incompatible new jobs; duplicate/stale leases rejected |
| PLUG-UPD-04 | Reviewed declarative DB migration ledger, expand/backfill safety, idempotent adoption | Existing rows, large tables, indexes/locks and crash/retry tests |
| PLUG-UPD-05 | Recovery, forward-fix and rollback only when schema/data compatible | Tested signed DB/Redis/artifact restore, documented irreversible boundaries |
| PLUG-UPD-06 | Data-preserving uninstall and separately authorized/exported/audited Purge | No implicit deletion of settings, billing, members, content or migration history |

**M2 gate:** interrupted upgrades, wrong-version consumers, concurrent CAS, schema failures and restore drills pass. Do not promise automatic reversal of irreversible migrations.

### M3 — Public SDK contract foundation (P1, design can begin alongside M1; required before M4)

| Ticket | Deliverable | Acceptance |
| --- | --- | --- |
| PLUG-SDK-01 | Canonical `@vibress/plugin-sdk` and explicit legacy `plugin-core` compatibility inventory/adapter | Public-only imports; old supported consumers continue running |
| PLUG-SDK-02 | Versioned Host/SDK/IPC schemas, ABI negotiation and deprecation policy | Positive/negative compatibility fixtures and strict runtime input validation |
| PLUG-SDK-03 | Independent example package + contract test harness using only public exports | Builds with no private deep import or unpublished monorepo dependency |
| PLUG-SDK-04 | Scaffold/build/verify tool design; deterministic signed manifest outputs | Reproducible artifact and signature/checksum tests |
| PLUG-SDK-05 | Developer docs for Admin/Public/Member/event/storage/capability contracts | Tenant permissions and Arabic/RTL/theming examples with denial cases |

**M3 gate:** independent external consumer CI and maintained compatibility matrix. **Stable SDK publication is a separate release gate**, not automatically granted by passing types.

### M4 — Tier 2 independent isolation (SECURITY P0 before untrusted execution)

| Ticket | Deliverable | Acceptance |
| --- | --- | --- |
| PLUG-RT-01 | Threat model + approved versioned IPC protocol with authentic Host/plugin identity | Formal trust boundary, replay/tenant/privilege escalation negatives |
| PLUG-RT-02 | Supervised process/container runtime with no Host DB/Redis/secrets | UID, filesystem, networking and resource constraints enforced outside JS |
| PLUG-RT-03 | Host-mediated capability gateway with publication/actor authorization per request | Forged tenant/member/machine scope denied before data access |
| PLUG-RT-04 | Network deny-by-default, safe mediated egress and CPU/memory/PID/time quotas | Loopback/private network, fork, starvation and filesystem attacks denied |
| PLUG-RT-05 | Crash-loop quarantine, release revoke, telemetry and emergency shutdown | Isolation persists across restart/partial failure; Host remains responsive |
| PLUG-RT-06 | Malicious fixture penetration matrix across replicas/publications | No secret disclosure, cross-tenant reads, unsafe DDL or core process takeover |

**M4 gate:** an independently reviewed adversarial test pass, real container/self-hosted support, security sign-off. `node:vm`, import restrictions and Promise timeouts are not a substitute for an OS-enforced sandbox.

### M5 — Developer tooling & curated operator catalog (P1/P2)

| Ticket | Deliverable | Acceptance |
| --- | --- | --- |
| PLUG-CAT-01 | Signed versioned registry/catalog discovery metadata with publisher identity | Distinguish discovery from permission to deploy/run; prevent catalog replay |
| PLUG-CAT-02 | Safe offline ZIP/Git fetch into isolated staging ONLY, never direct execution | Archive traversal, symlink, zip bomb, lifecycle scripts, checksum and size denial |
| PLUG-CAT-03 | Scanner ingestion, SBOM/provenance policy and signed operator promotion | Operator approves exact immutable artifact; failure is quarantined |
| PLUG-TOOL-01 | CLI scaffold/build/check/sign/verify + example extensions | SDK contract CI across release/Host versions |
| PLUG-TOOL-02 | Operator support matrix and docs for self-hosted deployment/updates | No proprietary-only infrastructure; backups and private hosting supported |

**M5 gate:** curated operator release workflow can operate without Tier 2 **only for explicitly trusted operator-reviewed code**. Never infer source discovery implies sandbox safety.

### M6 — Third-party Marketplace (P2; strictly after M4)

| Ticket | Deliverable | Acceptance |
| --- | --- | --- |
| PLUG-MKT-01 | Publisher onboarding/identity/review/revocation | Suspended publisher/artifact cannot be admitted |
| PLUG-MKT-02 | Version/dependency/compatibility/discovery UI integrated with Tier 2 | No arbitrary client-selected code execution or unsigned release |
| PLUG-MKT-03 | Lifecycle moderation, advisory/incident notification, disclosure and support policy | Signed revocation, stale metadata, vulnerable/blocked updates tested |
| PLUG-MKT-04 | Production operator controls, compliance, audit and multi-region support | Full upgrade/rollback/privacy/accessibility test matrix and operator sign-off |

**M6 gate:** no untrusted package executes outside M4 isolation or bypasses scanning, signature, identity, explicit permissions and release revocation.

## 4. Shared test matrix and quality policy

For every relevant ticket test: success; invalid schema; unauthenticated/unauthorized; operator vs publication Staff; wrong publication and IDOR; changed approval digest; symlink/traversal; stale/revoked release; concurrent activation/update; at-least-once retry/duplicate; provider/DB/Redis/Worker outage; fresh DB and populated migrations; locale policy, Arabic/RTL, keyboard/focus, mobile layouts; API/SDK/themes/Web SSR cache/SEO; Docker/reverse-proxy/self-hosted topology.

Progressive gates: focused Vitest → domain/contract tests → API/DB integration → Admin/E2E → `pnpm typecheck`, `pnpm lint`, `pnpm verify:explicit-any`, `pnpm vitest run`, `pnpm build`, `pnpm audit --prod --audit-level high`, relevant production image scan and clean diff. Run expensive completed checks only when relevant inputs change. Never skip security tests or weaken a correct assertion.

Retain run IDs and observed results for **exact HEAD SHA**. If a local tool, Docker daemon or workflow is inaccessible, record the blocker and continue other safe work; never invent successful results.

## 5. Evidence and progress ledger

Fill one row per ticket as work proceeds; treat these rows as state, not promises:

| Ticket/group | Status | Commit/PR | Test/CI evidence | Operator drill / unresolved risk |
| --- | --- | --- | --- | --- |
| PR #87 Tier 1 trusted distribution + lifecycle foundation | CI Verified (merged) | #87 | Prior CI success | In-process privilege limitation |
| PR #88 production-acceptance code verification | CI Verified (merged) | #88 | 2,171 Vitest passed, build/container-scan/E2E | Operational multi-replica + DR drills still pending |
| PLUG-BASE-01 | In progress — source-linked inventory authored | [1f98998](https://github.com/AbdullahZaher/vibress/commit/1f98998aebc5cc73ae498c59167015a0bc877bd4) | [M0 compatibility matrix](plugin-platform-m0-compatibility-matrix.md); GitHub code search returned no matches; local `rg` **not run** | Complete direct+independent consumer scan and obtain owner sign-off |
| PLUG-BASE-02 | In progress — status sources reconciled in inventory | [1f98998](https://github.com/AbdullahZaher/vibress/commit/1f98998aebc5cc73ae498c59167015a0bc877bd4) | Historical vs authoritative master sources linked; **not CI verified** | Full status matrix approval pending |
| PLUG-BASE-03 | In progress — ABI, tier and revocation policy recorded | [1f98998](https://github.com/AbdullahZaher/vibress/commit/1f98998aebc5cc73ae498c59167015a0bc877bd4) | [M0 decisions](plugin-platform-m0-compatibility-matrix.md); no external conformance run | Security/architecture signature, deprecation tests pending |
| PLUG-BASE-04 | In progress — pass/fail matrix and commands authored | [fd1c2c4](https://github.com/AbdullahZaher/vibress/commit/fd1c2c487fee8e5e57de21a263c433f0befbb727) | [M0 acceptance matrix](plugin-platform-m0-acceptance-matrix.md); scripts/fixtures not executed | Fresh/upgrade and two-replica operational drills pending |
| PLUG-OPS-01 | **CI verified, operational acceptance pending** — pre-import release fencing, Worker Host key forwarding and offline fleet receipt comparator and isolated signed admission CLI×4 | [02ee149](https://github.com/AbdullahZaher/vibress/commit/02ee1499ff68c67b6e7f2c09e163ab826ef7b44c), [4305ff5](https://github.com/AbdullahZaher/vibress/commit/4305ff59efc0a2cb92e2f0279d550f95b8ed8dc5), [c0bab7a](https://github.com/AbdullahZaher/vibress/commit/c0bab7ac3a70d52d96bd54c0005aa732ae3b51d9) | Build, E2E, scan passed [CI #40135514311](https://github.com/AbdullahZaher/vibress/actions/runs/40135514311) | API×2/Worker×2 source-process liveness during PG/Redis faults verified in disposable CI; four separate ephemeral signed admission CLI processes succeeded [drill #40281269263](https://github.com/AbdullahZaher/vibress/actions/runs/40281269263); independent production-image signer mounts, stale-worker draining and actual replica receipt provenance remain open |
| PLUG-OPS-02 | **Implemented, partial; CI DR fixture verified** — signed restore preflight + fail-closed maintenance gate + disposable PG/Redis fault and PostgreSQL-only restore evidence | [restore drill](plugin-platform-restore-drill.md), [M1A live run #40228493169](https://github.com/AbdullahZaher/vibress/actions/runs/40228493169) | Isolated API×2/Worker×2 ready→unready→ready on PG/Redis faults, pg_dump/pg_restore into separate test DB with sentinel verified | Redis snapshot/media/key/artifact restore, independently pinned signed replica releases, measured customer RPO/RTO and operator approval remain open |
| PLUG-OPS-04 | **Implemented, partial; live CI crash-boundary verified** — preserve durable PG dispatch lease when Redis job is published but DB acknowledgement fails | [M1A live run #40228493169](https://github.com/AbdullahZaher/vibress/actions/runs/40228493169), [event relay](../../apps/worker/src/processors/plugin-event-worker.ts) | PostgreSQL stopped immediately after BullMQ publish; persisted `dispatching` + Redis job preserved, 2-minute lease simulated as expired only for fixture, re-claim and idempotent re-publish finalization passed | Not proof of exactly-once external effects or extended high-volume fleet crash recovery |
| PLUG-OPS-05 | **Implemented, partial** — signer revocation and opt-in v2 AES-GCM plugin-secret keyring with scope+key-ID AAD, dual-read v1/v2 and guarded bounded CAS rotation for both persisted tables | [PR #89](https://github.com/AbdullahZaher/vibress/pull/89); [PostgreSQL rotation test](../../tests/integration/plugin-secret-rotation.test.ts) | Real PostgreSQL fixture tests for read-only scan, interrupted partial apply + resume, stale CAS, key rollover, wrong tenant and corrupt bytes; **new exact-HEAD CI pending** | Passing CI fixture is not a live multi-replica outage/recovery drill; no global CMS key migration or production operator sign-off yet |
| PLUG-OPS-06 | **Implemented, partial** — bounded PG receipt diagnostics, probe freshness gauge, optional Prometheus rule pack and curated publication-scoped history/atomic global lifecycle audit | [OPS-06 runbook](plugin-platform-ops06-diagnostics.md), [Prometheus alerts](../../ops/monitoring/prometheus/plugin-alerts.yml), [PR #89](https://github.com/AbdullahZaher/vibress/pull/89) | CI already green for lifecycle audit at `8228fa5`; new freshness/unit fixture and optional promtool tests authored, **exact-head CI pending** | External Prometheus/Alertmanager deployment, actual outage drills, legal retention approval, replica observability and load acceptance still open |
| PLUG-SEC-01..02 | Partial — ephemeral 4-role Ed25519 admission/revocation negatives added; authentic scanner proof pending | — | [M0 inventory](plugin-platform-m0-compatibility-matrix.md) | CI revoked signer, stale release, changed ESM and unsigned fallback rejected; actual image/restore revocation and real scanner evidence pending |
| PLUG-OPS-03 | **Implemented, partial; live CI pre-effect drill verified; post-effect crash authored, CI pending** — durable admission, retry/duplicate/tenant guards and mismatched release rejection | [M1A SIGKILL/retry run #40277366107](https://github.com/AbdullahZaher/vibress/actions/runs/40277366107), [event drill](../../scripts/plugins/drill-event-delivery.ts) | Live PG/Redis faults, BullMQ retry/dedup, cross-publication denial, digest mismatch and SIGKILL before effect passed; new second SIGKILL after a committed synthetic effect expects duplicate effect attempts; bounded poison event exhaustion is also authored (new CI pending) | External handler idempotency, extended DLQ/poison endurance, production-image signed fleet and operator acceptance remain open |
| PLUG-ADMIN-01 | **Implemented, partial** — Installed/Available/Updates/Activity sections, existing search and status filter | [8afcdff](https://github.com/AbdullahZaher/vibress/commit/8afcdff19d44ec742c3386f409baf663eb117f13), [b549798](https://github.com/AbdullahZaher/vibress/commit/b54979800cbfdbaee3c87373992c623437d4e707) | New Admin sections and operator/tenant-switch tests added; **new exact-HEAD CI pending** | Activity includes only failed deliveries, not a complete audit history; browser acceptance required |
| PLUG-ADMIN-02..04 | **Partial from baseline** — approved release summaries, capabilities, signature provenance, reviewed update preview and permission-checked lifecycle | [TrustedPluginInstaller](../../apps/admin/src/components/platform/TrustedPluginInstaller.tsx), [Admin routes](../../apps/api/src/routes/admin.ts) | Existing installer/security tests and new-vs-upgrade filters added; **new CI pending** | Full operator/migration approval and upgrade E2E needed |
| PLUG-ADMIN-05 | **Implemented, partial** — failed-event view/confirmation-gated replay, surfaced in Activity; secret-bearing error diagnostics redacted | [33b1820](https://github.com/AbdullahZaher/vibress/commit/33b1820ae7c05bb9ae06f2a9279ca0c80cce1975) | Sensitive-error regression tests added; **new CI pending** | Full audit history and Redis dead-letter drills outstanding |
| PLUG-ADMIN-06 | **In progress** — Arabic labels, responsive sections, accessible pressed-state and focus | [b549798](https://github.com/AbdullahZaher/vibress/commit/b54979800cbfdbaee3c87373992c623437d4e707) | Translation strings and component tests authored | Actual Arabic/RTL, keyboard, mobile, screen-reader acceptance pending |
| PLUG-UPD-01 | **Inert staging foundation CI verified at prior HEAD; operational acceptance pending** — operator-only immutable old/new signed-release stage descriptor, capability diff and additive durable PostgreSQL plan | [upgrade staging validator](../../packages/domains/plugins/src/application/plugin-upgrade-plan.ts), [schema](../../packages/database/src/schema/plugin-upgrades.ts) | Pure negative fixtures authored; exact-HEAD CI and fresh/upgrade migration acceptance pending | Admission receipts must originate from operator-verified read-only mounts. No public endpoint, operator approval, deployment, or installation mutation yet |
| PLUG-UPD-02 | **Partial, new exact-head CI pending** — guarded `staged → aborted` CAS with global audit transaction; all execution transitions remain disabled | [upgrade staging repository](../../packages/domains/plugins/src/infrastructure/drizzle-plugin-upgrade-plans.ts) | PostgreSQL fixture covers stale revision, wrong plugin, audit rollback and successful abort | Operator approval, safe preflight, quiescence, migration, activation and observe gates not implemented |
| PLUG-UPD-03..06 | Planned — irreversible transitions remain disabled | — | — | Fleet draining, protected approval, schema expansion/backfill, safe recovery and data-preserving lifecycle remain open |
| PLUG-SDK-01..05 | Planned | — | — | — |
| PLUG-RT-01..06 | Planned | — | — | — |
| PLUG-CAT-01..03 / PLUG-TOOL-01..02 | Planned | — | — | — |
| PLUG-MKT-01..04 | Planned | — | — | — |

Update this table as each ticket is implemented/verified; do not prematurely label M0–M6 completed or production-ready.

**Execution checkpoint, 2026-10-26:** At exact HEAD `9a5a469fe3a3c0d14ce59d31ec03bf08f6266b14`, [CI #40281671186](https://github.com/AbdullahZaher/vibress/actions/runs/40281671186) passed build/tests, E2E and container scan, and [isolated drill #40281666273](https://github.com/AbdullahZaher/vibress/actions/runs/40281666273) passed. This verifies four independently signed admission subprocesses and real API×2/Worker×2 source processes against disposable PostgreSQL/Redis faults, plus the existing pre-effect SIGKILL recovery. It does **not** constitute independent signed production-image rollout, coordinated full backup/restore, external handler idempotency, measured RPO/RTO or operator acceptance. The newly authored post-effect crash scenario requires fresh exact-HEAD CI evidence. M0 through M6 release gates remain open.

## 6. Release levels and decision authority

1. **Tier 1 Production Certified**: signed operator profile, real multi-replica rollout/mismatch fencing, PostgreSQL/Redis/artifact/key restore, incident drills and runbook proven.
2. **Professional Plugins Platform**: Tier 1 accepted + Admin/upgrade/SDK consumer conformance and support policy; no general untrusted-code claim.
3. **Tier 2 Runtime Certified**: separate OS isolation, authorized IPC, resource/egress controls, adverse fixtures and independent review.
4. **Marketplace Ready**: Tier 2 certified + signed catalog, publisher lifecycle, malware/vulnerability scanning/revocation/incident support.

A merged PR or green monorepo CI does not imply any higher level unless its individual gates have real evidence.

## 7. Immediate next execution instructions

1. Confirm current GitHub `main` and the execution branch. Start with **M0**; inventory actual code and existing documents and write only the missing, actionable compatibility/evidence artifacts.
2. In parallel only where safe, begin `PLUG-OPS-01` (multi-replica release correctness) and `PLUG-ADMIN-01` (list/search/filter UX) after M0 contracts are checked. Separate PRs when feasible.
3. Explicitly do **not** start arbitrary ZIP/GitHub install-to-run, external SDK stable publishing, Tier 2 execution or marketplace features ahead of their gates.
4. Keep LMS business logic paused. Use its external consumer contract fixtures only.
5. On each delivery, report `Status | Role Review Result | Changed | Validation run | Compatibility implications | Security/architecture result | Remaining blockers`.

**No feature implementation is implied by the creation of this planning document.**
