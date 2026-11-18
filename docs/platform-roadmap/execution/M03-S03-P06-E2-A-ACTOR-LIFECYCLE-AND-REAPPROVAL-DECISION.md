# P06 — E2-A Project Owner decision (APPROVED — RESTRICTED POLICY)

> **Current binding decision:** `M03-S03-P06-E2-A-OWNER-2026-11-18` · 2026-11-18 Asia/Riyadh · [Owner decision relay — Issue #197](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6971205056). This section supersedes the pending proposal below, which is retained unaltered as historical evidence. **Policy approval and isolated L1/E2 migration prototyping only; NOT normative implementation, migration deployment, integration, merge, production or independent human IAM/DBA approval.**

## Current owner instruction (verbatim)

> بصفتي مالك المشروع أعتمد P06/E2-A كسياسة ضمن نطاق التطوير والاختبارات المعزولة. أعتمد مبدأ Actor UUID وGeneration، وأشترط خطة جديدة وهوية عملية جديدة وموافقة مستقلة جديدة بعد إبطال التفويض، مع الحفاظ على حتمية Canonical Digest. أسمح بتطوير واختبار نماذج L1 وE2 Migration المعزولة فقط. لا أصرح بتوسيع صلاحيات الإنتاج أو الدمج أو النشر أو تجاوز موافقات IAM وDBA.

Recorded by the assistant at the Project Owner's request. This is not a separately authenticated human reviewer signature.

## Effective contract

- E2-A: after committed lifecycle invalidation of either AUTHOR or APPROVER, invalidated pending authorizations require a newly submitted plan, fresh unique operation identity and new independently authenticated approval by a distinct eligible active APPROVER. Bind authenticated provenance to nonreusable actor UUID and authoritative generation. Reactivation or LOGIN reuse cannot revive invalidated authorization. Rolled-back lifecycle transactions are not authoritative. Preserve the approved P05/R1 nonretroactive rule after final valid authorization.
- **Correction to historical proposal item 4:** identical canonical content in an unchanged digest domain MUST retain its deterministic digest. Fresh operation/plan identity and approval provenance are distinct from the canonical content digest; bind them and the exact digest in the verified authorization record/envelope. Do not require an artificially different content hash. Exact encoding and lifecycle transitions remain subject to review.
- Do not silently reapprove an invalidated plan or fabricate historical generations. Legacy unverifiable provenance fails closed; no recovery exception approved.
- Authorized: isolated L1 and E2 migration prototypes and new disposable PostgreSQL 16 validation. No modification to historical 0059/0060; no application to shared or production databases. No new production privileges.
- Policy A, P05/R1 and D1=2517ms remain unchanged in their original restricted scope. No numerical M, expanded success envelope or watchdog privilege approved.

## Current gates and next action

| Gate | Disposition |
| --- | --- |
| P06/E2-A owner policy | APPROVED — restricted |
| L1 / E2 additive migration prototyping | AUTHORIZED — disposable environments only |
| Enforceable global administrative writer protocol | INCOMPLETE |
| Normative migration / ACL / lifecycle implementation | BLOCKED pending applicable IAM/DBA review |
| Human IAM / DBA | PENDING / PENDING |
| Integrated D1 supervisor / pre-COMMIT M / watchdog / SQLSTATE | OPEN |
| Agent06 independent integrated-source certification | PENDING |
| Canonical PR #198 integration | BLOCKED |
| Merge / Production | NOT AUTHORIZED / NO-GO |

Preserve historical evidence: tested executable `3a8dce2fa296fd6a3b51c14bdd193d757cc4aa5c`, [CI #44242532694](https://github.com/AbdullahZaher/vibress/actions/runs/44242532694). This documentation change does not constitute new tests. Next: build and validate enforceable L1, E2 additive migration and anti-replay behavior in isolation; prepare independent IAM/DBA review on exact candidate; no canonical integration until required authorization. **REQUEST CHANGES / NO-GO.**

---

## Historical proposal snapshot (superseded status; not current governing text)

# P06 — E2-A Project Owner decision package (PROPOSAL / DECISION PENDING)

> 2026-11-18 Asia/Riyadh. REVIEW-ONLY / NOT NORMATIVE. Source: PR #209 documentation HEAD `999246ce8a0379908be6d749cb3c1acd2330fa38`; verified tested executable `3a8dce2fa296fd6a3b51c14bdd193d757cc4aa5c`; tree `30fd302094db904ed537f1809c6b69e607312d00`. Canonical PR #198 `b5cfc0687076c86a7450a8a785a072f6e63ad289` unchanged. No new PG16 test or independent human signature is claimed by this document.

## Authority and currently binding choices
Policy A / FINAL_PRE_DDL: APPROVED for restricted disposable test/development. D1: 2517 ms, starts before connection acquisition, APPROVED restricted. P05/R1: AUTHOR and APPROVER committed deactivation before final serialized authorization blocks DDL; later deactivation is nonretroactive. P05/R1 record: https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436 . None of these selects E2-A or permits integration.

## Owner decision requested
**Proposed E2-A: APPROVE mandatory fresh plan and fresh independent approval after ANY committed security-relevant AUTHOR or APPROVER lifecycle invalidation. Actual OWNER DECISION: DECISION PENDING.** Do not issue a decision ID, attribute a signature, or publish APPROVE on this report's authority.

Exact proposed contract:
1. Actor instance UUID represents one registration, never the reusable LOGIN name; permanent tombstone records deleted UUIDs.
2. Initial registration creates a new UUID, generation=1; activation/deactivation/reactivation, principal/login replacement, role/kind change and any effective authorization change atomically advance the generation. Committed replacement may instead close old UUID and register a new UUID; never reuse the old identifier.
3. Both AUTHOR and APPROVER transitions invalidate the pending operation's complete provenance, even if one actor later returns to active status. No accidental-deactivation exception in the ordinary path.
4. Fresh submission means an independently authenticated AUTHOR creates a newly bound plan (with unique new operation identity and canonical new digest, not a byte-identical duplicate falsely described as fresh), then a distinct active APPROVER submits a new independently authenticated approval; existing plan/approval primary-key and one-way revocation rules must remain coherent.
5. Prior plan/approval instances are immutable. Reapproval of an old plan is denied under E2-A. Recovery is a separately governed owner policy change, never a silent override.
6. Legacy NULL/unverifiable generations and old historical approvals always deny. No historical approval is silently stamped with a contemporary generation.
7. Transactions rolled back before COMMIT do not alter authoritative generation. Identity/deletion tombstones are tamper-resistant within ordinary ACL scope; overflow fails closed; a DBA trust root remains separately governed.
8. P05/R1's final authorization linearization remains mandatory and preserves the after-final nonretroactive rule for an already authorized in-flight operation.

## Rationale, rejected alternatives and operational impact
E2-B (fresh approval reusing old plan) leaves unclear author lifecycle semantics; E2-C (exceptional plan recovery) increases attack surface and requires separate policy. E2-A favors a simple fail-closed anti-replay invariant; it causes plan regeneration, reapproval churn, pending-job cancellation, audit retention and migration staging costs. A new migration number, gateway privilege contract, recovery SLO, M and production deployment are NOT included.

## Required attributable decision
Owner must issue one of: **APPROVE E2-A / APPROVE WITH EXPLICIT MODIFICATIONS / REJECT E2-A / DECISION PENDING**, referencing this exact version and clarifying exceptions, scope and recovery. Human IAM and DBA must subsequently review executable SHA and precise migration. Changing policy later requires a separately logged amendment with reason, scope, effective time, backward-compatibility analysis, rollback/forward recovery and new reviews; never erase historical provenance.

## Status
**DECISION PENDING**; owner=Project Owner; next gate=explicit accountable decision; independent IAM/DBA=NOT OBTAINED; no risk acceptance. Retain P02/P03/P04/P05 unchanged.

## References (checked 2026-11-18)
- https://github.com/AbdullahZaher/vibress/issues/197
- https://github.com/AbdullahZaher/vibress/pull/209
- https://github.com/AbdullahZaher/vibress/actions/runs/44242532694
- https://www.postgresql.org/docs/16/explicit-locking.html
- https://www.postgresql.org/docs/16/sql-altertable.html
- https://www.postgresql.org/docs/16/sql-createfunction.html
- https://www.postgresql.org/docs/16/ddl-priv.html
- https://www.postgresql.org/docs/16/trigger-definition.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
