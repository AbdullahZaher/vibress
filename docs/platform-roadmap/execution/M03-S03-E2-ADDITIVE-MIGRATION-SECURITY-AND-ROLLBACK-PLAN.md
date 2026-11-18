# E2 additive migration — security, expansion, rollback (CANDIDATE ONLY)

> 2026-11-18 Asia/Riyadh. REVIEW-ONLY / NOT NORMATIVE. Source: PR #209 documentation HEAD `999246ce8a0379908be6d749cb3c1acd2330fa38`; verified tested executable `3a8dce2fa296fd6a3b51c14bdd193d757cc4aa5c`; tree `30fd302094db904ed537f1809c6b69e607312d00`. Canonical PR #198 `b5cfc0687076c86a7450a8a785a072f6e63ad289` unchanged. No new PG16 test or independent human signature is claimed by this document.

## Baseline verified
0059 registry/plans/approvals/journal blob `3c54d698363875c5af701f750a2900f6dcd61909`; 0060 authenticated provenance blob `d8b1e50a0a4dd347fde235ae7cb1a12468249719`. Both must stay byte-for-byte unchanged. E2 fixtures `tests/fixtures/m03-s03-e2-actor-generation-experimental.sql` are not migrations. Do not select a new migration number until repository journal and owner authorization are reviewed.

## Expand (unapproved candidate)
Add actor `actor_instance_id uuid`, `actor_generation bigint`; plan AUTHOR instance/generation; approval AUTHOR and APPROVER instance/generation; immutable lifecycle audit/tombstones; checks >0, FK/unique/cross-installation integrity, and narrowly scoped constraints/indexes. Use staged nullable additions on populated actor tables; a volatile per-row UUID backfill/default and NOT NULL may cause prolonged locking/rewrites and require rehearsal. Build an operator-disabled compatibility/read phase. Put SECURITY DEFINER bodies in trusted schema with fixed `search_path`, no unexpected PUBLIC EXECUTE; audit function owner and GRANTs. No runtime/operator roster UPDATE. 0060 legacy triggers and grants must not be removed silently.

## Backfill / fail-closed transition
New actor-instance UUID and generation 1 may describe only a **new enrollment epoch** after independently verified identity re-enrollment, NEVER the history of an old plan or approval. Existing plans/approvals retain NULL provenance and are denied. Existing trusted actors must be reviewed/authenticated under new enrollment policy, with separate auditable activation and no automatic approval carryover. For deleted/recreated actors, preserve tombstones. A partially migrated installation denies operator execution. Backfill in bounded transactional batches with separate verified DBA review; no fabricated historical generation.

## Validate / Contract
Replay 0059 and 0060 on a fresh disposable PostgreSQL16 DB and stage additive candidate; verify prior grants, fresh grants, `pg_trigger` alphabetical ordering, insertion/update/deletion, FK checks, generation rollback, stale replay denial, runtime least privilege, LOCK waits, partial installation, server restart, backup/restore and idempotency under actual Drizzle journal mechanism. Capture exact source SHA, SQL checksum, server version, restore hashes and workload timing. All **PENDING new experiment**, not represented by prior #209 CI. Contract only after owner E2-A+gateway+migration decisions, independent human IAM/DBA review, complete exact-SHA tests, backup/restore and Agent06 review.

## Rollback and recovery
Disable schema operator fail-closed before any recovery; do not DROP the provenance/tombstone columns to make old authorization work. If migration fails mid-transaction, confirm rollback from fresh trusted DB state; if commit outcome uncertain, fence operator access and reconcile catalog + journal + actor history rather than blind retry. Prefer forward-fix retaining provenance; restore backup to disposable isolated DB as independent validation. Production destructive downgrade, privilege alteration and restore are not authorized by this package. **Migration authorization: BLOCKED**.

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
