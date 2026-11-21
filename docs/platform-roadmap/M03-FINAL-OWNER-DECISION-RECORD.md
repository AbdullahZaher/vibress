# M03 — Final Owner Decision Record (D-01 / D-02 / D-03)

**Status:** DRAFT — proposed dispositions; not an approved ADR. Recorded 2026-11-21. M03 OPEN; production NO-GO; risk acceptance NONE.

**Frozen implementation:** a49d0379da06749ef5f163d9e48e9a053d2a375b; tree 419ebd78ebd2294dd7c2482d5fed6f78ec462b5e. This document is not a new implementation certificate.

**Authority:** Project Owner / Agent 01 owns proposals and final conditional decision, Agent 02/03/04/05 provide written specialist findings, human DBA/IAM approval is independently required for D-03, Agent 06 is independent and reviews only approved evidence. No agent/human sign-off is inferred from the preparation of this file.

## D-01 — Generic READY V2 principal + tenant recovery fence

**Original requirement:** M03 E07/E11 scope-safe signed operations, real old/new API and Worker compatibility with in-flight jobs, restricted recovery, tenant ownership. The [original milestone](milestones/M03-schema-data-engine.md) does not explicitly demand a production-wide arbitrary principal/tenant transaction fence across every API/Worker after PITR.

**Current implementation:** restricted test/reference signed API/Worker admission, epoch/installation identity and scoped READY_V2 support; [admission source](../../packages/database/src/schema-operator-experimental-admission.ts) explicitly excludes general V2 serving registration. [Independent reviewed evidence](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-7062090919).

**Unsupported:** general production API, background jobs or custom authenticated transactions after physical recovery across arbitrary principals, tenants and tokens. Never interpret a refusal as evidence of a complete generic fence. Unapproved post-PITR generalized admission stays prohibited.

