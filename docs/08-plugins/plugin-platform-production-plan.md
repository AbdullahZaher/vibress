# Plugin Platform — Production Completion Plan

**Status:** Active engineering plan, not a release certification.  
**Baseline:** `main` at `9203783d47e056b43f942c133c2ac26b6e5ade94` (2026-10-24), including merged PR #86.  
**Owner:** Vibress core platform. **Excluded:** LMS feature development (paused); compatibility checks only.

This is the current work plan for making Vibress plugins a professionally operated, self-hostable product. The existing [implementation roadmap](external-extensions-roadmap.md), [security operations standard](external-extensions-security-operations.md), [SDK release gates](external-sdk-release-gates.md) and [trust-model ADR](../14-decisions/plugin-trust-model.md) remain the detailed contracts. The order below expresses dependencies, **not** committed release dates.

## Verified starting point

- Operator-approved ESM release discovery is available at `GET /api/admin/v1/plugins/trusted-available`; registration is available at `POST /api/admin/v1/plugins/register-trusted`. Neither endpoint downloads or installs executable code.
- The operator controls a v1 lockfile with pinned SHA-256 ESM/Admin UI bytes. Detached Ed25519 lockfile attestation is verified when configured, and mandatory under `VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE=1`. Legacy unsigned operator lockfiles remain compatible in deployments without that policy.
- `Add Plugin` is visible to platform plugin operators, not ordinary publication plugin managers. Global activation and publication enablement are distinct.
- External trusted JavaScript runs inside the API/Worker Node.js process. Package integrity and SDK capabilities **do not sandbox** it. There is no supported untrusted plugin marketplace or browser-based ZIP/GitHub install.
- The SDK is not yet a published stable third-party release. Existing installed plugins, DB migrations, public/member/admin routes, themes and multilingual content are compatibility contracts.

## Trust tiers and non-negotiable boundaries

**Tier 1 — Operator-trusted packages (current):** Reviewed and deployed by the self-hosting operator as immutable, pinned artifacts. The operator controls the approval source and signing key, never the plugin or the Studio browser. These packages have Node process privileges; only install code the operator is prepared to trust with API/Worker secrets and availability.

**Tier 2 — Independently isolated third-party extensions (future, not shipped):** Require a separate threat model and ADR, supervised process/container or equivalent isolation, restrictive filesystem/network/secret access, resource quotas, IPC authentication, capability mediation, and cross-tenant tests **before** accepting arbitrary publisher uploads or marketplace code. Do not call `node:vm`, import restrictions or Promise deadlines a security sandbox.

Source discovery (registry/Git URL/ZIP) is **not** executable-code admission. Every source must pass immutable artifact verification, operator approval and deployment preflight first. Publication staff may only enable an already globally installed/activated package where explicitly authorized.

## Phase 1 — P0: Trusted distribution and installation

1. **P0-1: Accurate approved-release catalog (first increment).** Return the actual operator-reviewed capabilities to Studio and distinguish a verified detached signature from an explicitly legacy unsigned lockfile. Display both truthfully with operator acknowledgement. Preserve older API response compatibility. No remote fetch, DB change or execution.
2. **P0-2: Immutable distribution metadata.** Introduce a versioned, operator-controlled catalog of release ID, digest, publisher, compatible Host/SDK range, capabilities, provenance/SBOM pointer and approved migrations. Trust roots remain external to artifacts. Design and schema require review before implementation.
3. **P0-3: Admission workflow.** Operator stages downloaded/build outputs **outside** running API, scans dependencies, verifies signature/checksum and migration plan, then pins and deploys them consistently on API and Worker replicas. Never run npm lifecycle scripts or imported code during inspection.
4. **P0-4: Installation lifecycle UX.** Expose only operator-approved releases with meaningful status: available → registered → globally active → enabled for current publication. Report disabled, incompatible and failed states, plus safe recovery guidance.
5. **Exit gate:** Fresh and upgraded installations preserve existing records; tampered/mismatched/unapproved releases fail closed; registration cannot grant publication access; multi-replica deployment preflight matches; staff lacking global operator authority is denied.

