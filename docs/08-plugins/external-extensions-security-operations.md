# External plugin security and operations standard

**Status: PROPOSED design controls.** Apply when implementing the external extension host. Current accepted policy remains trusted/bundled code only.

## Trust model

Trusted extensions run with significant Node/process privileges. Import restrictions and JavaScript timeouts are not a containment boundary. An attacker-controlled `npm` package in the API image is **not** confined by `PluginContext` or `hasCapability`. Never permit untrusted ZIP/npm installs from the Admin UI in v1. For untrusted publisher code, mandate separately reviewed container/WASM/microVM design with real filesystem/network/secret isolation and admission controls.

### Package supply chain

- Operator allowlist; pinned semver, lockfile, cryptographic artifact hash and immutable release record; audit dependencies and SBOM before deployment.
- Reproducible build; avoid untrusted lifecycle/install scripts in production; reject source/path escaping, malicious symlinks, excessive artifact size, unexpected binaries.
- Attest publisher and sign releases where supported. Check checksum before loading, not just on manifest registration.
- Configuration is explicit for Docker and reverse proxies; no hidden hosted registry requirement.
- Revoke compromised releases with an operator procedure: disable, roll back image where safe, rotate credentials, incident record and notify affected publications.

## Authentication and authorization

- Host resolves publication and principal **before** calling any extension handler; an ID in a URL or event is never sufficient authorization.
- Admin routes: `requireStaffSession`, `requirePermission`, `validateOrigin` on state changes. Member routes: `requireMemberSession`, own-member checks, CSRF/origin and service-side entitlements. Machine calls require exact scopes; never exchange staff and member cookies.
- Domain policies must recheck ownership; deny by default and return 404 where resource existence is private.
- Permit only named capabilities with verified call-site guards; test each denial path and cross-publication access through both API and background jobs.
- Render no unsafe HTML; sanitize Liquid models and translations; CSP, upload validation, private lesson media signed short-lived access. No cross-origin cookie leaks.

## Data protection and migrations

- Core-managed member IDs are publication-owned; plugin rows use explicit `publication_id` and ownership constraints including compound lookups and unique indexes.
- Plugin migration registry tracks package version and last applied migration; immutable forward-only scripts, retry/backfill behavior, lock footprint for production datasets, dry-run/preflight and recoverable failures.
- Apply a two-phase strategy for breaking schema changes (expand → backfill → switch code → contract after supported older code retires); no schema rollback promise if irreversible.
- Disable and standard uninstall never delete course, student, billing or settings data. A separate purge requires owner authorization, export, confirmation, audit and recovery procedure.
- Backups include plugin tables, settings encryption keys and media references; restore a snapshot with an independently pinned matching plugin package; test point-in-time recovery.
- Secrets encrypted at rest with rotation story, masked in Admin, strictly plugin/publication scoped; environment secrets never forwarded into plugin-visible logs.
- Retention/delete/export policy for learner PII, assessments, certificates and audit records; support applicable operator privacy requirements.

## Reliability and scaling

| Failure | Expected outcome |
| --- | --- |
| Invalid/untrusted artifact | Reject before code load and keep previous release available |
| Plugin activate error | Record visible error, do not advertise routes or degrade unrelated core services |
| Hung handler | Host request deadline/circuit breaker; process isolation only if deployed in separate process |
| Webhook replay/out-of-order | Event identity persisted; idempotent consumption; no duplicate enrollment/refund |
| Queue crash/retry | Durable retry, stable job IDs, dead-letter inspection, idempotency on write |
| Disable during job | Stop admission, drain/lease outstanding work, preserve resumable state |
| DB migration failure | Fail enable/upgrade closed, capture migration state; restore backup or forward-fix |
| Core upgrade incompatibility | Block unsupported module load and report actionable operator error |
| Public web theme lacks LMS slot | Accessible default page; canonical/SEO unchanged |

Instrumentation: record plugin ID, artifact release, publication, request/event ID, latency, error code and queue state. Bound cardinality and redact PII. Provide health for plugin integrations without tying Vibress global readiness to third-party provider availability.

## Required verification gates

1. Runtime schema and manifest fuzz/negative tests; unsafe archives and mismatched hashes rejected.
2. Auth matrix: unauthenticated, wrong role, wrong publication, disabled plugin, expired member, invalid origin and unauthorized course media.
3. Fresh install + upgrade from existing `plugins`/`plugin_settings` rows; failure injected between stages; data equality after retry.
4. API/worker load tests, retry/duplicate tests, startup without optional plugin, restore and disabled-state behavior.
5. RTL, keyboard, semantic HTML, long translations, accessible media/player, safe SEO metadata.
6. CI security audit and Docker self-hosted test. Manual threat-model sign-off before merging the first external runtime.

## Operator-facing runbook (to be implemented)

`verify artifact → deploy staged package → DB snapshot → compatibility/preflight → migrate → enable canary publication → smoke tests → broader enablement → monitor`.

Rollback: first decide whether schema is backward compatible. If yes, switch to previous pinned release and re-enable. If no, forward-fix under incident procedure or restore a tested backup (including plugin-owned data and events). Never automatically delete migrations or corrupt student records.

Related: [architecture](external-extensions-architecture.md), [contracts](external-extensions-contracts.md), [roadmap](external-extensions-roadmap.md).
