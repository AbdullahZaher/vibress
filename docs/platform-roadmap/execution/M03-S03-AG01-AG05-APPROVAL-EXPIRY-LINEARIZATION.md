# M03-S03 — Final Approval Expiry Linearization (AG06-S03-08)

**Status: PROPOSED; ACCOUNTABLE OWNER APPROVAL PENDING.** Date: 2026-11-17. Initial unified PR #198 HEAD: b5cfc0687076c86a7450a8a785a072f6e63ad289. Tracking: #197. Independent review: #5938896659. No formal architecture, IAM or PostgreSQL DBA decision reference has been supplied. This proposal must not be represented as signed owner approval.

## Alternative formal policies

**Policy A — Final pre-DDL authorization (recommended for the bounded one-column operation; PENDING approval):** final authorization occurs at a fresh PostgreSQL clock_timestamp() read after the installation advisory lock, registry FOR UPDATE, approval-specific advisory transaction lock, ACCESS EXCLUSIVE target relation lock, live catalog/privilege checks and pre-DDL row-count check. Require the same approval record/timestamps, revoked_at IS NULL, approved_at <= checked_at, expires_at > checked_at. The next action is the validated ADD COLUMN; no additional blocking external operation is permitted between decision and DDL. Expiry during table/advisory lock wait or earlier preflight means DENY and ROLLBACK with no DDL/journal. Expiry after the valid final decision, during DDL or before COMMIT does not retroactively void it. This is NOT an expiry-at-COMMIT guarantee. Approval revocation before the approval-specific lock is visible in READ COMMITTED and denied; revocation after that lock waits for transaction commit/rollback via the authenticated 0060 trigger. A late revocation applies to future attempts.

**Policy B — Valid through finalization (alternative, NOT implemented):** require another fresh DB wall-clock approval check after DDL, verification and journal insertion, immediately before COMMIT; expiry at that point forces ROLLBACK of DDL, registry and journal. This costs more aborted operations and requires a distinct owner choice and its own real-PG test evidence. Do not silently substitute it for Policy A.

**Required owner sign-offs:** Architecture Agent 01/accountable project owner — PENDING; IAM Agent 05/accountable authorization owner — PENDING; PostgreSQL DBA authority — PENDING; Agent 06 independent security revalidation — PENDING. Record actual actor/approval references and a maximum end-to-end operation budget before final adoption. These AI-agent roles alone do not confer human authorization.

## Lock-order and time contract

| Order | Operation / lock | Lifetime |
| --- | --- | --- |
| 1 | BEGIN READ COMMITTED; local 2s lock timeout, 10s statement timeout and 15s idle-in-transaction timeout | Transaction |
| 2 | Installation-scoped advisory transaction lock | COMMIT/ROLLBACK |
| 3 | Trusted registry FOR UPDATE; canonical manifest and plan | COMMIT/ROLLBACK |
| 4 | 0060 approval-specific advisory transaction lock; identity and revocation check | COMMIT/ROLLBACK |
| 5 | Canonical target ACCESS EXCLUSIVE relation lock; fresh catalog, ACL, journal and row checks | COMMIT/ROLLBACK |
| 6 | FINAL approval read with FRESH clock_timestamp(), no subsequent external blocking call | Authorization linearization |
| 7 | Exactly one optional mapped scalar ADD COLUMN with no default, then postconditions, manifest CAS and atomic completed journal | COMMIT/ROLLBACK |
| 8 | COMMIT; on pre-COMMIT failure ROLLBACK; ambiguous COMMIT => INDETERMINATE, fresh-session reconciliation, no blind retry | End |

Use PostgreSQL clock_timestamp() rather than now() or transaction_timestamp() for post-wait validity. The initial approval read remains defense in depth, not the final decision. A transaction-level advisory lock held by the operator is also acquired by 0060 approval DML triggers, including misgranted direct writes. The journal retains authenticated principal/approval provenance and records additive, noncanonical JSONB keys authorizationPolicy=FINAL_PRE_DDL and finalAuthorizedAt. No failed approval creates a completed journal. The existing recovery contract (ROLLED_BACK / COMMITTED / HALT_UNRECONCILABLE) is unchanged.

**Duration limitation:** local statement_timeout and lock_timeout constrain individual statements, not total operation wall time. Idle timeout only constrains idle-in-transaction. A whole-operation deadline is not currently proven, and is a production approval blocker.

## Real PostgreSQL regression

Historical unpatched two-session [audit run #44070678371](https://github.com/AbdullahZaher/vibress/actions/runs/44070678371) observed **5/5 APPLIED after approval expiry while waiting on table lock**. This is historic failure evidence, not evidence for the proposed patch.

The new EXP-01 test creates five separate disposable PG16 installation databases and role fixtures, blocks each target table under an independent external ACCESS EXCLUSIVE lock, confirms initial approval validity, confirms the real PostgreSQL wait_event_type=Lock, waits for a DB clock_timestamp expiry while that lock is held, then releases it within the bounded lock wait. It must reject with UNAUTHORIZED 5/5, preserve manifest digest and seeded content checksum, leave the column absent and journal empty, and deny retry. EXP-02 uses a test-only post-decision synchronization gate to show that expiry strictly after the recorded final timestamp does not retroactively void the approved ADD COLUMN under proposed Policy A; completed journal audit must preserve the timestamp.

Existing AG05 0060 source protections (authenticated author/approver, dual-grant and role-switching denial and revocation), Agent02 comprehensive privilege inspection and table locking, and Agent04 actual SIGKILL, TCP/backend disconnect, on-wire COMMIT acknowledgement fault and reconciliation regressions remain mandatory. Do not claim PASS without exact-SHA executable evidence.

## Compatibility and residual risks

No changes to Canonical IR v1, Manifest v1, Change Plan v1, operation digest, migration 0059/0060, SQL grammar, tenant isolation, role grants or existing plugin/API/worker routes. No tenant-owned DDL, RLS generation, destructive DDL or extra executable operations. The new denial for approvals expiring during lock waits is an intentional security tightening. Audit JSONB keys are additive; the physical migration journal remains atomic with DDL.

Residual risks: PostgreSQL table ownership inherently grants stronger native DDL abilities than the restricted SQL renderer; pooled service accounts do not prove individual human identity; production effective grants, full transaction deadline, durable failed-attempt auditing, backup/PITR rehearsal and formal human policy approvals are not certified. Production NO-GO. Merge NOT AUTHORIZED. PR #198 remains Draft and belongs to the Integration Lead. This isolated branch is an implementation proposal only.
