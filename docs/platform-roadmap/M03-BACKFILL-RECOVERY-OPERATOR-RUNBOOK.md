# M03 E06/E09 — Interrupted Backfill Operator Recovery Runbook

**Status:** DRAFT. Diagnostic steps are specified, not independently executed as an end-to-end post-PITR recovery. No automatic Backfill PITR continuation is supported. **Production NO-GO**. 2026-11-21.

**Immutable implementation:** a49d0379da06749ef5f163d9e48e9a053d2a375b. **Required approvals:** Agent 02, Agent 04, owner and Agent 06; all PENDING. This file is not a substitute for executable certification.

## 1. Original contract and supported behavior

[M03 E06/E09 and blocking exit](milestones/M03-schema-data-engine.md) requires safe interrupted backfills with a **recoverable operator plan**. [Existing installer](../../packages/database/src/schema-operator-experimental-installer.ts) does signed per-tenant/revision/column/value/limit validation, then row changes + durable chunk + target counters in ONE transaction. Same-DB committed operation replays idempotently; conflicting value and completed targets refuse. Unknown COMMIT acknowledgment causes pending authority and no automatic retry.

[Read-only settlement](../../packages/database/src/schema-operator-experimental-settlement.ts) cross-checks registry/active revision, backfill targets, chunk counts and affected totals, and refuses contradictions. [Authenticated continuation](../../packages/database/src/schema-operator-experimental-continuation.ts) supports only PROVISIONING/BUSINESS. It **cannot settle or resume BACKFILL after PITR**.

## 2. Operator procedure: safe phases and STOP triggers

1. **Detect and quarantine:** record incident ID, exact source SHA, installation/application, tenant, revision, signed operation/approval IDs, authority epoch/head, DB OID, system identifier, timeline, last known ACK, target/column and chosen recovery point. Pause only an explicitly authorized disposable tenant/installation. Capture observed active writers, transactions and operator approvals. Do not assume the absence of a log means rollback.
2. **Preserve evidence:** backup manifest, WAL/timeline history, external trusted anchor and signed authority journal, sanitized logs, no private keys. Have a named separate SRE attest quiescence. A CMS pg_dump custom archive does not establish Backfill WAL durability.
3. **Verify PG identity:** compare restored DB/system/timeline and manifest/registry with original signed authority, and validate allowed recovery epoch. If identity, anchor, signer, approval or timeline is missing/mismatched, **STOP**. Do not rewrite or fabricate authority state.
4. **Examine the DB read-only:** using an authorized read-only audit identity, run the diagnostic template below on one frozen/snapshot-consistent database. Never grant broader access simply to make a diagnostic query pass.
5. **Compare target/chunk evidence:** per tuple (installation, revision, tenant, resource, column), compare target value, target.chunks, affected_total and complete with matching signed chunk count, row ID sets, actual data values and zero-affected completion. Check FK/RLS and migration/catalog digest. A count match alone does not prove lost WAL did not rewind a transaction.
6. **Classify:** SAME_EPOCH_COMPLETE, SAME_EPOCH_PARTIAL_KNOWN, ACK_UNKNOWN, REWOUND_OR_STALE_PITR, SCHEMA_DRIFT, CROSS_TENANT, or UNSUPPORTED_RECOVERY_KIND. See matrix.
7. **Settle only when supported:** if pending=false, same epoch and every invariant holds, call existing read-only settleExperimentalDomains through separately approved operator code. Record exact digest. Any refusal or unknown state -> **STOP**. Never call continueExperimentalOperation with BACKFILL.
8. **Operator decision:** terminal state may be archived; a demonstrably settled same-epoch partial operation may be eligible for a *new separately signed* bounded chunk only after tested approval. A rewound/ambiguous state stays FROZEN; no automatic continuation, guessed ALREADY_COMMITTED, manual chunk-table edits or direct replay.
9. **Forward-fix:** if source recovery requires missing authentication/continuation, file a minimum additive design + reviewed execution authorization, verified backup + tested rollback, Agent 02/04 and Agent 06 consensus and owner decision. No implementation or execution is authorized by this runbook.
10. **Post-fix proof:** independently re-check tenant rows, target and chunk counters, signatures, active manifest, immutable authority epoch, backup/restore lineage and idempotent read-only settlement; log source, SHA/tree, commands, exit codes, timestamps and approvals. Without positive recovery proof, remain blocked.

### Read-only PostgreSQL diagnostic template

This is a runnable SQL **template** only on an explicitly authorized disposable PG16 environment with SELECT on protected objects. It has not been verified end-to-end after backfill PITR. Supply values from the incident register, never from arbitrary request input.

