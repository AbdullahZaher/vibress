# F-012 FINAL A/B DECISION PACKAGE — Agent 03

**Date:** 2026-11-16 · **Repository:** AbdullahZaher/vibress · **Integrated baseline:** `fdcc3986b0b5be26ee57540e55b213f1ddb4cc79` (PR #176) · **Status:** OWNER DECISION NOT RECORDED / NO-GO.

This is an **AI-assisted AppSec recommendation**, not authorized human AppSec approval, DB-owner approval, Agent 06 concurrence, or acceptance of a security risk. This document requests an explicit **Project Owner choice** after receiving specialist evidence. It changes no production configuration.

## 1. Decision to make

- **Option A — legacy CMS PostgreSQL RLS:** apply `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` to applicable shared CMS tables; transaction-bound server-verified publication scope; separate owner, migrator, runtime, worker and backup privileges. **Required for shared / untrusted multi-tenant hosting**, after migration rehearsal, scoped compatibility tests, and independent sign-off. **NOT YET IMPLEMENTED.**
- **Option B — restricted self-hosted single-installation CMS:** retain server-authorized publication isolation only within one trusted operator's deployment and retain **F-012 as an OPEN residual**. Do **not** mistake reference-process `PLATFORM_TOPOLOGY` for a guard on the legacy API, worker, Studio WS or media processes. **NOT CURRENTLY ACCEPTABLE** until those controls and tests are implemented, risk accepted by the owner and Agent 06 concurs.

## 2. Comparative decision matrix

| Boundary | Option A: defense in depth | Option B: narrower, conditional deployment | Evidence / mandatory control |
| --- | --- | --- | --- |
| Cross-publication content/workspaces | PostgreSQL filters tenant-owned rows even if a route forgets a WHERE clause | API/workspace code must filter every request; compromised SQL runtime can read/write other publications within installation | `packages/database/src/runtime-role.ts` grants all public table DML; existing `0054` covers platform only |
| API BOLA / direct object ID | Server-side object permission **and** table RLS | Server checks alone; fail-closed non-disclosing 404 and deny foreign IDs for every read/write | Full posts/pages/comments/search and generated endpoints denial matrix |
| Admin roles, membership and sessions | Scoped membership/role checks, role ceiling + RLS for tenant-owned records; global identities handled separately | Session and actor-to-target publication authorization on every mutation, including inviting staff | Invite escalation, cross-publication staff list, CSRF, session revocation regression |
| Studio/Lexical/Yjs | Publication-scoped documents, room authorization and RLS for persisted data | Validate WS handshake **and every reconnect/write/restore/replay**; only server can bind publication | Test foreign room join, diff replay, offline document restore, revocation |
| Media and file keys | Scoped DB metadata + independent S3 IAM/presigned URL segregation | Same app metadata checks, plus independently denied cross-prefix keys and strict signed URL scopes | Full `/content/media/*`, upload, exports/imports and backup paths |
| Workers/BullMQ/Redis | Verified tenant scope for DB jobs + distinct worker/producer Redis ACL and queue prefixes | Workers can bypass HTTP authorization: **must** rehydrate membership/installation and use separate credentials | Actual BullMQ enqueue/consume/retry/replay deny; synthetic Redis keys insufficient |
| Plugins and extensions | Capability-granted plugin execution, separated DB identity, reviewed migrations and RLS | No untrusted plugin allowed direct SQL, Redis, S3 or privileged app process execution | Threat model for plugin SDK, native actions, dynamic endpoints |
| Billing, invoices, entitlements | Object authorization and scoped billing tables, payment/webhook reconciliation | Payment identity and publication ownership checked server-side at every mutation/report/export | Prevent cross-publication billing exports and price/plan updates |
| Reporting, views, analytics | Invoker-safe views + explicit review of SECURITY DEFINER / materialized / foreign / reporting identities | Owner/reporting creds can bypass application filtering; ban direct tenant-facing reports without scope proof | R35 runtime guard **does not** inspect all non-runtime view consumers |
| Backups/migrations/restore | Migration scope expansion with DB owner review, rollback; backups restored and tenant/foreign keys checked | Lower migration complexity; backup remains an all-publications privileged snapshot; restore may mix publications | Independent restore/PITR test with publication data integrity and encryption-key segregation |
| Hosting and installation isolation | Shared tenants may be considered only *after* actual full evidence | Strict one installation, one trusted operator, no public/shared tenant hosting, no external onboarding | Enforce in every serving, websocket and worker process, not only reference |
| Operational complexity | High short-term: table policy inventory, routing refactor, R26/R35 audit, compatibility and migration risk | Lower DB migration but costly ongoing coverage: every new API/plugin/worker feature creates an authorization obligation | Threat-model and route inventories on each change |
| Residual security risk | Remaining owner/superuser bypass, worker IAM, cross-installation and backups; cannot claim zero | Broad SQL runtime credential compromise means multi-publication breach; untrusted tenants are prohibited | Explicit high-risk acceptance prerequisites, expiry and Agent 06 concurrence |

## 3. Prohibited configurations under Option B

**Forbidden:** shared SaaS/multi-tenant offering; externally enrolled customer tenants; customer-supplied executable plugins; using `vibress_app` as a tenant-facing SQL identity; shared redis or storage root credentials across installations; production static bearer tokens; publishing analytics/materialized views without reviewed tenant-safe authorization; use of owner's DB credential in serving processes. Physical isolation per installation remains mandatory, even when installations are run by one operator.

Reference app's guard in `apps/platform-reference/src/topology.ts` refuses unsupported `PLATFORM_TOPOLOGY`, external onboarding, and production static-token mode. **This does not prove the legacy `apps/api/src/main.ts` or worker process has an equivalent fail-closed topology gate.** The final B gate must exercise an actual boot of each process using forbidden topology and observe nonzero exit **before** binding network listeners or credential usage.

## 4. Option A entry/exit criteria

1. Agree on publication/workspace identity model, table ownership inventory, billing/global directory exceptions, background jobs, and a zero-trust migration contract; DB-owner and AppSec design verdicts.
2. Rehearse additive policy/transaction migration on a **disposable production-shaped** PostgreSQL 16.16+ fixture; no production mutation in this work package.
3. Check `FORCE RLS` against a non-superuser owner; prohibit `BYPASSRLS` and session owner switching; test reads/writes/cascades, reports, functions and all extensions.
4. Redirect CMS `getDb()` paths to verified Unit of Work where required, with explicit scope for admin, collaboration and workers. Do not retrofit FORCE RLS blindly (existing CMS would fail closed).
5. Run full CMS + Studio compatibility, Yjs document roundtrip, billing, media, export and worker outbox suites; prove correct negative cases.
6. Separate Redis/S3/BullMQ IAM and production IdP/session authorization independently. Test full backup, restore, operational rollback and post-release alerts.
7. Agent 02, Agent 03 (independent of implementation), Agent 04/05 as appropriate, and Agent 06 submit written exact-SHA verdicts; Project Owner makes final disposition.

## 5. Option B entry/exit criteria (all mandatory, not proven)

1. Runtime topology enforcement in legacy API, worker, WS and media, **including a spawned-process negative test**; restrict all customer onboarding.
2. CMS staff/admin, per-publication session, publication switch, posts/pages/comments/search, Yjs/Studio, uploads/signed URLs, billing, analytics/export and plugins negative E2E matrix.
3. Real per-installation SQL runtime, producer, worker, Redis ACL and S3 identities; direct bypass denied or explicitly constrained; no customer-controlled plugin code on privileged process.
4. Reliable audit logging, incident containment, rollback, monitored backup/restore and documented data exposure blast radius.
5. Written risk assessment of the **unavoidable credential-level cross-publication exposure**, mitigation, limited deployment scope, owner, **expiry date**, rollback, plus Agent 06 concurrence; only then Project Owner may explicitly choose Option B.

## 6. Formal owner decision (currently unfilled — no approval)

| Decision field | Current record |
| --- | --- |
| Proposed AppSec model | **A for any shared/untrusted hosting; B only if all restrictions are proven and accepted** |
| Final choice by Project Owner | **NOT RECORDED** |
| DB specialist verdict for exact deployment | **BLOCKED / NOT PRESENT** |
| Independent Agent 06 concurrence | **NOT PRESENT** |
| Actual tested recovery + backup | **NOT PRESENT** |
| High risk acceptance (if B), expiry | **NONE** |
| Hosting allowed now | **No new production authorization** |
| Go/no-go for F-012 | **BLOCKED** |

No default choice is implied by leaving this section blank. It is forbidden to convert this recommendation to accepted risk without every governance condition.

## 7. Auditable sources

- Repository: [F-012 original record](F-012-CMS-RLS-DECISION.md), [R26 assessment](R26-INDEPENDENT-TECHNICAL-VALIDATION.md), [resource isolation](W1-T06-RESOURCE-ISOLATION-VERIFICATION.md), [runtime role](../../../packages/database/src/runtime-role.ts), [reference topology](../../../apps/platform-reference/src/topology.ts).
- PostgreSQL 16 [row security](https://www.postgresql.org/docs/16/ddl-rowsecurity.html) (checked 2026-11-16); [CREATE VIEW](https://www.postgresql.org/docs/16/sql-createview.html) (checked 2026-11-16).
- OWASP [API1 BOLA](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/) (checked 2026-11-16).
