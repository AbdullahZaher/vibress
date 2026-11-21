# M03 D-02 — Disposable PostgreSQL 16 Backfill PITR Drill Report

**Date:** 2026-11-21
**Agent:** Agent 02 (PostgreSQL) + Agent 04 (SRE), coordinated by Agent 01
**Status:** drill EXECUTED and PASS; D-02 remains **OPEN / PENDING owner + Agent 06 decision**
**Production:** NO-GO. Migration 0061 and frozen M03 source were **not** modified.

## Drill implementation

`scripts/platform/m03/backfill-pitr-drill.sh` — requires `VIBRESS_DRILL_CONFIRM=1`, uses a unique disposable container name, disposable host port (default 15439) and disposable directory, and tears all of them down via a trap. It uses `postgres:16-alpine` (image digest `sha256:1d5b02d3a9941fbd52437db4107f8c52d6297dac553ca1e5c299ebb3756b4857` as pulled on 2026-11-21). No production data, role, grant or credential is accessed. It is deliberately **not** added to CI.

## Execution evidence

Command: `VIBRESS_DRILL_CONFIRM=1 bash scripts/platform/m03/backfill-pitr-drill.sh`
Exit code: **0** (second clean run after an identical first passing run).
Recovery target: `2026-11-21 18:22:59.333523 +00`; 5 WAL segments archived.

| Assertion | Expected | Actual | Result |
| --- | --- | --- | --- |
| Retained committed chunk present after PITR | 1 | 1 | PASS |
| Rewound (post-target) chunk absent | 0 | 0 | PASS |
| Unknown COMMIT outcome preserved, not auto-resumed | `UNKNOWN` | `UNKNOWN` | PASS |
| Chunk journal consistent with retained chunk | 1 | 1 | PASS |
| Rewound chunk journal absent | 0 | 0 | PASS |
| External recovery authority anchor matches persisted authority | `disposable-drill-authority` | `disposable-drill-authority` | PASS |
| Replaying the same chunk id cannot duplicate it | 1 | 1 | PASS |
| Operator forward-fix applies a new revision (`rev-2`) | `rev-2` | `rev-2` | PASS |
| Forward-fix journal entry recorded | 1 | 1 | PASS |

The external anchor is a digest of a file stored **outside** PostgreSQL and compared with the value recovered from the database. The forward-fix was performed only after recovery and promotion.

## What this proves

- Physical PG16 WAL/PITR can retain a committed Backfill chunk and rewind a later one.
- A chunk journal can be reconciled with the recovered data state.
- An unknown COMMIT outcome can be preserved rather than silently resumed.
- Duplicate application of the same chunk id is prevented by the primary key.
- A bounded operator forward-fix with a new revision is executable after recovery.
- An external authority anchor can be correlated with recovered metadata.

## What this does **not** prove

The existing restricted E06/E09 recovery contract is **not yet demonstrated as sufficient** for D-02 closure:

1. The drill uses a synthetic schema and direct `psql` superuser access. It does not execute the frozen M03 backfill operator (`a49d0379`, tree `419ebd78`) or its signed revision/authority checks.
2. No authenticated operator model (PROVISIONING/BUSINESS authority, `BACKFILL` exclusion) was exercised; the recovered forward-fix was not gated by the real approval and revocation path.
3. No in-flight workers, mixed API/Worker versions, or cross-installation replay were included.
4. No verified backup/rollback with real role separation was performed.
5. No Agent 06 independent inspection of this script or its output has occurred.

## Required next decisions

- Agent 02 verdict on whether the drill is an adequate physical-evidence component of D-02.
- Agent 04 verdict on WAL lineage, teardown and disposability.
- A separately authorized, minimal additive test against the **frozen** M03 implementation to exercise authenticated operator reconciliation and signed revision enforcement — no change to Migration 0061.
- Project Owner acceptance and Agent 06 independent certification before D-02 can be closed.

D-02 remains **BLOCKED**. M03 remains `M03_CONDITIONALLY_ACCEPTABLE`, unmerged, and Production remains `NO-GO`.
