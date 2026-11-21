# M03 D-02 — Frozen Operator Verification Blocker and Minimum Test Integration

**Date:** 2026-11-21
**Frozen implementation:** `a49d0379da06749ef5f163d9e48e9a053d2a375b`, tree `419ebd78ebd2294dd7c2482d5fed6f78ec462b5e`
**Status:** bounded investigation COMPLETE; D-02 remains **OPEN / BLOCKED**; no frozen source, Migration 0061 or grant was changed.

## What was done

The disposable PG16 PITR drill (`scripts/platform/m03/backfill-pitr-drill.sh`) was executed twice with 9/9 assertions passing and exit 0. It proves physical retained/rewound recovery, journal reconciliation, an external authority anchor, unknown-COMMIT preservation, duplicate prevention and an operator forward-fix using a synthetic schema.

## Why that is not frozen-operator verification

Source inspection of the frozen `packages/database/src/platform-schema-migration-operator.ts` shows the real operator is not a standalone SQL helper. Before any Backfill operation it requires:

1. `assertAuthority` — effective operator/runtime role checks, `rolsuper`/`rolbypassrls` refusal, table ownership and RLS catalog verification.
2. An installation registry row binding installation/application/environment/database/operator/runtime roles plus a canonical trusted plan and matching plan digest.
3. `RecoveryEpochAuthority` external/local epoch agreement and re-enrollment refusal on epoch change.
4. P06 authorization records that are re-read and checked again after commit (`final P06 authorization stale, revoked, expired or invalid`).
5. A dedicated, quarantined-aware session with a D1 budget and verified `COMMIT` acknowledgements; `INDETERMINATE` and `VERIFIED_ROLLBACK` fences.
6. Internal journal/completed-operation tables and a strict `STALE_PLAN` / `JOURNAL_CONFLICT` admission path.
7. Explicit refusal when the database is not an exclusive nonproduction installation.

None of these structures exist in the synthetic drill schema, which uses direct `psql` superuser access. Replacing them with simpler SQL assertions would be exactly the "synthetic SQL assertions" the assignment forbids as full operator certification.

## Exact blocker

The frozen operator cannot be exercised against a disposable PG16 instance from the current execution branch without either:

- (a) porting the frozen operator and its internal dependencies/registry tables into this branch — which **changes the executable candidate** and requires a new SHA, full re-test and new independent certification; or
- (b) checking out the frozen tree in an isolated worktree and running its own operator test fixtures there — which does not change frozen source, but re-enters the already conditionally certified candidate and does not produce a new D-02 decision by itself.

Both require explicit authorization because D-01/D-03 and the owner merge decision are still pending. I did not perform either.

## Minimum new test-only integration (proposed, not executed)

1. Create a disposable worktree at frozen SHA `a49d0379`; do not edit its implementation.
2. Add a **test-only** fixture that provisions: exclusive nonproduction installation, registry row, canonical plan, P06 approvals, recovery epoch authority, non-superuser operator/runtime roles, and the operator's journal tables.
3. Run the 15 D-02 checks against that fixture with PG16: signed revision, authenticated operator admission, PROVISIONING/BUSINESS authority, explicit BACKFILL exclusion, retained/rewound chunks, journal consistency, unknown COMMIT, external epoch, revocation, wrong installation/tenant refusal, duplicate replay denial, bounded forward-fix, migration-history preservation and no automatic resumption.
4. Record exact PG16 version, fixture digests, negative SQLSTATEs, CI run and a new SHA if any test-only source is added.
5. Agent 06 independently inspects; Agent 02/04 issue verdicts; owner decides D-02. Only then can D-02 close.

## Verdict

- Physical PITR feasibility: **demonstrated**.
- Restricted E06/E09 operator recovery contract: **not yet demonstrated as sufficient**.
- D-02: **BLOCKED**. M03 remains `M03_CONDITIONALLY_ACCEPTABLE`; Production `NO-GO`.