~~~bash
psql "$AUDIT_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v installation_id="$INSTALLATION_ID" \
  -v revision_digest="$REVISION_DIGEST" \
  -v tenant_id="$TENANT_ID" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT current_database() AS db_name,
       (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS db_oid;
SELECT installation_id,application_id,database_name,database_oid,system_identifier,
       timeline,epoch,ledger_id,profile,revoked
FROM public.platform_schema_installation_trust_v1
WHERE installation_id=:'installation_id';
SELECT installation_id,manifest_digest FROM public.platform_schema_registry
WHERE installation_id=:'installation_id';
SELECT installation_id,revision_digest,state,state_version,authority_epoch
FROM public.platform_schema_revision_states_v1
WHERE installation_id=:'installation_id';
SELECT tenant_id,resource_id,column_name,value,chunks,affected_total,complete
FROM public.platform_schema_backfill_targets_v1
WHERE installation_id=:'installation_id' AND revision_digest=:'revision_digest'
  AND tenant_id=:'tenant_id' ORDER BY resource_id,column_name;
SELECT operation_id,tenant_id,resource_id,column_name,affected,
       cardinality(ids) AS recorded_row_ids
FROM public.platform_schema_backfill_chunks_v1
WHERE installation_id=:'installation_id' AND revision_digest=:'revision_digest'
  AND tenant_id=:'tenant_id' ORDER BY operation_id;
COMMIT;
SQL
~~~

**STOP:** if audit identity cannot read protected tables, if quiescence is not independently attested, if an external anchor differs, or if DB identity cannot be independently established. Do not grant the runtime role access, run arbitrary UPDATE, reset journal, edit triggers, bypass RLS, or restart any untrusted writer.

## 3. Recovery classification

| Class | Meaning | Action / resume authorization |
| --- | --- | --- |
| SAME_EPOCH_COMPLETE | Exact evidence, terminal complete, same trusted authority and unchanged DB | Record terminal success; no new write |
| SAME_EPOCH_PARTIAL_KNOWN | Fully attested, non-uncertain committed chunks with consistent current epoch | New signed chunk only if separately authorized and tested; no inferred retry |
| ACK_UNKNOWN | PostgreSQL may have committed after lost acknowledgement | Freeze, preserve journal/anchor, **no replay** |
| REWOUND_OR_STALE_PITR | External authority, lost WAL or recovered timeline mismatch | Freeze; no continuation in current code |
| SCHEMA_DRIFT / CROSS_TENANT | Catalog/revision/tenant mismatch | Refuse, no automatic rebind |
| UNSUPPORTED_RECOVERY_KIND | BACKFILL requested via generic continuation API | Refuse; explicit missing feature |

## 4. Backfill invariant and existing test evidence matrix

| Requirement | Real existing test/proof | Limit |
| --- | --- | --- |
| Signed per-tenant/column revision and immutable target value | M03_B04_DURABLE_BACKFILL_ADMISSION_PROGRESS on PostgreSQL 16 | Experimental scoped contract |
| Atomic row + chunk journal + target progress | installer PostgreSQL transaction and B04 positive/replay | Same DB, not external authority atomicity |
| Conflict, completion and unknown duplicate refusal | B04 concurrency, COMPLETE/CONFLICT and immutable ledger negative tests | No across-PITR proof |
| Interrupted COMMIT ACK then restart | M03_B04_BACKFILL_ACK_LOSS_RESTART_SAFE_REFUSAL | Pending authority and refused replay, no successful continuation |
| Cross-domain settlement and forged progress refusal | M03_B03_CROSS_DOMAIN_SETTLEMENT | Read-only logical consistency in current database |
| Actual physical preserved/rewound recovery | PHY-M03 01/02/03/07; M03_J06 and M03_J07 in dedicated CI | Provisioning/business/other bounded components, **not Backfill-specific PITR** |
| Signed interrupted-operation continuation | B03 authenticated continuation | PROVISIONING/BUSINESS only |
| Operator procedure after Backfill PITR | This runbook | **NOT EXECUTED / NOT VERIFIED** |

[Dedicated CI evidence](https://github.com/AbdullahZaher/vibress/actions/runs/44831801694) — 10/10 success; [full CI](https://github.com/AbdullahZaher/vibress/actions/runs/44831801660) — success. These do not turn the last row into a passing test.

## 5. Missing evidence and owners

- **BFR-01 — HIGH reliability:** actual Backfill-specific PG16.16 PITR after/before chunk COMMIT with independently held authority/anchor; owner Agent 02+04, deadline **before D-02 approval**. Verify retained/rewound paths, legitimate safe refusal and no duplicate/cross-tenant outcomes.
- **BFR-02 — HIGH recovery completeness:** an **executable** operator recovery/forward-fix for interrupted Backfill with ambiguous PITR outcome, or a formally accepted narrower original E06/E09 interpretation by owner and Agent 06; owner Agent 02+04, deadline **before M03 closure**. Current runbook alone does not pass.
- **BFR-03 — MEDIUM governance:** runbook actual drill, quiescence and audit evidence; owner Agent 04, deadline before any privileged recovery.
- **BFR-04 — M08 GA scope:** measured independent full-installation RPO/RTO and cross-service recovery; owner M08-E04 Agent 04, deadline before GA.

**Agent 01 recommendation only (not Agent 02/04 independent approvals):** Maintain restricted fail-closed posture. D-02 remains BLOCKED pending executable recovery evidence or owner+independent acceptance of an explicitly narrower recoverable-plan contract. No risk accepted.

**Sources checked 2026-11-21:** [PG16 PITR](https://www.postgresql.org/docs/16/continuous-archiving.html), [pg_verifybackup](https://www.postgresql.org/docs/16/app-pgverifybackup.html), [PG16 transaction consistency](https://www.postgresql.org/docs/16/applevel-consistency.html).
