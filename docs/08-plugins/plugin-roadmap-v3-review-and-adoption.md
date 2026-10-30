# Plugins Roadmap v3 — Security, Compatibility and Adoption Review

**Review date:** 2026-10-28  
**Target:** PR #89 Draft branch `feat/plugin-platform-roadmap-execution-20261024`  
**Reviewed inputs:** v3 proposal documents, PR #89 implementation ledger, merged PR #96 Native contracts and public SDK surface.  
**Status:** Documentation review and remediation; **not** an application penetration test, a release approval or an integrated runtime certification.

## Review summary

This revision corrects misleading or incomplete aspects of the initial roadmap and turns them into explicit, verifiable gates. The table identifies **design/acceptance risks**, not confirmed exploitable production vulnerabilities.

| ID | Severity if ignored | Finding and observable basis | Documentation remedy | Unresolved proof |
| --- | --- | --- | --- | --- |
| REV-01 | Critical | Tier 1 signed ESM is still process-privileged; SDK capability names and Native rendering are not runtime isolation. | Explicitly separate operator-trusted code from Tier 2 OS-isolated code and require operator attestation, fleet pinning and incident authority. | Tier 2 penetration acceptance before arbitrary publisher code. |
| REV-02 | High | The M0–M6 implementation ledger and the proposed roadmap use different ticket names; merging the two would falsely imply completion. | v3 ticket IDs labelled planning aliases; original `PLUG-*` ledger remains the factual implementation/evidence source. | Maintain approved ID mapping when tickets are implemented. |
| REV-03 | High | The merged Native UI feature is **default-off** pending production operator approval, though its Host/SDK code and automated CI exist. | Separate `Merged`, `CI Verified`, `Operationally Accepted`, `Released`; keep read/write allowlists independent and default-off. | Signed release/operator consent and actual canary/rollback exercises. |
| REV-04 | High | Future `define*` helpers and `schemaVersion: 2` appear in an otherwise concrete developer SDK guide. | Label vNext sketch NON-RUNNABLE; insert current `PluginModule`/v1 authoring-shape example and distinguish package semver, runtime ABI, descriptor version. | Independent strict-TypeScript compilation and protocol approval before creating the APIs. |
| REV-05 | Critical | Native view metadata could be mistaken for authorization to read/write plugin data. | Define session, Origin/CSRF, role, effective publication, capability, digest and resource/record checks per operation; separate Host-owned routes and domain write actions. | Adversarial API, cross-publication, stale/duplicate action E2E. |
| REV-06 | High | Invalid Native descriptors, revoked releases or stale browser state could trigger a leaking fallback or expose a prior publication. | Fail closed on denied/malformed Native; preserve iframe only for compatible legacy absence; bind cursors and clear in-flight UI/drafts across publication/role/release changes. | Slow-response publication switching, revocation, mixed API replicas and multi-tab tests. |
| REV-07 | High | A signed package or a security scanner is not sufficient provenance or a safe ZIP/Git install path. | Quarantined non-executing staging, path/symlink/hardlink/bomb/dependency limits, immutable bytes, revocation, independent signatures and TOCTOU checks. | Retained signed artifacts, real malware/supply-chain and key-compromise drill. |
| REV-08 | Critical | Read-only queue/upgrade snapshots are not an exclusive distributed fence; exactly-once external side effects are not guaranteed. | Specify durable fencing, CAS, at-least-once delivery with actual-handler idempotency, PostgreSQL/Redis queue coordination and forward-fix strategy. | Live 2 API + 2 Worker signed-image rolling upgrade and effect-after-commit crash drills. |
| REV-09 | High | A partial PG restore does not prove recoverability of plugin media, secrets, Redis, signed images and worker queues. | Require coordinated backup/restore with independent hashes, key custody, runbook owner, RPO/RTO measurement and populated upgrade/restore. | Complete operator disaster-recovery sign-off. |
| REV-10 | Medium | Existing v1 labels require `{en, ar}` while a general BCP-47 model is only proposed. | Additive locale/catalog revision with version negotiation; preserve old labels and test bidi spoofing, keyboard, accessibility and browser fallback. | Multi-locale external consumer + RTL browser checks. |
| REV-11 | High | Native SDK is `private: true`, despite an existing packaged test fixture. | Treat bundled external conformance as evidence only, not an independently published stable SDK; require public exports and ABI negotiation policy. | Public-release acceptance and versioned sample app. |
| REV-12 | Medium | PR #89 diverged from `main` after PR #96 merged; overlapping CI, lockfile, migrations, API contracts and locales exist. | Explicit integration and historical migration rules; don't resolve by overwriting Native files or disabling CI. | Conflict-free integrated HEAD, exact SHA CI/E2E and full scoped diff review. |

