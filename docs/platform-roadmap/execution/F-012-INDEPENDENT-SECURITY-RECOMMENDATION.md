# F-012 — INDEPENDENT APPLICATION SECURITY RECOMMENDATION

> **Final integrated decision criteria (2026-11-16):** see [F-012-FINAL-DECISION-PACKAGE.md](F-012-FINAL-DECISION-PACKAGE.md). This recommendation is NOT owner acceptance of Option B.

> Agent 03 AI-assisted recommendation, 2026-11-16. Reviewed PR #166 baseline `a96ea073767e303b02121d87558adbd12ce111f3`. **No risk acceptance or human sign-off is implied.**

## Recommendation and security boundary

**Choose Option A (legacy CMS PostgreSQL FORCE RLS + verified transaction scopes) as the target for any shared/multi-tenant deployment. Do not accept Option B as a substitute for database-enforced isolation in a shared-risk hosting model.**

Option B may be considered **only** for strictly self-hosted, single-operator installations with no untrusted external tenants, no privileged customer plugins, no cross-installation credential sharing and independent evidence for every CMS ingress. The existing `PLATFORM_TOPOLOGY` gate applies to the **reference serving executable**, not automatically to the legacy CMS API/worker. The DB owner and Project Owner must expressly accept and time-limit the residual if they authorize this posture. Current disposition: **F-012 BLOCKED; neither option is approved for production by this document.**

## Comparison by trust boundary

| Data / path | Option A: legacy CMS RLS | Option B: application isolation only |
| --- | --- | --- |
| Publications / workspaces | `FORCE RLS` and verified publication/workspace scope on every ORM query | Request middleware filters publication; SQL owner/worker bypass possible |
| Admin API / privileged mutations | Membership/role checks plus DB policies; provisioner kept separate | Admin service account and server checks become sole boundary; IDOR/role mistakes cross publications |
| CMS users / sessions | Isolation policy for scoped rows; global identity directory separately controlled | Publication-specific session/role checks; session or staff-lookup bug may leak cross-publication |
| Media, files, signed URLs | SQL owner metadata scoped; S3 bucket IAM still required independently | App routes and object-key prefixes only; S3 shared credential bypass remains |
| Studio / Lexical / Yjs | Persisted documents and collaboration room ownership verified before DB access | Websocket room and document keys require independent authorization each message/reconnect |
| Workers, outbox, queues | Scoped DB writes in workers plus separate Redis ACL identities | Async jobs can bypass HTTP checks; job payload's tenant ID is not authoritative |
| Plugins / extensions | Scoped DB runtime privileges and reviewed migrations; plugin sandbox separately required | Compromised trusted plugin may use broad `vibress_app` DML/CREATE permissions |
| Sharing, publishing, export | Authorization at object + relation layers, cross-publication copy has explicit capability | Application-only checks for every read/export/share operation and generated artifact |
| Analytics, reports, views | `security_invoker` views, prohibit materialized/foreign surfaces absent separate proof | Reporter and owner SQL may cross scopes; R35 only guards reference runtime |
| Backups and restores | Offline trusted backup operator with all rows, restore/tenant integrity checks | Same backup authority but shared storage/key may leak entire installation |
| Multi-installation storage | Both DB RLS and physical S3/Redis/queue credential boundary tested | Must remain physically isolated per installation; prefixes are insufficient |
| Operational impact | High migration/refactor risk; staged expand/backfill/validate and full compatibility retest | Lower immediate code migration risk but higher residual disclosure blast radius |

## Required conditions before Option B can even be considered

1. Exact supported deployment topology and data/trust assumptions signed by DB owner, AppSec and Project Owner; no public hosting, external tenant onboarding or untrusted customer plugins.
2. Enforce the same single-installation prohibition in **all** deployed processes (legacy API, worker, Studio websocket, media, preview), not only `apps/platform-reference/src/main.ts`, and test boot refusal for each.
3. Show negative cross-publication tests for sessions, staff/admin, posts/pages, Yjs rooms/document snapshots, exports/imports, media metadata and object keys, jobs/outbox/webhooks, plugin storage, analytics and backup access.
4. Enforce separate Redis ACL, bucket policy, queues and worker identities with actual denied operations. Verify cross-installation and cross-publication operations, not mere prefixes.
5. Disable direct SQL access from plugins and external customers; use a carefully scoped backend API and server-side permission checks on every object.
6. Document lateral-movement/credential compromise blast radius and incident response; prove production backup/restore and rollback and all independent signatures.
7. Record explicit owner risk acceptance with scope, rationale, mitigation, expiry and Agent 06 concurrence per governance gate. **No such acceptance is recorded.**

## Option A implementation acceptance criteria

Inventory every legacy CMS table and service dependency; apply `ENABLE` and `FORCE RLS` with negative tests, route all CMS data access through verified transaction context, segregate owner/migration/runtime/worker/reader identities, audit views/functions under R26/R35 and prohibit privileged bypass. Verify existing CMS and Studio compatibility and full rollback on disposable production-shaped data. Changes to grants and migrations require DB owner + independent concurrence; this document authorizes none.

## Evidence / limitation

The [existing F-012 record](F-012-CMS-RLS-DECISION.md) admits that migration 0054 covers only platform tables; CMS uses the unscoped pooled `getDb()` path. `packages/database/src/runtime-role.ts` grants legacy role public-schema CREATE and DML on all public tables. `apps/platform-reference/src/topology.ts` rejects unsupported topology for the reference process only. Existing `runtime-multi-publication-isolation.test.ts` and fixture reports are relevant but do not independently establish all surfaces above; no tests were rerun here.

Sources checked 2026-11-16: [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [OWASP API Top 10](https://api-security.owasp.org/editions/2023/en/0x11-t10/), [PostgreSQL 16 RLS](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).