**Recommendation:** DEFER_TO_EXISTING_FUTURE_RUNTIME_MILESTONE (PROPOSED). Existing [M04 API/Admin milestone](milestones/M04-api-admin-generator.md), [Issue 156](https://github.com/AbdullahZaher/vibress/issues/156), owns generalized generated runtime/authentication coupling (Agent 05 IAM lead plus M04 API/Worker owner). Existing [M08 readiness](milestones/M08-v1-release.md), [Issue 160](https://github.com/AbdullahZaher/vibress/issues/160), owns production physical recovery, independently measured RPO/RTO and release admission. No new milestone, V2 authority redesign or M04 Batch 03 execution is authorized.

**Future gates:** exact-scope signed principal/tenant/role identity per transaction; lease and epoch binding; revoked principal/session/token refusal; negative cross-tenant/role/SSR/cache tests; real PG16 PITR retained/rewound timelines; multi-version queued Worker, race/replay and idempotency; CI, alerts, rollback and independent Agent 06.

**Security:** generic authorization could violate tenant isolation or admit a stale principal. Fail closed until those gates hold. **Agent 05 formal assessment PENDING; owner scope approval PENDING; Agent 06 decision-specific concurrence PENDING.** Independent reviewer previously deemed such generic functionality outside the explicit original M03 requirement; that is not an approval of this proposed record.

## D-02 — Backfill PITR / recoverable operator plan

**Original:** M03 E06/E09 requires additive backfill, durable progress, interrupted operations that fail safely **with a recoverable operator plan**, and reviewed forward-fix. It does not explicitly demand automatic authenticated backfill continuation after physical PITR.

**Existing code:** signed bounded per-tenant Backfill; data, chunk journal and target progress in one PostgreSQL transaction; exact same-operation replay idempotency, monotonic target progress, signed revision/authority checks; unknown COMMIT ACK fences further execution; read-only settlement refuses inconsistent data. Authenticated continuation accepts only PROVISIONING/BUSINESS, **not BACKFILL**.

**Unproven:** post-PITR retained-vs-rewound partial Backfill with external authority reconciliation and executable operator-authenticated forward-fix. This is safety-relevant, not merely a missing warning. STOP/refusal is not enough by itself to prove the original recoverable-plan exit requirement.

**Recommendation:** RESTRICTED_OPERATOR_RECOVERY **only after executable evidence and independent review**. See [bounded recovery runbook](M03-BACKFILL-RECOVERY-OPERATOR-RUNBOOK.md). Until then D-02 is a BLOCKING decision, not an approved deferral. Missing capability: authenticated operator reconciliation and allowed recovery/forward-fix from partially rewound Backfill, without fabricating chunk outcomes.

**Ownership:** Agent 02 PostgreSQL for persisted evidence + actual PITR test, Agent 04 SRE for physical WAL lineage, recovery drill and rollback; Agent 01 owner decision; Agent 06 independent certification. Production-grade DR remains M08-E04/E12. No implicit automatic resume.

**Status:** Agent 02 verdict PENDING; Agent 04 verdict PENDING; owner acceptance PENDING; Agent 06 recertification PENDING. Any newly required implementation is separately authorized minimal additive work on the experimental branch, with exact-SHA PostgreSQL/CI and new Agent 06 review.

## D-03 — Migration 0061 restricted trusted-owner policy

**Original:** M03 E09/E10 additive migration, CMS Publication ownership preservation, functional role restrictions, auditable operator correction and restore/forward-fix evidence.

**Verified:** 0061 additive SQL; PK/FK/UNIQUE/digest checks; restricted SECURITY DEFINER function search_path; runtime row DML/TRUNCATE denial tested; owner DELETE refusal; trusted owner UPDATE and possible TRUNCATE remain. [Source](../../packages/database/migrations/0061_legacy_cms_publication_identity.sql); [exact PG16 logical restore](https://github.com/AbdullahZaher/vibress/actions/runs/44831801713). This is not ordinary runtime privilege escalation.

**Proposed policy:** installation/application/publication and original workspace ownership immutable during routine mapping reconciliation. Only reviewed counts/digests/provenance metadata may be corrected via separately authorized, audited transaction after verified backup and before/after evidence. No automatic rebind or pub_default Tenant substitution. Runtime and ordinary operator TRUNCATE forbidden. Owner and superuser cannot be claimed to be constrained by a mutable row trigger. See [DBA/IAM record](M03-MIGRATION-0061-DBA-IAM-GOVERNANCE.md).

**Enforcement decision:** PENDING: either existing restricted trusted-role boundary is explicitly accepted by required authorities or a new additive role separation / statement-TRUNCATE and immutable-key guard is mandated before canonical use. No rewrite of 0061, no DDL authorization by this decision package.

**Statuses:** Agent 02 DBA PENDING; Agent 05 IAM PENDING; named independent human DBA PENDING; named independent human IAM PENDING; owner sensitive authorization PENDING; Agent 06 confirmation PENDING.

## Approval register (blank fields are not signatures)

| Decision | Recommended owner disposition | Actual owner approval/reference | Specialist approvals | Agent 06 |
| --- | --- | --- | --- | --- |
| D-01 | Scoped future M04 + M08 | PENDING / none | Agent 05 PENDING | PENDING |
| D-02 | Restricted recovery only if tested | PENDING / none | Agent 02 and 04 PENDING | PENDING |
| D-03 | Constrain operator policy, decide additive enforcement | PENDING / none | Agents 02/05 and independent human DBA/IAM PENDING | PENDING |

Before sensitive decisions record written risk assessment, specialist verdict plus Agent 06 concurrence, verified backup and tested rollback, least-privileged time-limited scope, decision rationale and expiry. No HIGH/Critical risk accepted. Formal M03 engineering close remains NOT AUTHORIZED. Existing Policy A, P05/R1, P06/E2-A, D1 2517ms restricted, M NOT DETERMINABLE, DELTA-08 and M04 Batch 03 prohibitions are unchanged.

**Sources checked 2026-11-21:** [PG16 ownership](https://www.postgresql.org/docs/16/ddl-priv.html), [PITR](https://www.postgresql.org/docs/16/continuous-archiving.html), [trigger semantics](https://www.postgresql.org/docs/16/trigger-definition.html), [PG16.16 release 2026-11-12](https://www.postgresql.org/docs/release/16.16/).
