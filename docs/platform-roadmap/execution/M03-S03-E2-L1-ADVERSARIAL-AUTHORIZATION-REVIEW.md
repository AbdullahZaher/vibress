# E2/L1 AppSec and IAM adversarial review — unresolved boundaries

> 2026-11-18 Asia/Riyadh. REVIEW-ONLY / NOT NORMATIVE. Source: PR #209 documentation HEAD `999246ce8a0379908be6d749cb3c1acd2330fa38`; verified tested executable `3a8dce2fa296fd6a3b51c14bdd193d757cc4aa5c`; tree `30fd302094db904ed537f1809c6b69e607312d00`. Canonical PR #198 `b5cfc0687076c86a7450a8a785a072f6e63ad289` unchanged. No new PG16 test or independent human signature is claimed by this document.

## Threat model and specific negative tests
| Finding | Severity / exploit precondition | Evidence and expected mitigation |
|---|---|---|
| SEC-E2-01 old generation replay | HIGH impact, account lifecycle change + stale plan/approval | Old UUID/generation mismatch must deny after AUTHOR or APPROVER deactivation/reactivation, including LOGIN reuse |
| SEC-L1-02 privileged bypass | HIGH impact, misuse of table-owner or privileged DML | Existing 0060 BEFORE triggers execute after implicit row locking on UPDATE; enforce pre-mutation gateway and restrict direct DML |
| SEC-E2-03 provenance forgery | HIGH impact, reachable write privilege / unsafe DEFINER | Test direct SQL column writes, copied installation/UUID, SET ROLE and inherited grants; no runtime/operator INSERT/UPDATE on provenance |
| SEC-L1-04 deadlock & partial mutation | HIGH availability/integrity impact, conflicting admin txn | Reversed sequence and multi-actor 40P01; require rollback verification, deterministic lock prefix |
| SEC-IAM-05 superuser/owner trust root | Critical impact, privileged credential compromise | Ordinary ACL/triggers cannot constrain superuser; isolate, audit, rotate/monitor under separately authorized process |
| SEC-D1-06 deadline and watchdog | HIGH availability impact, delayed/silent COMMIT | No new privileged CANCEL grant; authenticated backend identity and connection binding; uncertain commit must fence/reconcile |

## Postgres 0060 contract-specific tests outstanding
Read `platform_schema_approval_provenance_guard` and `platform_schema_trusted_actor_registry_guard` under 0060: SECURITY DEFINER + session_user has explicit superuser override paths. A privileged login can manage roster but does not thereby demonstrate compliance with L1. Inspect default PUBLIC EXECUTE on *every* new function, function ownership, `pg_proc.proacl`, role membership, table ACL, trigger enabled mode and insecure `search_path`. Explicitly deny ordinary runtime roster UPDATE and reject the earlier `SELECT FOR SHARE` grant workaround. Do not claim standard role GRANTs stop a real superuser.

## Non-negotiable assertions for negative tests
No unauthorized ADD_FIELD DDL; no COMPLETED journal; no registry digest mutation; no stale approval; no unauthorized generation mutation or grants; committed actor changes preserved; every owned disposable DB removed. Verify with fresh database session and original checksums, not only an exception message. Record what each test failed to exercise. Cross-installation rows must be bound to installation identity and exact operation/digest.

## Review separation
This is a design assessment by the coordinating AI assistant, not separately authenticated Agent03 or human IAM attestation. Preliminary **AppSec REQUEST CHANGES**, **IAM REQUEST CHANGES**; accountable humans and Agent06 remain PENDING. Evidence on CI 44242532694 remains applicable only to that executable SHA.

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
