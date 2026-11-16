# Release Versioning, Runtime Support & Cross-Repository Compatibility

> **Proposed contract and discovered baselines, not an approved release manifest.** The current binding policy is [ADR-013: Unified SemVer](../14-decisions/release-versioning-strategy.md). This document does **not** silently supersede ADR-013 or change existing package, Docker or host version numbers.

## Verified source baselines and the naming conflict

| Surface | Current source observation (2026-11-14 baseline) | Risk and required decision |
| --- | --- | --- |
| Root monorepo `package.json` | `version: 1.2.0`, `engines.node: >=24.0.0 <25`, pnpm 11.22.0 | A new roadmap target labelled **“Platform v1.0”** is **not** permission to retag the existing published or deployed Host history. |
| Database and Plugin SDK package manifests | `version: 1.2.0`; `@vibress/plugin-sdk` has `private: true` | Need stable publishable SDK/package namespace, public ABI, compatibility and migration policy before public external use. |
| `compose.dev.yml` and `compose.prod.yml` | PostgreSQL `16-alpine`; Redis `7-alpine` | This is a **tested-baseline candidate**, not a comprehensive support or patch-level certification for Platform GA. |
| `compose.prod.yml` | `VIBRESS_VERSION: ${VIBRESS_VERSION:-1.0.0}` | A deployment default can disagree with `package.json` v1.2.0 and artifact SHA: release metadata must come from a verified pinned release, not an unrelated fallback. |
| ADR-013 | Unified SemVer and `vX.Y.Z` tags with API/worker images and plugin compatibility | An independently versioned Framework 1.0.0 requires a **formally approved amendment/superseding ADR**; never reuse existing tags or silently overwrite history. |
| Vibress Studio | Separate repo/editor artifacts and schema/document formats | Pin exact tested Host+Studio versions and runtime integration commit SHAs; no assumed shared release cadence. |

Source anchors: [root package](../../package.json), [database package](../../packages/database/package.json), [Plugin SDK package](../../packages/plugin-sdk/package.json), [production compose](../../compose.prod.yml), [development compose](../../compose.dev.yml), [ADR-013](../14-decisions/release-versioning-strategy.md).

## M00 decision: product name vs artifact version

**Default until ADR approval:** call the delivery **“Vibress Framework — first code-first GA”**, *without asserting an actual `v1.0.0` tag*. `M08` stays a program milestone ID, not a version. Existing Host release versioning follows ADR-013 and its current SemVer lineage.

Before M07 public SDK packaging or M08 GA, explicitly choose ONE version architecture:

1. **Unified versioning:** all supported Host/Framework packages follow the existing release SemVer/tag lineage. “First code-first GA” is a feature/program milestone in that lineage; it need not be `1.0.0`.
2. **Independent Framework release stream (only after approved ADR):** introduce non-colliding named releases/tags/package versions, lifecycle and CI with an explicit compatibility matrix to the existing Host and plugin ABI. Never pretend the existing Host's `v1.0.0` tag can be reassigned.

Decision record must include registry package name reservations, stable SDK exports, CLI binary names, CI provenance, supported upgrades and responsible release owner.

## Candidate v1 tested runtime matrix (not blanket support)

| Dependency | Candidate reference baseline | Gate before claiming support |
| --- | --- | --- |
| Node.js | 24.x (currently mandated by root engines) | Exact minor/patch in release CI; package templates/CLI and runtime compatibility demonstrated |
| pnpm | 11.22.0 from root `packageManager` | Reproducible clean install using frozen lockfile |
| PostgreSQL | 16.x from current Compose | Real RLS, view-owner policies, backups, DDL/migration recovery, actual role/connection pool tests on each approved minor |
| Redis | 7.x from current Compose | Worker/jobs/replay, Redis ACL isolation and reconnect tests |
| Drizzle ORM | Existing locked dependency, not assumed portable to future adapters | Pin lockfile/commit, verify nested transactions and migration behavior |
| Studio | Exact source and editor schema revision recorded by M00 | Host/Studio compatibility, Yjs persistence, locale and document restore tested |
| Linux/containers/self-hosting | Current Compose is a baseline candidate | Reproducible clean install, network/TLS/secrets, measured restore and rollback |

Do **not** claim Windows, ARM, Kubernetes, a different database or all PostgreSQL 15–18 versions merely because the TypeScript sources can compile. PostgreSQL `security_invoker` is available in PG15+, but behavior must be proven on the **actual supported PG version**.

## Compatibility manifest required at release

Every Framework GA candidate publishes a machine-readable manifest containing:

- Host version, Framework release identifier, repository commit SHA and artifact digest.
- Plugin SDK package version, runtime ABI and admitted module versions/signatures.
- CLI and Node/pnpm support, PostgreSQL and Redis patch levels, supported deployment topology.
- API/OpenAPI schema versions; event producer/worker versions; DB migration epoch/checksum.
- Tested Studio commit/schema version, supported compatibility window, deprecation and upgrade policy.
- Source/runner links for tests, security/DR assessment, observed RPO/RTO, reviewers and final GO/NO-GO.

Build scripts must compare health endpoint/manifest/package/container metadata and fail on mismatched `VIBRESS_VERSION` or artifact digest. A sample is provided in [Release Evidence & Decision Register](RELEASE-EVIDENCE-AND-DECISION-REGISTER.md).

**No changes to current runtime versions, build manifests or production Compose are made by this documentation plan.**
