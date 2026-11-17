# M03-S03 — Agent 05 Identity Provenance and Revocation Remediation (INCOMPLETE)

**Date:** 2026-11-17. **Baseline:** `a4a8eb8290950cec3079d89f49ca965c7298f29b`. **PR:** #198. **Findings:** AG06-S03-01 P1, AG06-S03-04 P2. **Merge:** NOT AUTHORIZED. **Production:** NO-GO.

## Verified root cause
Migration 0059 permits caller-populated `platform_schema_plans.author` and `platform_schema_approvals.approver`. The operator compares strings but does not prove who authenticated to PostgreSQL to write them. A login with overlapping effective INSERT privileges can forge independent names. The fixture has distinct login roles, but those fixture grants do not establish a production privilege contract. Neither `current_user` nor `SET ROLE` is sufficient proof of human identity. The operator also previously read approval without an explicit row lock.

## Patch included on this isolated branch
The operator's approval SELECT now uses `FOR UPDATE` in its existing SERIALIZABLE transaction, held through DDL, registry compare-and-swap, journal insertion and COMMIT. This is **defense in depth**, not a verified concurrency certification. PostgreSQL may raise serialization errors for concurrent updates; the operator currently maps pre-COMMIT errors to a sanitized UNAUTHORIZED failure. No production code path is enabled.

## Required identity design — NOT YET IMPLEMENTED
1. Create a **new additive migration** (never rewrite 0059) adding immutable DB-observed `author_session_login` and `approver_session_login` (or an independently validated external actor attestation) to plan/approval records, with a documented upgrade/backfill refusal policy. Do not trust arbitrary session GUC values or client-supplied actor fields.
2. Route plan creation and approval through separate tightly privileged database-owned entrypoints or independently authenticated server authorization, stamping `session_user` only when the login is a dedicated, individually authenticated actor. If pooled shared service accounts are used, `session_user` proves only the service, **not the human**; require verified signed external approval evidence bound to issuer, subject, purpose, digest, operation, installation, environment, operator and expiry.
3. Enforce `author_identity != approver_identity` using trusted immutable actor identifiers. For PostgreSQL logins, deny a session capable of both plan creation and approval even if role inheritance or SET ROLE enables both. Guard against overlapping effective privileges and role switching at the trusted entrypoint; deny role membership combinations and unauthorized direct table writes. Database superusers/table owners are outside ordinary ACL controls and require independently controlled provisioning.
4. Make approval creation, expiry, revocation and immutable provenance updates occur only through trusted procedures. Revoke direct INSERT/UPDATE/DELETE on approvals from PUBLIC, runtime, worker and operator, and restrict plan/registry writes. Record append-only audit events via a separate durable channel for denied/rolled-back attempts.
5. Enforce the revocation linearization contract: (a) committed revocation before authorization row lock => deny; (b) execution acquires approval lock first => revocation blocks until execution commits/rolls back, then records its own event; (c) serialization abort => fail closed and retry only on a fresh transaction with a fresh authorization check. The approval row lock alone does not solve untrusted provenance.

## Required PostgreSQL 16 verification (NOT RUN)
Execute all 17 specified positive/negative cases in a disposable PG16 database. Include direct and inherited dual-grant logins, SET ROLE switching, forged author and approver strings, actual revocation UPDATE racing with the operator, expired/cross-installation/digest replay, runtime/worker denial, and exact catalog+journal checks after failures. Use two connections and synchronization barriers; assert SQLSTATE and observed commit order, not elapsed sleep timing. Inspect effective ACLs including PUBLIC, owner bypass, default privileges and inherited grants.

## Role/grant target matrix
| Actor | Plans | Approvals | Revocation | Registry | Journal/DDL |
| --- | --- | --- | --- | --- | --- |
| Individually authenticated plan author | trusted create only | deny | deny | deny | deny |
| Distinct authenticated approver | deny | trusted create only | approved revocation path | deny | deny |
| Operator | read only | SELECT FOR UPDATE only | deny | bounded CAS update | journal INSERT and bounded DDL |
| API runtime / Worker | deny | deny | deny | deny | deny |
| Provisioner / DB owner | trusted deployment and grants | trusted provisioning | controlled break-glass | controlled | controlled |

## Approval lifecycle
`ABSENT -> APPROVED -> REVOKED` or `APPROVED -> EXPIRED`; execution does **not** restore revoked approval. A completed journal is immutable and retains its historical authorization evidence even after revocation. No unrevocation through clearing `revoked_at` should be permitted in the production contract.

## Independent evidence and open gates
- Code inspection and branch patch: **DONE**.
- New trusted provenance migration and provisioning: **OPEN / P1**.
- Real PG16 concurrent revocation and dual-grant tests: **NOT RUN / P2**.
- Agent 02 effective-grants and migration approval: **PENDING**.
- Agent 06 independent retest of integrated SHA: **PENDING**.
- Typecheck, lint, integration, schema regressions: **NOT RUN on this branch**.
- No production access, migration application, role alteration or human approval occurred.

**References consulted 2026-11-17:** https://www.postgresql.org/docs/16/sql-set-role.html ; https://www.postgresql.org/docs/16/role-membership.html ; https://www.postgresql.org/docs/16/explicit-locking.html ; https://www.postgresql.org/docs/16/applevel-consistency.html .

**Agent 05 verdict:** AG06-S03-01 OPEN; AG06-S03-04 OPEN; identity provenance NOT VERIFIED; self-approval/dual-grant/concurrency INCOMPLETE. NO-GO.
