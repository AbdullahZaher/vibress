# M03-S03 — P05/R1 Security Remediation and IAM/DBA Handoff

**Date:** 2026-11-18 Asia/Riyadh. **Executive status: REQUEST CHANGES / NO-GO.** R1 is a binding Project Owner policy, not an integration or human IAM/DBA approval. The technical assessments here represent different review lenses in one AI-assisted investigation, NOT separately authenticated human reviewer signatures.

**Owner P05:** [Decision ID M03-S03-P05-R1-OWNER-2026-11-18](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436), applies to AUTHOR and APPROVER. P02 Policy A FINAL_PRE_DDL and P04 D1 2517ms remain restricted dev/disposable PG16 only; no D2.

## Sources and evidence chain

| Asset | Exact identity and disposition |
|---|---|
| Canonical Draft PR #198 | b5cfc0687076c86a7450a8a785a072f6e63ad289 — unchanged, NOT INTEGRATED |
| Isolated Policy A PR #203 | 1fb5e1600fd2300d7509ec998ff3b1fa1fff5078 |
| Source-pinned old IAM race PR #206 | fb6e12203c3ca8e589419467369bf908e645c7cb |
| P05 documentation Draft PR #207 | 2f3a6afde703c79b105bb6c6b48bd942f44a7173 |
| Experimental initial code+test checkpoint PR #208 | 2e4a75cc4c45672ceb1cf5c42c077f147d11ad28; later docs-only commits do NOT imply tests pass |
| Operator experimental blob | 9c587afca423320307a3f62f57f27e92a0dd4587 |
| Experimental test blob | 37a2b5f0534a6b491801b4b5512b400f0de01b18 |
| Migration 0059 / 0060 | 3c54d698363875c5af701f750a2900f6dcd61909 / d8b1e50a0a4dd347fde235ae7cb1a12468249719 — UNCHANGED |

## What the experiment changes

1. Acquire two actor row locks FOR SHARE after table ACCESS EXCLUSIVE, authoritative catalog and physical row-count checks, just before final Policy A approval query; order by trusted login and validate active, login, principal, actor_kind and identity_mode.
2. Reverse R1-01/R1-02 old positive exploitation tests: when the privileged AUTHOR or APPROVER deactivation has COMMITTED during actual target-table wait, require UNAUTHORIZED, no new column, unchanged registry manifest and seeded data, zero completed journal.
3. Reverse original concurrent deactivation and approval-revocation assertion to R1 denial, while preserving the 0060 approval-key advisory fence/audit.
4. Add two deterministic PostgreSQL wait-event experiments: committed post-final deactivation is nonretroactive because it must wait for the held FOR SHARE; uncommitted actor UPDATE blocks final FOR SHARE, then COMMIT inactive must deny.
5. Continue running original authenticated operator, expiry, privilege negatives, real fault-injection and fixture cleanup through a dedicated disposable PostgreSQL 16 GitHub Actions workflow.

No production database, shared instance, operator CLI integration, migration rewrite, actor epoch schema, privileged control function, watchdog grant, runtime DDL, canonical PR #198, or main branch changes.

## Status matrix — classify source-specific evidence without inference

| Requirement | Status / evidence |
|---|---|
| P05/R1 owner policy | APPROVED; both actors covered |
| Old IAM-RACE-01 real-PG reproduction | VERIFIED on old source; [security evidence](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6960695638) |
| New R1 row-lock repair | IMPLEMENTED EXPERIMENTALLY; exact-head real-PG workflow needs verified outcome |
| Actor epoch E1/E2/E3 | E2 RECOMMENDED; no owner/human IAM/DBA approval; NOT IMPLEMENTED |
| Reactivation/reapproval | PENDING POLICY — prior approval can revive when active=true; OPEN |
| Global lock ordering | PARTIAL; credible mixed admin actor→approval advisory deadlock, not fully tested |
| Policy A expiry | Preservation intended; exact experimental CI needed |
| D1 full operation supervisor | NOT INTEGRATED, 2517ms still mandatory for future candidate |
| Pre-COMMIT admission M | NOT DETERMINABLE |
| AG06-S03-10 / SQLSTATE | OPEN; old 55P03→UNAUTHORIZED misclassification remains |
| IAM-WD-01 watchdog | OPEN; no identity-safe cancellation |
| Human IAM and DBA | PENDING / PENDING |
| Agent06 independent final | PENDING, cannot self-certify this code |
| Canonical integration/merge/production | BLOCKED / NOT AUTHORIZED / NO-GO |

## Specialist technical conclusions — separate lens, not three independently executed reviews

**Agent05 IAM — REQUEST CHANGES:** direct table-wait R1 race may be prevented through actor FOR SHARE locking, but current active flag permits stale plan/approval reuse following deactivate→reactivate. Recommend E2 immutable actor_instance_id + generation with new approvals bound to exact author and approver generations; require owner/human approval for lifecycle rules.

**Agent02 DBA — REQUEST CHANGES:** row-level lock conflict and READ COMMITTED updated-row visibility are well-supported PostgreSQL semantics, but arbitrary privileged admin transaction ordering can cause actor→approval advisory inversion. Require deterministic deadlock/rollback and concurrency replay proof, version-pinned pg16 and D1 timing measurements.

**Agent03 AppSec — REQUEST CHANGES:** old attacker-controlled interleaving is reproduced and tests inverted in prototype, but actor delete/reinsert, epoch replay, role inheritance, SET ROLE, direct owner DML, SQLSTATE leakage, unknown COMMIT and runtime watchdog attacks are still gating negatives. Passing tests on a source not yet implemented is not an assurance.

## Independent human approval handoff

**IAM authority request:** https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959197756  
Must independently review owner R1, actor instance and epoch, approval binding, prior approval reuse, deactivation/reactivation provenance, role/ACL isolation, migration and residual risk. Provide human identity/authority basis, exact reviewed SHA, findings, conditions, date and URL.

**PostgreSQL DBA authority request:** https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959199526  
Must independently review actual global lock order and admin-mutation protocol, READ COMMITTED correctness, SQLSTATE 40P01/55P03/57014, rollback+COMMIT uncertainties, disposable migration replay and D1 sizing impact; provide same attributable signed disposition.

If E2 reapproval design is selected, propose a separate attributable Project Owner choice; this R1 owner policy decision alone **did not authorize E2**. No reviewer may approve code it authored. Agent06's independent future review is required on exact frozen SHA.

## Risk / rollback / next permitted action

Open threats: old approval replay after actor reactivation, lock-order deadlock, D1 false APPLIED, no approved M, ambiguous COMMIT fencing, potential incorrect SQLSTATE telemetry. No Critical/High waiver. **Rollback:** revert experimental operator/test/workflow source, discard only owned disposable PG16 fixtures; no production schema/ACL rollback applies. Future unknown COMMIT must quarantine and reconcile, not blind retry.

**Next:** fetch actual final PR #208 CI status, repair any failing tests, conduct mixed-admin deadlock test; obtain IAM/DBA independent design review plus owner approval of actor lifecycle semantics. Only then consider a separately authorized integrated candidate. Keep #198 Draft, merge BLOCKED, production NO-GO.

**Sources reviewed 2026-11-18:** https://www.postgresql.org/docs/16/explicit-locking.html ; https://www.postgresql.org/docs/16/transaction-iso.html ; https://www.postgresql.org/docs/16/errcodes-appendix.html ; https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html .