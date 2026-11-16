# Security, Compatibility, Reliability and Release Gates

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

## Cross-cutting P0 invariants

1. App A cannot access App B data; tenant T1 cannot access T2 via any API, worker, storage, cache, export, admin route or link.
2. No client-controlled publication/tenant/app selector can grant authorization; identity and membership are resolved on server.
3. Supported shared-Postgres tenant tables use reviewed RLS policies; same transaction/connection `SET LOCAL`, nonowner/non-BYPASSRLS roles and `FORCE ROW LEVEL SECURITY` where needed; fail closed without tenant context.
4. API/worker DML credentials cannot perform broad DDL; migration and plugin physical-storage provisioning have separate roles and approvals.
5. Generated API fields and relationships enforce read and write scopes at runtime; UI hiding is insufficient.
6. Webhook signatures and duplicate events are handled with durable inbox/idempotent effects; outbox writes commit atomically with state changes.
7. Plugin trust is explicit; signed in-process Node code is privileged trusted code, not safe for untrusted marketplace execution.
8. Secrets are scoped, encrypted, redacted, rotated and never embedded in browser; outgoing URL/upload operations apply SSRF, type, size and integrity controls.
9. HTTPS/TLS edge, origin/CSRF, cookies, rate limiting and HSTS must be verified in real deployed staging.
10. Restore, schema migration, previous-version app/Studio fixture and independent security checks precede GA.

## Required evidence suite

| Gate | Verification |
| --- | --- |
| Application and tenant isolation | two-app/two-tenant integration + HTTP/worker negative tests |
| Database roles and RLS | direct nonowner Postgres connection tests, pool reuse, transaction isolation |
| Generated API | unauthorized row/field/relation/search/export tests and bounded query budgets |
| Plugins | untrusted payload denial, tampered SHA, signer/capability mismatch, crash recovery |
| Event reliability | duplicate webhook, queue reconnect, worker crash and end-state assertions |
| Backward compatibility | pinned CMS/Studio document, billing, media, publication and migration tests |
| Release quality | SAST, dependency/image scan, SBOM, CI URLs, independent review, real backup restore |

## Baseline disclaimer

