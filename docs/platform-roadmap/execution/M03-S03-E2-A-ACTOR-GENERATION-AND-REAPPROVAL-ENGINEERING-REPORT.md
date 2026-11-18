# E2-A actor generation engineering assessment — experimental only

> 2026-11-18 Asia/Riyadh. REVIEW-ONLY / NOT NORMATIVE. Source: PR #209 documentation HEAD `999246ce8a0379908be6d749cb3c1acd2330fa38`; verified tested executable `3a8dce2fa296fd6a3b51c14bdd193d757cc4aa5c`; tree `30fd302094db904ed537f1809c6b69e607312d00`. Canonical PR #198 `b5cfc0687076c86a7450a8a785a072f6e63ad289` unchanged. No new PG16 test or independent human signature is claimed by this document.

## Proposed state machine and identity root
Registration: authenticated individual PostgreSQL LOGIN bound to immutable principal and new random instance UUID, generation=1. Active actor authorizes only for matching kind and verified principal. A committed activation, deactivation, reactivation, principal/kind/login change increments generation in the same transaction; deleted registration gets a persistent tombstone; same LOGIN re-registration uses a NEW UUID/generation 1. On max bigint generation: deny; do not wrap. Rolled-back operations leave previous authoritative version. Physical owner/superuser bypass stays in audited trust root.

A plan binds installation + canonical digest + single operation ID to AUTHOR LOGIN, principal, UUID, generation. Independent approval binds same immutable plan provenance and APPROVER LOGIN, principal, UUID, generation. No client-supplied UUID/generation may be accepted. `session_user`, with non-shared individual LOGIN policy, is authority root; never `SET ROLE`, `current_user` alone or caller text. Instance and generation fields are immutable after insert. Legacy NULL or unverifiable provenance fails closed.

## Required implementation decisions before normative code
- **E2-A not owner-approved.** If selected, every relevant committed lifecycle transition affecting either AUTHOR or APPROVER requires completely fresh plan AND fresh distinct approver; old plan must never be reintegrated or updated in place.
- Regeneration MUST provide a new unique plan/operation identifier and digest-compatible contract: 0059 primary keys bind plan digest and operation ID; exact repeated same plan bytes must not be mislabeled new.
- Existing 0060 functions are SECURITY DEFINER and have a potential privileged bypass path for superuser. Inspect full EXECUTE grants, trigger order and owner privileges. E2 triggers only snapshot provenance at submission/approval; without pre-mutation locking, concurrent lifecycle transitions can change identity before provenance capture.
- Author/approver must acquire X in deterministic order and hold until final Policy A check and DDL/transaction COMMIT. **Do not substitute READ COMMITTED fresh SELECT for holding serialization locks.** All lifecycle writers must participate before row DML.
- Preserve Policy A `clock_timestamp()` after target lock/catalog verification and actor revalidation; no unprotected await or blocking SQL between final authorization and DDL. Final approval must be compared against the original immutable snapshot.

## Evidence and deficits
Previous E2-01 to E2-04 experimental tests and R1-10-FIX/FIX2 passed on `3a8dce2f` (GitHub Actions 44242532694). This is **not** a new test result. Full adversarial variants (cross-installation, concurrent identity replacement, direct privilege misuse, owner gateway bypass), durable migration backfill, D1 and owner approval are outstanding. **IAM technical disposition: REQUEST CHANGES, independent human IAM: PENDING.**

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
