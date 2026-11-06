# Vibress Studio 9+ — Host Integration and Release Acceptance Plan

**Status:** PROPOSED — NOT A DEPLOYMENT APPROVAL  
**Version:** 1.0, 2026-11-06  
**Scope:** Vibress CMS host-side work required for an independently defensible 9+/10 Vibress Studio publishing experience.  
**Full cross-repository plan:** [Vibress Studio — World-Class Editor 9+ Delivery Plan](https://github.com/AbdullahZaher/vibress-studio/blob/main/docs/roadmaps/world-class-editor-9-plus-plan-2026-11-06.md) (becomes available at `main` after its documentation PR merges).  
**Supporting historical assessment:** [Host integration evidence](production-integrity-evidence-2026-11-06.md) and [Studio's 2026-11-06 program audit](https://github.com/AbdullahZaher/vibress-studio/blob/main/docs/audits/world-class-editor-program-2026-11-06.md).

> **Separation of responsibilities:** Studio owns the document/editor/renderer/package contract; the Host owns publication persistence, reconciliation, authorization, durable media, revision restoration, real-time provider lifecycle, operational safety and rollout. This is a release-gate runbook, not a replacement for a published architecture decision.

## 1. Baseline and evidence

At the 2026-11-06 snapshot:

- Host [PR #130](https://github.com/AbdullahZaher/vibress/pull/130) merged; subsequent cover-image request sequencing and legacy publication display fixes entered the integrated branch.
- Studio [PR #34](https://github.com/AbdullahZaher/vibress-studio/pull/34) merged and its previous candidate CI passed, but that does **not** certify the current combined release candidate.
- Host `main` reference at inspection: `08a727486eaa20d922b3decfee5cf8cff5e5d54b`; [workflow #42277615501](https://github.com/AbdullahZaher/vibress/actions/runs/42277615501) was in progress at that inspection. Inspect the final conclusion and rerun on each new release SHA.
- A historical test suite exposed stale DB/Yjs restoration behavior; default collaborative restore was safely disabled in the UI. That interim gate must not be treated as a finished restore protocol.
- Historical 7.1/10 score is an **earlier provisional evaluation**, not an estimate rerun on merged HEADs.

**No existing report, green unit run, or merged PR alone certifies production readiness.** Capture actual final head, CI URLs, skips, traces, environment and reviewer decisions for the chosen candidate.

## 2. Host delivery tracks

| Track | Priority | Required host delivery | Exit evidence |
| --- | --- | --- | --- |
| H0 — CI and content parity | P0 | Resolve all relevant final-candidate integration/browser failures, including legacy published documents, translations, media and output | Complete required CI; real publish + reload in both LTR/RTL |
| H1 — Save and conflict integrity | P0 | Epoch-guarded Post/Page save, durable feature-image PATCH, ordered metadata authorization, correct 409 handling | Database/API A-B race, reconnect, first-create retry, exact snapshot |
| H2 — Coordinated Yjs restoration | P0 | Fenced server-authoritative protocol for versions and CRDT room reset/recovery | Multi-peer, reconnect, crash/replay and DB/CRDT convergence |
| H3 — Offline/crash draft recovery | P0 | Privacy-scoped local draft policy, truthful state and revision conflict UX | Browser kill/offline/quota/multi-tab/logout acceptance |
| H4 — Publish/preview parity | P1 | Reliable draft preview, safe published HTML, media + localized SEO, current version | Browser/server parity for all supported cards |
| H5 — Arabic/mobile/a11y | P1 | Supported locales, toolbar/soft keyboard responsiveness, accessible host dialogs/status | Manual supported-device and screen-reader matrix |
| H6 — Performance + security | P1 | Real device INP/preview profiling, authorization checks, safe logs, dependency review | Approved budgets, perf traces, security evidence |
| H7 — Staging + rollback | P1 | Test upgrade/backout, durable media, DB, revisions, CRDT and draft retention | Signed staging runbook and monitored rollout decision |

Treat statuses as NOT VERIFIED until tied to passing evidence on the candidate SHA.

## 3. Exact data-integrity contract

The host must:

1. Persist canonical Studio documents by version and preserve unknown envelope/editor/card fields. Reject unsupported editable payloads with original data available for recovery.
2. Keep `replacementId` as explicit root replacement authorization; keep `revisionId` informational; use a **source-ordered**, monotonically increasing `metadataRevision` where accepted envelope-only changes are required. The ordering must not derive from HTTP completion order.
3. Coordinate `expectedVersion`, first-create POST/PUT, autosave/manual save, post/page A→B→A navigation, aborts and error messages without losing the most recent author edits.
4. Prevent an in-flight cover-image PATCH from persisting a stale cover over a newer one; display unsaved failures and allow retries without claiming the latest selection was saved.
5. Separate editor content from durable cover/media metadata so published media refs, alt text and captions remain stable.
6. Publish/read older supported content through **explicit, read-only compatibility adapters**; never silently drop unsupported marks or blocks and never automatically rewrite a row during public rendering.
7. Keep authorized restore, authorization, tenant boundaries, audit log and storage lifecycle in host-owned services, not hidden client-only behavior.

### Required automated sequences

| Test ID | Scenario | Invariant |
| --- | --- | --- |
| SAVE-01 | Send save A, type B, acknowledge A, save B | B never becomes false Saved; reload yields B |
| SAVE-02 | A→B→A page/post switch with delayed old load/PATCH | Only latest active epoch may update UI |
| SAVE-03 | 409/content conflict and failed first-create PUT | No duplicate POST or lost local draft |
| SAVE-04 | Metadata-only authoritative revision and stale echo | No metadata regression or root replacement |
| MEDIA-01 | Cover A then B, responses out of order and offline retry | Server final cover B; failure disclosed |
| CONTENT-01 | Historical translated post, unsupported rich block, future schema | Supported content renders; unsupported input preserved/rejected without silent truncation |
| PUBLISH-01 | Arabic/English localized slug, preview and published page | Matched safe output, correct locale SEO, no 500 |
| TENANT-01 | Cross-publication content, Yjs restore, saved local drafts | No cross-tenant access or private data leakage |

Every case must be executed against real API/PostgreSQL where it matters, plus browser acceptance when UI state is part of the invariant.

## 4. Coordinated Yjs restore: implementation protocol to approve

**Known failure mode:** restored PostgreSQL content can be overridden by a retained Yjs room when a browser remounts or reconnects.

**Design requirements, not a claim of implemented behavior:**

- Authorize restore and validate publication/post identity and requested revision.
- Define authoritative document epoch (fencing token), immutable restore operation ID and write barrier. Block or reject saves from old epochs across REST and websocket layers.
- Ensure crash-recoverable durable coordination of PostgreSQL revision state and stored CRDT room state. Design and test recovery from a process crash at each stage.
- Notify active clients of the new epoch and reconcile disconnected/rejoining peers. An old client may present its edits for explicit conflict resolution but cannot silently replay an older epoch.
- Make restore idempotent; do not report success before durable state and client rejoin contracts are satisfied.
- Audit lifecycle and failures **without storing raw document contents, tokens or private media URLs in logs**.
- Preserve the existing safe disable gate until the complete protocol is implemented and explicitly accepted.

**Mandatory matrix:** two/three browser clients, simultaneous typing, offline old peer, server and Redis restart, retry/timeouts, duplicate operation ID, unauthorized user, cross-publication request, mixed cards/media, reload and final DB/Yjs equality. Stale restoration is a P0 release blocker.

## 5. Offline local drafts: security and UX policy to approve

A browser recovery store (for example, IndexedDB) should be **best-effort**, explicitly scoped and bounded:

- Key by site/publication, authenticated user, document ID and base version/epoch; do not retain one account's drafts for another account after logout.
- Debounce and checkpoint recoverable snapshots without pretending the server has saved them. Report local-vs-server state clearly.
- On reload/reconnect, compare server revision, collaborative epoch and local base; prompt rather than auto-overwriting a newer remote draft.
- Handle quota exceeded, denied storage, private mode, eviction, corrupt entries, stale tabs, account switch and recovery deletion.
- Apply retention/size limits and privacy review; browser storage is not an encrypted or guaranteed backup by default.
- Do not auto-replay a local snapshot into a restored CRDT room until its epoch is reconciled.

**Acceptance:** an approved browser/device scenario matrix shows recovery of the latest *recoverable* draft and transparent failure states, without cross-user/tenant leaks.

## 6. Editorial product and competitive acceptance

Publish a protocol for identical author tasks in Vibress and Ghost (where product scope overlaps): create long article; rich formatting; paste Arabic/English; insert/replace gallery; move/undo block; embed; recover offline work; preview on mobile; publish/translate/reload.

Record task completion time, success/error counts, help required, frustration and author satisfaction. Include representative Arabic and English authors with documented device expertise. Proposed target: **>=95% task completion** for the defined core-workflow study, pending Product approval of sampling and methodology.

Provide screen-reader/manual acceptance for VoiceOver, NVDA and TalkBack where supported. No automatic WCAG 2.2 AA certification is implied by browser or axe tests.

## 7. Performance, staging and rollback

**Proposed budgets requiring approval:** real-user INP p75 <=200 ms, p95 ordinary keystroke processing <50 ms under a documented device/workload, bounded memory/preview costs, and published stress results for 20k/50k-word documents. Separate editor commit from preview, autosave and HTML conversion timing.

Before release:

1. Pin **both** Studio and Host exact commit/dependency SHA.
2. Execute frozen installs, strict consumer types, core/integration/HTTP/browser tests, security and publication locale checks on the candidate.
3. Rehearse staging upgrade from representative older content and collaborative state; verify full serialized envelopes, media refs, translations, revisions and per-document privacy.
4. Rehearse rollback with DB/CRDT/media/draft convergence checks, not just package rollback.
5. Test monitoring, status indicators, failure alerts, support runbook and disaster recovery.
6. Record named Engineering, Product, QA, Security, Accessibility and Release approvals, or explicitly documented exclusions.

No production deployment or unauthorized merge is authorized by this document.

## 8. Release gate scoreboard

| Gate | Needed to pass | Initial status |
| --- | --- | --- |
| G0 | Final paired SHAs/CI, ADR-0001 ownership and architecture review | NOT VERIFIED for next candidate |
| G1 | Save/conflict/legacy data exactness | PARTIAL / REVERIFY |
| G2 | Coordinated restore and stale-peer fencing | BLOCKED |
| G3 | Offline/crash draft recovery | NOT VERIFIED |
| G4 | Strict installed consumers and publish/export compatibility | PARTIAL / REVERIFY |
| G5 | Human author tasks and core UX | NOT VERIFIED |
| G6 | Arabic real devices and WCAG manual acceptance | NOT VERIFIED |
| G7 | Approved real-device response/perf budget | NOT VERIFIED |
| G8 | Security, dependency and privacy sign-off | PARTIAL / REVERIFY |
| G9 | Staging release/rollback with named sign-off | NOT VERIFIED |

No **9+/10** claim if a mandatory P0 gate is open. Update scores by the full Studio [weighted scorecard](https://github.com/AbdullahZaher/vibress-studio/blob/main/docs/roadmaps/world-class-editor-9-plus-plan-2026-11-06.md#6-objective-quality-scorecard); a scoring calculation is not an authorization to release.

## 9. PR acceptance template

Every host PR must document: exact base/head SHA, source-level evidence, before/after reproduction, strict host+Studio contract effects, targeted and broader CI run links on **final SHA**, confirmed regression cases, unverified/manual steps, rollback/data safety, log privacy, explicit reviewer and unresolved risks.

**Suggested first host PR slices:** (A) CI + published translation/media parity; (B) Yjs restore protocol and replay fencing; (C) offline local draft/409/epoch recovery; (D) preview/RTL/device acceptance; (E) staging rollback and signed gates.

This document tracks **proposed work**, not completed deliverables. Owners, dates and pass/fail claims must be filled from exact execution evidence rather than inferred from historical reports.