The [2026-11-13 Vibress Security Review](../../SECURITY-REVIEW.md) recommends **conditional launch**, records disabled RLS, incomplete external staging/edge verification and no independent penetration test. [Studio readiness](https://github.com/AbdullahZaher/vibress-studio/blob/main/docs/production-readiness.md) likewise does not certify production. This roadmap must not be presented as remediation already executed.

## GA acceptance

No known unresolved Critical/High findings inside the independently audited scope; if not satisfied, block GA. Benchmark results and recovery measurements include exact release SHAs, environment, fixture, p50/p95/p99, measured RPO/RTO and limitations. Explicit approved final release decision is necessary.


## Security review correction: stricter scoped execution gates

**G0 (before new runtime work):** ADR for **application-per-installation v1 topology**, trusted principal/tenant model, database role boundary and CMS compatibility signed by owners. Prototypes remain isolated until G1 passes.

**G1 (before public tenant data):** Under actual Postgres and normal runtime credentials, demonstrate server-verified app+tenant context; transaction-local session setting on the **same** connection; fail closed without context; block every tenant-owned query via generic `getDb()`; reject tenant switches in nested transactions; test pool reuse and long-lived workers. Use `USING`/`WITH CHECK`, app+tenant identity and composite constraints. Session variables are **defense-in-depth, not authentication** for arbitrary SQL-capable code.

**G2 (before code generation/CLI use beyond staging):** Validate canonical schema input, allowed identifiers/types, generated SQL ownership, migration preview/approval and installer isolation. Deny arbitrary DDL and unsafe default expressions; test relation/filter/aggregate/count/search/export side channels and SSR cache keys.

**G3 (before extensions):** Public Plugin SDK compatibility evidence; signed immutable trusted release checks; no untrusted in-process module. Separate plugin provisioner/owner from HTTP runtime, with audited grant migrations.

**G4 (before GA):** CMS+CRM Golden Apps, reproducible external clean install, cross-repo Studio fixtures, authenticated staging, restore rehearsal, independent security assessment and explicit approval. No automatic certification and no arbitrary zero-loss downgrade claim.

See [DB/RLS authority](DATA-ISOLATION-AND-MIGRATIONS.md), [architecture decisions](ARCHITECTURE-DECISION-GATES.md), and [v1 mandatory scope](V1-SCOPE-AND-RELEASE-CRITERIA.md).

## Data lifecycle and custom application checks

- Exposed **custom application HTTP handlers and web pages** are subject to the same identity, tenant context, authorization, CSRF/origin as applicable, request schema, SSR/cache and rate-limit checks as generated CRUD. Never give low-trust extension code unrestricted SQL or secrets.
- Tenant export and offboarding verify owner authorization, background-job revocation, signed-URL expiry, secrets/tokens rotation, search/cache/object cleanup and audit/recovery retention, including documented backup expiration caveats.
- Event envelopes carry a schema version, stable event/idempotency ID, trusted app/tenant scope and compatibility policy; consumer replay and poison-event handling must be tested.
- SLO/SLI and operational restoration limits are **proposed then measured**, never declared fulfilled by writing targets. See [data lifecycle](DATA-LIFECYCLE-AND-OPERATIONS.md).

## Third-pass mandatory runtime permission checks (R26–R34)

- **Function grants:** query effective `has_function_privilege`, `PUBLIC` and inherited grants, `SECURITY DEFINER` owners/search_path and default privileges for new and existing Postgres functions. A role-specific REVOKE is not sufficient if PUBLIC still grants access.
- **RLS:** verify permissive OR/restrictive AND composition when a second policy exists. Prove deny for missing/switched tenant, owner/BYPASSRLS, `TRUNCATE`, `REFERENCES` and relation/constraint information side channels using ordinary ACLs plus RLS.
- **Physical apps:** two app installations with distinct PG/Redis/object-store credentials cannot read/write each other's resources or backups. Merely separated SQL role names/Redis key prefixes/storage paths do not count.
- **Code trust:** explicitly accept trusted app-author code and vetted Tier-1 plugins as privileged within installation; test hostile end users cannot reach SQL or runtime secrets. Do not claim tenantUnitOfWork/GUCs sandbox arbitrary server SQL.
- **Cross-app integration:** issuer/audience/scope and revocation for service accounts, signed/idempotent inbound webhooks, outbound SSRF/egress restrictions and dead-letter replay isolation.
- **Release skew:** old/new API + workers + web + schema + module ABI + event versions must pass the defined compatibility matrix, with migration-backfill fault recovery and real RPO/RTO evidence.

See [ACL/RLS test matrix](POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [installation trust](APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling upgrades](UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).

## Fourth-pass security and recovery acceptance

- **PostgreSQL views (R35):** verify actual view owner vs invoking user RLS behavior, and `security_invoker` on supported versions. If materialized views or reports are supported, ensure copies and export functions cannot expose another tenant. Otherwise document that they are unsupported.
- **RLS-aware backups (R36):** distinguish tenant-scoped export from full-installation backup, use separately audited backup identity, detect filtered queries, verify row counts/checksums for at least two tenants after restore and measure actual RPO/RTO.
- **Nested unit-of-work (R37):** current Drizzle transaction runner has no nested savepoints; test swallowed inner errors, rollback-only outer state, prohibited tenant switch, retry and outbox atomicity.
- **Legacy CMS migration (R38):** use two-publication and `pub_default` fixtures to prove Application/Tenant mapping, Studio document serialization, media links, subscriptions, delayed jobs and safe migrations.
- **Program delivery (R39):** link the first viable slice to existing M00–M08 Epics, assign named owners and require immutable code/test evidence before accepting milestones.

[Fourth review](FOURTH-PASS-REVIEW-2026-11-14.md) · [RLS/views/backup/transactions](RLS-VIEWS-BACKUP-AND-TRANSACTIONS.md) · [CMS mapping](LEGACY-CMS-IDENTITY-AND-MIGRATION.md) · [first slice](EXECUTION-FIRST-SLICE.md). None of these future tests has been executed as part of this documentation change.


## International security standard verification scope (design only)

- **NIST SP 800-218 SSDF v1.1 (PO/PS/PW/RV):** explicitly assign security requirement owners, supply-chain source protection and software signing, threat models, code review, testing, vulnerability disclosure/response procedures and incident learning. Current [SECURITY.md](../../SECURITY.md) is a baseline, but version coverage must be reconciled with the eventual Framework release; do not assume an organizational SSDF assessment.
- **OWASP ASVS v5.0.0:** maintain an exact versioned requirement-to-test matrix for supported Admin, API and external CRM user journeys. Include auth/session, CSRF, injection, SSRF, file handling, generated authorization, tenant RLS, view owner context and privileged SQL functions. **No ASVS verification is yet claimed**; owners select risk-appropriate assurance and independently verify at M08.
- **SLSA v1.2:** choose Source/Build track and target level explicitly, validate actual signed provenance/attestations and artifact digest, protected workflow/source and SBOM before claiming supply-chain level. A green ordinary CI run alone is insufficient.
- **ISO/IEC 27001:2022:** manage information assets, risk treatment, access control, incident response, retention, supplier risk and restoration as organizational ISMS work, not a document-level ISO certificate.
- **ISO/IEC 25010:2023 + WCAG 2.2:** set measured product quality and AA-target accessibility tests for supported Admin/CRM UI; automated assertions **plus manual keyboard/screen-reader/RTL** validation where applicable.

[Standards matrix](INTERNATIONAL-STANDARDS-ALIGNMENT.md) · [conditional design baseline](FINAL-DESIGN-BASELINE-APPROVAL.md) · [open release evidence](RELEASE-EVIDENCE-AND-DECISION-REGISTER.md). **No application security implementation is completed by this text.**

## Additional negative tests

- Generated data: bulk mutations, aggregation/count/filter side channels, nested relation traversal, privileged field projections, unbounded sorting/pagination, SSR/service cache leakage.
- RLS and privileges: app A/B deployments, tenant X/Y, missing context, attempted client context spoof, nested transaction identity switch, SQL injection/raw access path, pool reuse, owner/BYPASSRLS tests, unauthorized `CREATE` and unsafe function execution.
- Migrations: malicious model/default, namespace collision, checksum drift, concurrent deployment race, partial backfill, timeout and documented forward-fix.
- AI/cloud: cross-app tool delegation, prompt-injection source, stale approval, secrets exposure, tenant misrouting, quota/runaway costs and deployment identity escalation.

**Release condition:** The v1 release candidate may be rejected by reviewers. Record accepted audit scope, owner, immutable artifact digest, exceptions, observed RPO/RTO and support limits. A passing CI run is insufficient.