## Cross-repository impact and compatibility policy

- **Existing installations:** Preserve plugin records, v1 manifests, stored settings/secrets, revisions, member data and old schema migrations. Migration `0046_member_avatar` must not be rewritten; `0047` and `0048` remain additive in PR #89 pending integration.
- **Old Host and Plugin:** Keep `adminViews`, `adminNavigation`, iframe/scalar modes and old runtime ABI behavior. A new required Native feature fails with an explicit incompatibility and never gains additional privileges through fallback.
- **Current Native Host:** Retain Host-rendered `stat`/`field-list`, bounded storage models, explicit forms and paired domain workflow. Page metadata is inert and must remain strictly validated.
- **Runtime and release identity:** Distinguish signed operator catalog metadata, exact entrypoint digest, API/Worker image provenance, plugin manifest version, SDK package version and Native wire schema version.
- **Self-hosting:** No unapproved SaaS dependency; Docker/PostgreSQL/Redis backup/restore, TLS reverse proxy, offline operation, key rotation, revocation and multi-replica deployment remain required release checks.

## Review evidence and limitations

- [Merged PR #96](https://github.com/AbdullahZaher/vibress/pull/96) provides Native implementation and automated acceptance. Previous [CI #40750645560](https://github.com/AbdullahZaher/vibress/actions/runs/40750645560) succeeded on `63b540f825e6e6ea8112318edbea3a5574481156`, **not** on the later combined PR #89 + current main state.
- [Draft PR #89](https://github.com/AbdullahZaher/vibress/pull/89) before this documentation update was at `41cbeb4c782f549ec94212a5e3e5b037fc44b353`, with unresolved merge conflicts. [M1A isolated drill #40764205512](https://github.com/AbdullahZaher/vibress/actions/runs/40764205512) succeeded on that SHA; the [full CI #40764205787](https://github.com/AbdullahZaher/vibress/actions/runs/40764205787) was in progress **at review time**.
- The review compares documentation, selected Host, SDK and Native contract source files and GitHub metadata. It did **not** run a merged checkout, penetration test, fresh database migration, rollback or live production-image drill. Do not interpret this report as security certification.

## Adoption and update policy

1. Add [Unified Roadmap v3](plugin-platform-master-roadmap-v3.md) and [Native Admin SDK proposal](plugin-native-admin-sdk-spec-v1.md) as forward-looking references without erasing the original [execution/evidence ledger](plugin-platform-master-execution-plan.md).
2. Retain existing exact-commit verification links and mark future ticket aliases as proposals. Record a mapping to prior `PLUG-*` IDs when a v3 ticket is implemented.
3. Reconcile #89 with current `main` through a reviewed merge; do not rewrite released migration files or silently replace new Native routing/contract changes.
4. Before approving a stable SDK or enabling Native production allowlists, capture Architect, Security, API, DB, i18n/RTL, QA and Operator approvals **for applicable gates**, including independent external consumer tests.
5. Keep PR #89 Draft, preserve branch history and do not merge/publish or enable executable install-to-run from documentation alone.

**Documentation-specific acceptance:** links resolve in the target branch, all hypothetical helpers are labelled, trust tiers and CI status are accurate, version semantics do not conflict, and only documentation paths are changed. All substantive runtime security/operational acceptance remains open.
