# M03 D-01 — Final Technical Decision Package (READY V2 fence)

**Decision ID:** D-01
**Milestone:** M03 (open, `M03_CONDITIONALLY_ACCEPTABLE`, not merged)
**Status:** PENDING — no owner, Agent 05 or Agent 06 approval exists for this package.
**Production:** NO-GO. Risk acceptance: NONE.

This package narrows an already-documented draft into a single owner decision. It does not create a new approval and does not implement anything.

## Source evidence (read before deciding)

- Frozen implementation: `a49d0379da06749ef5f163d9e48e9a053d2a375b`, tree `419ebd78ebd2294dd7c2482d5fed6f78ec462b5e`.
- Independent verdict: [issue #197](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-7062090919) — `M03_CONDITIONALLY_ACCEPTABLE`.
- Existing draft disposition: `docs/platform-roadmap/M03-FINAL-OWNER-DECISION-RECORD.md` (DRAFT, not approved) at `cf99126a`.
- Implementation boundary: `packages/database/src/schema-operator-experimental-admission.ts` explicitly excludes general V2 serving registration.
- Normative scope: `docs/platform-roadmap/milestones/M03-schema-data-engine.md`, M03-E07/E11.

## Decision question

Should the generic READY V2 principal + tenant transaction fence be **deferred to its owning future milestones** (M04 generated runtime via issue #156, M08 production recovery/GA via issue #160), rather than treated as a required M03-S03 acceptance item?

## Options

| Option | Disposition | Consequence | Currently authorized? |
| --- | --- | --- | --- |
| **A (technical recommendation)** | `DEFER_TO_EXISTING_FUTURE_RUNTIME_MILESTONE` | M03 remains restricted; no general post-PITR admission; M04/M08 must carry the full fence and negatives before any runtime GO | No — needs owner decision |
| B | Require the generic fence inside the current M03 candidate | New implementation, new SHA, full PG16/race/PITR re-test and fresh Agent 06 certification; no M04 Batch 03 activation | No — not authorized |

Option A does not authorize M04 runtime, M04 Batch 03, production DDL, or any generalized post-recovery admission. A refusal/fail-closed result is not proof that a generic fence exists.

## Guardrails if Option A is accepted

- Named boundary: generated runtime authentication + transaction scope (M04), production physical recovery admission (M08).
- Required future negatives: per-transaction signed principal/tenant/role identity, lease/epoch binding, revoked principal/session/token denial, cross-tenant/SSR/cache negatives, retained-vs-rewound PG16 PITR, mixed-version worker replay/idempotency, CI + rollback + independent Agent 06.
- Frozen restrictions unchanged: Policy A, P05/R1, P06/E2-A, D1 = 2517 ms restricted, M = NOT DETERMINABLE, DELTA-08 and P07-RC-C disabled, Production NO-GO, Risk Acceptance NONE.

## Required approvals (all PENDING)

1. Agent 05 — formal IAM scope note naming the owning boundary and owner.
2. Project Owner — written disposition A or B.
3. Agent 06 — decision-specific concurrence on the immutable evidence.

Agent 01's preparation of this package is not an approval. No agent may sign for the Project Owner, IAM owner or independent reviewer.

## Approval record (blank fields are not signatures)

| Role | Name | Decision | Reference URL | Date |
| --- | --- | --- | --- | --- |
| Agent 05 IAM | — NOT PROVIDED — | PENDING | — | — |
| Project Owner | — NOT PROVIDED — | PENDING | — | — |
| Agent 06 independent | — NOT PROVIDED — | PENDING | — | — |
