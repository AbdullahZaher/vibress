# M03 PR #213 — Three-finding remediation, policy and recertification dossier

Status: ENGINEERING CANDIDATE / **NOT INDEPENDENTLY CERTIFIED**. Production: **NO-GO**.
Scope: \`experiment/m03-remaining-functional-exec-20261119\`, Issues #155, #165, #197.
Starting SHA: \`8651f27d98a196d444406108f635fb764a8119db\`;
starting Git tree: \`5219f08989998f9b5dd3746cc845707ca1c6380d\`.
Baseline: \`96442be5a1b02d3fbe922e082344f49f4fa854b0\`.
Only final exact SHA workflow evidence can close these findings.

## Finding 01 — relational integrity

Independent finding: P1, missing parent/child transaction coordination.
Test-first RED: \`b525d4e5b6038f49d20de6c7ef3a1242b4491c86\`,
[actual PostgreSQL job 136612885275](https://github.com/AbdullahZaher/vibress/actions/runs/44830195278/job/136612885275).
The barrier-controlled test failed at L510:
\`AssertionError: expected undefined to match object { code: '55P03' }\`.
This demonstrates the parent soft-delete did not wait for an in-flight child verification.
The test uses two real scoped database transactions and only holds a barrier after
an actual PostgreSQL result; it does not synthesize query results.

Remediation: child create/update locks each live relation target with
\`SELECT ... FOR SHARE\`, ordered by table/id, in the same caller-owned transaction
as the child write. Parent soft-delete updates \`deleted_on\` with a conflicting
\`FOR NO KEY UPDATE\` row lock and checks live children before commit.
\`FOR KEY SHARE\` is insufficient for this non-key update.
Both transaction orderings, lock timeouts, existing tenant FK/CAS, rollback,
outbox rollback, and cancellation/deadlock behavior remain exact-SHA acceptance gates.
**No GREEN/closure until the relevant PostgreSQL job is verified.**

## Finding 02 — Legacy CMS Outbox

The inventory classifier now distinguishes historical flat payloads and
envelopes with \`version = 1\`, matching event type and nested payload.
It rejects unsupported versions, malformed payloads, conflicting nested/top-level
ownership and unrecognized publication identities. Events with no publication
are counted separately as unscoped, included in the overall inventory digest
and never attributed to \`pub_default\`. The SQL reads rows via grouped counts;
no historical event id, status, payload or delivery semantics are changed.
For legacy-only, fully scoped inventories, the historical digest encoding is
retained. For inventories with unscoped events, the digest now includes explicit
unattributed totals to prevent silent changes to their count/delay state.

Regression fixture: 3 publications including \`pub_default\`, flat and nested
events, pending and delivered, delayed, one unscoped envelope, malformed and
unsupported negatives, and replay with the writer's \`ON CONFLICT DO NOTHING\`
idempotency. This is **not** exactly-once delivery.

## Finding 03 — Migration 0061 governance and recovery policy

Historical SQL 0061 and all earlier migrations are **unchanged**.
Existing 0061 grants and \`SECURITY DEFINER\` guard restrict ordinary-runtime
row DML. The row trigger denies DELETE even to its table owner, but an owner
may still UPDATE any row and can TRUNCATE without invoking row triggers.
Do not claim these powers are denied by the current SQL.
The independent review did not prove ordinary Runtime TRUNCATE access.

Proposed owner-controlled policy (recorded here; NOT an implementation grant):

1. Immutable identity attributes: installation ID, application ID, publication ID
   and the publication's original workspace ownership. Existing mapped identity
   shall never be rebound as an automatic reconciliation side effect.
2. Only inventory metadata (counts, digests, reconciliation timestamp and
   operator provenance) may be corrected by a trusted operator, following
   evidence verification, audited review and a reversible forward-fix.
   Existing code does not yet enforce such column-level restrictions against
   the trusted DB owner; this policy alone is not enforcement.
3. Runtime roles must have no TRUNCATE privilege. A statement-level TRUNCATE
   refusal is defense in depth for privileged paths, **not** proof that
   runtime TRUNCATE was previously possible. Any additive migration adding
   the guard or restricting operator updates requires a fresh owner decision,
   specialist DBA/IAM evidence, independent Agent 06 concurrence, verified
   backup/recovery and an approved rollback; do not edit historical 0061.
4. A restore retains original mappings and audit provenance. A mismatched
   inventory or different installation/application must fail closed;
   stale post-restore evidence requires a new scoped operator reconciliation
   and fresh digest, never an automatic rebind.
5. Forward-fix means a separate minimal additive change with a new numbered
   migration, pre/post invariant tests, no destructive CONTRACT step and
   explicit authorization. No production changes follow from this dossier.

**No sensitive schema/IAM action is approved by this draft**.
Human DBA/IAM sign-off and Agent 06 independent verdict remain separate.
Risk acceptance: NONE.

Dedicated actual backup/restore job:
[.github/workflows/m03-c01-legacy-cms-physical-restore.yml](../../.github/workflows/m03-c01-legacy-cms-physical-restore.yml).
It must run on the exact final SHA with Node 24.22.3, pnpm 11.22.0,
a pinned PostgreSQL 16.16 image, full journal migration replay,
multi-publication fixture, custom binary \`pg_dump\`, new database, \`pg_restore\`,
digest/identity/relationship comparison, replay, IAM/ownership checks,
bad rebind, negative TRUNCATE, trusted-owner UPDATE and DELETE semantics,
post-restore drift refusal and restoration. A reconnect is not equivalent.

## Proposed scope deferrals — not accepted

| Proposed deferral | Current engineering scope | Unsupported scenario | Impact | Disposition |
| --- | --- | --- | --- | --- |
| Generic authenticated principal+tenant READY V2 fence | Existing signed, restricted reference admission for declared API/Worker artifacts | Arbitrary production API/worker principal and tenant recoveries | Wrong-principal/tenant acceptance or fail-closed unavailability if generalized unsafely | OPEN; no implicit deferral. Owner + Agent 05 + Agent 06 decision required before full M03 closure |
| Backfill-specific authenticated continuation and independent PITR durability | Existing scoped backfill admission, progress, lost-ACK handling, and other physical recovery witnesses | Restore/PITR with partial backfill state and independently authenticated continuation | Stale or duplicated backfill, unresolved recovery, data integrity loss | OPEN; no implicit deferral. Owner + Agent 02/04 + Agent 06 decision required before full M03 closure |

Original E06/E09/E11 acceptance requirements and authoritative contracts remain governing.
Missing implementation must not be reclassified as accepted merely because it refuses
unsupported operations. Proposed milestone ownership: M03 residual governance until
the Project Owner explicitly accepts a future named milestone or supplies new
executable evidence. No date is assumed and no acceptance is inferred.

## Independent recertification handoff (once CI is complete)

Agent 06 must independently inspect the frozen final SHA, tree, scoped diff,
two-session locking RED/GREEN, C01 fixture/digests, 0061 live privileges,
actual \`pg_dump\`/\`pg_restore\`, full unit/integration/security/physical CI,
browser E2E, E01–E11 and J01–J08 traceability, and the two owner deferrals.
Each finding must be VERIFIED_CLOSED, OPEN or INCONCLUSIVE; do not
reopen FUNC-01/FUNC-02 without demonstrated regression. Do not close #155/#197,
merge main, deploy, tag, activate DELTA-08, adopt P07-RC-C or enable M04 Batch 03.
D1 remains 2517 ms in its frozen restricted scope; M = NOT DETERMINABLE.

## Research register (checked 2026-11-21)

- PostgreSQL 16, row-level lock conflicts: https://www.postgresql.org/docs/16/explicit-locking.html
- PostgreSQL 16, transactional application consistency: https://www.postgresql.org/docs/16/applevel-consistency.html
- PostgreSQL 16, SQL GRANT/REVOKE and TRUNCATE privileges: https://www.postgresql.org/docs/16/ddl-priv.html
- PostgreSQL 16, pg_dump: https://www.postgresql.org/docs/16/app-pgdump.html
- PostgreSQL 16, pg_restore: https://www.postgresql.org/docs/16/app-pgrestore.html
- PostgreSQL 16.16 release notes (2026-11-12): https://www.postgresql.org/docs/release/16.16/
- Node 24.22.3 security release (2026-11-11): https://nodejs.org/en/blog/release/v24.22.3
- OWASP Multi-Tenant Security: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
- Agent 06 authoritative review (2026-11-21): https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-7052164371
