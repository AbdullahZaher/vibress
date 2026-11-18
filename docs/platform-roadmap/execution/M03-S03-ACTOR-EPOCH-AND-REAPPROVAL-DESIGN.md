# M03-S03 — Actor Epoch & Reactivation / Reapproval Architecture

**Date:** 2026-11-18 Asia/Riyadh · **Design status:** RECOMMENDATION ONLY — NO OWNER EPOCH DECISION, NO HUMAN IAM/DBA CONCURRENCE.  
**Owner:** P05/R1 policy APPROVED ([Issue #197 #6968063436](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436)), author and approver equally in scope. **Source baseline:** canonical #198 `b5cfc0687076c86a7450a8a785a072f6e63ad289`; Policy A #203 `1fb5e1600fd2300d7509ec998ff3b1fa1fff5078`; #206 `fb6e12203c3ca8e589419467369bf908e645c7cb`; test-only prototype `2e4a75cc4c45672ceb1cf5c42c077f147d11ad28`. No approved source migration.

## 1. Policy boundary and threat

P05/R1: privileged actor deactivation committed **before final pre-DDL authorization** denies DDL; strictly later commit is nonretroactive. This does not select how historical approvals behave after reactivation. Existing `platform_schema_trusted_actors` (migration `0060`) has only `active`, no generation and no immutable lifecycle event. An actor can be deactivated and reactivated before final actor-state check, reviving an old approval. Direct owner-controlled changes and login identity replacement require defense in depth. Neither a transaction timestamp nor an epoch SELECT *without locks* serializes a concurrent update.

## 2. Independent technical alternatives

| Option | Safety for deactivation→reactivation | Schema needed | Operational impact | Verdict |
|---|---|---|---|---|
| E1: permanent approval invalidation | All approvals/plans associated with an ever-deactivated actor remain unusable until individually reissued | Durable immutable lifecycle-invalidation marker or event register + final actor row lock | Simple revoke semantics, high reapproval volume; owner mistaken disable requires manual workflow | Secure if event history irrevocable; **PROPOSED** |
| E2: immutable actor instance + monotonic generation | Plan/approval bound to exact actor instance and generations; new generation never validates old provenance | New additive actor instance/epoch columns, provenance bindings, lifecycle trigger, constraints and explicit grants | Strong audit/reuse guarantees, more migration and backfill work | **RECOMMENDED for review; NOT APPROVED** |
| E3: active-state-only final read | Old approval can revive after actor reactivation | None; row locks still needed for R1 order | Lowest cost, weakest lifecycle semantics | **REJECT as complete R1 lifecycle solution** |

**Recommended E2 contract for subsequent owner/IAM/DBA decision:**

1. A stable **actor_instance_id** is generated and authenticated by the database/provisioner when a trusted LOGIN is registered. Never derive identity from mutable LOGIN name or a reusable integer epoch alone. Deletion/reinsertion creates a new unrepeatable instance; previously used instance identities remain auditable.
2. A nondecreasing, never-reset `actor_generation` is incremented on all approved deactivate, reactivate, principal replacement and sensitive lifecycle transitions. Concurrency serialization must be enforced using the same actor-row update lock as the final operator FOR SHARE.
3. **Plan provenance** is bound to the immutable AUTHOR instance and generation at authorization capture; **approval provenance** binds to the same AUTHOR instance/generation AND an independent APPROVER instance/generation.
4. The final operator must lock both actor rows in a documented global order and compare current active, kind, authenticated identity, instance and generation to immutable provenance. Any mismatch -> UNAUTHORIZED before DDL; require new plan and/or new approval according to separately approved business rule.
5. Reactivation never silently restores an earlier plan/approval; a newly registered AUTHOR must resubmit the plan and a currently distinct APPROVER must sign the exact operation. **This strict new-provenance policy is proposed, NOT selected by the Project Owner.**
6. An actor UPDATE that rolls back must roll back epoch and state atomically. A revision value may skip numbers but never repeat a value previously committed for the same instance.
7. Actor deletion/reprovisioning must not permit login reuse of old actor_instance_id. A privileged database owner/superuser remains an audited trust root; its malicious bypass is not treated as defendable by ordinary row ACL alone.

## 3. Attack checklist and expected E2 behavior

| Case | Expected E2 negative or allowed outcome |
|---|---|
| AUTHOR/APPROVER deactivated while target table lock held | After committed update, final locked check denies DDL |
| Deactivate, reactivate with unchanged LOGIN | New generation invalidates old plan/approval; no automatic reuse |
| Actor deleted and re-created with same LOGIN and principal string | New actor_instance_id blocks reuse |
| Actor principal rebound, role changed, SET ROLE attempted | Immutable provenance mismatch; privileged identity capture remains session_user |
| Two concurrent lifecycle transactions | Row locking serializes their COMMIT effects; aborted generation update not authoritative |
| Admin revokes approval while actor deactivation pending | Existing 0060 approval advisory fence and actor row locks must be jointly reviewed for deadlock |
| Legacy plans/approvals with NULL generation | Fail closed; reissue after accountable human review; do not fabricate history |
| Runtime with accidental direct UPDATE grant | Owner-only 0060 guard still denies; future generation trigger must also reject escalation |
| Previously archived actor restored after an error | New generation and fresh sign-off unless owner adopts a distinct, reviewed recovery policy |

## 4. Migration option (candidate only; NO production or shared DB mutation)

**Existing migrations 0059 and 0060 remain unchanged.** If E2 is authorized later, propose a separately numbered, additive migration (not yet assigned an ID and NOT created here).

- **Expand:** create immutable actor-instance/generation fields with vetted defaults and owner-scoped lifecycle function or trigger, plus corresponding plan/approval provenance columns. Revoke PUBLIC EXECUTE in same transaction; no runtime DDL/actor mutation privileges. Include fixed search_path and explicit ACL inspection.
- **Backfill:** do not claim historical instance/generation at a past approval time from current roster state. Mark existing plan/approval as **LEGACY_UNATTESTED** and deny execution until new authenticated provenance issued. Backfill actor instance IDs only for current roster identities after genuine verification; no silent approval upgrade.
- **Validate:** verify unique durable instances, monotonic changes, re-approval distinctions, all null legacy denials and race tests using disposable PG16; check backup + clean migration replay and compare catalog/ACL diff to approved scope.
- **Contract:** only after explicit owner policy on reapproval and separate human IAM/DBA approval, freeze reviewed SHA, then implement/turn on semantics; never rewrite 0059/0060.
- **Rollback:** revert executable path or halt new operator DDL while retaining new provenance data; a destructive DROP migration is not authorized. If unsafe, stop and restore a verified disposable snapshot; for shared/production restoration require a new decision.

## 5. Separation of policy and evidence

**Owner P05/R1:** APPROVED (policy only).  
**E2 epoch algorithm:** RECOMMENDED / PENDING OWNER + human IAM/DBA.  
**Reactivation / mandatory reapproval:** RECOMMENDED / NOT APPROVED.  
**Experimental branch:** no actor epoch changes in schema; stale reuse is intentionally an OPEN regression.  
**Human IAM / DBA:** PENDING/PENDING; Agent 06 final: PENDING.  
**Rollback:** current code/doc experiment can be reverted with no schema effects.

### Primary sources reviewed 2026-11-18

- [PostgreSQL 16 explicit row locks](https://www.postgresql.org/docs/16/explicit-locking.html), [transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html), [trigger behavior](https://www.postgresql.org/docs/16/trigger-definition.html).
- [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), including deny-by-default and verified authorizations.

**Next permitted action:** deliver E2 vs E1 decision options to accountable human IAM/DBA for written risk and migration review; obtain any further owner reapproval policy decision before executable implementation.