## Phase 2 — P0: Runtime trust and containment

1. Publish a current threat model and exact limits of privileged in-process ESM.
2. Make signed-mode operator deployments a documented production profile without silently invalidating existing unsigned self-hosted installations. Surface unsigned legacy status truthfully; provide a staged opt-in upgrade playbook.
3. Design Tier 2 execution isolation as a **separate ADR** before coding any untrusted install path. Address resource exhaustion, compromised secrets, network access, process crash/hang, IPC, capability controls and per-release revocation.
4. **Exit gate:** Static/runtime negative tests, malicious package acceptance tests in an isolated fixture, verified operator upgrade/rollback and documented trust/incident response.

## Phase 3 — P1: Professional Admin plugin experience

1. Search/filter/details for approved and installed releases: version, provider, capabilities, compatibility, verified provenance, publication state and error/recovery steps.
2. Distinct global install/activate and per-publication enable flows, each permission-checked server-side; keyboard, responsive, screen-reader, Arabic/RTL and long-name tests.
3. Avoid unsafe embedded HTML; preserve iframe Host authorization and theme/SDK ABI.
4. **Exit gate:** Staff/operator capability matrix, cross-publication denial, accessible end-to-end flows, no storage/secret exposure.

## Phase 4 — P1: Updates, migrations and recovery

1. Compare old/new pinned immutable releases, compatibility/capability diffs and approved migration plan **before** any lifecycle transition.
2. Provide staged/canary rollout, Host/Worker replica coordination, admission draining, idempotent job processing, documented forward-fix/rollback limitations and data-preserving uninstall.
3. Prove signed artifact/database/Redis restore, encryption-key rotation and incident response against existing populated installs.
4. **Exit gate:** Interrupted upgrade, concurrent lifecycle, wrong-version workers, retry/duplicate, tampering, backup/restore and zero-data-loss tests.

## Phase 5 — P2: Developer ecosystem

1. Reconcile canonical SDK and legacy plugin-core consumers; publish an independently installable versioned SDK only after contracts and conformance tests are frozen.
2. Provide local scaffolding/build/sign/verify tooling and independent example plugins that import public SDK contracts only.
3. A marketplace or automated third-party publisher installation is gated on **Tier 2 real isolation** and its completed security review; an operator-trusted curated catalog can ship earlier.
4. **Exit gate:** Independent external consumer tests, backwards compatibility matrix, docs/examples, two-theme i18n/RTL and Docker acceptance.

## Working agreement and verification

For each increment: inspect affected consumers → role review (Architect, Security, API, DB, Plugin/Theme, i18n/RTL, QA as relevant) → smallest compatible change → focused security/functional tests → package/API/admin checks → inspect diff and run release gates. Do **not** rewrite released migrations, relax auth/tenant checks, or modify LMS beyond directly necessary compatibility fixes.

Use [external SDK release gates](external-sdk-release-gates.md) as the authoritative production blocker checklist. **A merged PR, green CI or this document alone is not production certification.**

## Progress

| Increment | Status | Evidence |
| --- | --- | --- |
| Baseline and risk review | Completed for planning | 2026-10-24 source review on `main` |
| P0-1 accurate approved-release catalog | Implemented on branch; not release-certified | `feat/plugin-platform-trust-catalog-20261024` (signed/legacy metadata, capability display, regression tests; validation pending) |
| P0-2 versioned release metadata | Implemented on branch; validation pending | Operator-pinned metadata + preflight evidence checks; no direct installation or execution |
| P0-3 secure operator staging/admission | Implemented on branch; validation pending | Signed admission receipt and strict evidence/migration check, local replica equivalence gate; no distribution orchestration |
| P0-4 installation lifecycle UX | Planned | No implementation claim |
| Phase 2 through Phase 5 | Planned | Requires separate reviewed increments |
