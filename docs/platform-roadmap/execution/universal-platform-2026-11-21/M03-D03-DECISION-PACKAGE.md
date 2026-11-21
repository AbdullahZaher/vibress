# M03 D-03 — Migration 0061 Trusted-Owner Policy Decision Package

**Decision ID:** D-03
**Milestone:** M03 (open, `M03_CONDITIONALLY_ACCEPTABLE`, not merged)
**Status:** PENDING — no human DBA/IAM approval exists for this package.
**Production:** NO-GO. Risk acceptance: NONE.

This package narrows an already-documented draft into one DBA/IAM decision. It does not alter Migration 0061 and does not authorize DDL.

## Source evidence (read before deciding)

- Migration: `packages/database/migrations/0061_legacy_cms_publication_identity.sql` (additive; must never be rewritten).
- Frozen implementation: `a49d0379da06749ef5f163d9e48e9a053d2a375b`, tree `419ebd78ebd2294dd7c2482d5fed6f78ec462b5e`.
- Existing draft: `docs/platform-roadmap/M03-FINAL-OWNER-DECISION-RECORD.md` (DRAFT).
- Governance background: `docs/platform-roadmap/M03-MIGRATION-0061-DBA-IAM-GOVERNANCE.md` (at `cf99126a`) and [PG16 logical restore run](https://github.com/AbdullahZaher/vibress/actions/runs/44831801713).
- Verified scope in draft: PK/FK/UNIQUE/digest checks, restricted `SECURITY DEFINER` search_path, runtime row DML/TRUNCATE denial tested; trusted-owner UPDATE and possible TRUNCATE remain.

## Decision question

Which trusted-owner policy is authorized for routine mapping reconciliation on installation/application/publication identity: accept the existing restricted boundary, or mandate a new additive guard before canonical use?

## Options

| Option | Disposition | Consequence | Currently authorized? |
| --- | --- | --- | --- |
| **A (technical recommendation)** | Accept existing restricted trusted-role boundary with immutable identity and audited metadata correction only | No new DDL; requires explicit human DBA + IAM acceptance and negative tests; no automatic rebind, no `pub_default` tenant substitution | No — human approvals PENDING |
| B | Mandate a new **additive** migration for statement-TRUNCATE denial and immutable-key guards | New SHA, full PG16 negative/replay/restore re-test and fresh Agent 06 review | No — not authorized |

Both options forbid rewriting 0061, forbid runtime DDL, and forbid claiming that a mutable row trigger constrains owner/superuser behavior. Ordinary operator and runtime TRUNCATE stay forbidden. Correctable fields are limited to reviewed counts/digests/provenance metadata after verified backup and before/after evidence.

## Required negative evidence before either option is signed

- Nonowner runtime and ordinary operator: UPDATE/TRUNCATE/DDL denial on 0061-managed relations, with expected SQLSTATE recorded.
- Identity immutability: installation/application/publication and original workspace identifiers cannot be rebound by trusted reconciliation.
- Audited correction: metadata-only change is logged with principal, before/after values and provenance.
- Restore/forward-fix: PG16 logical restore and additive forward-fix preserve identity and digest.
- Verified backup and tested rollback before any sensitive execution.

## Required approvals (all PENDING)

1. Agent 02 — DBA verdict on SQL scope and effective privileges.
2. Agent 05 — IAM verdict on operator/trusted-role separation.
3. **Named independent human DBA** — mandatory, cannot be delegated to an agent.
4. **Named independent human IAM** — mandatory, cannot be delegated to an agent.
5. Project Owner — sensitive-policy decision.
6. Agent 06 — confirmation on the immutable candidate.

No name, role, time limit or expiry is recorded here because none was provided.

## Approval record (blank fields are not signatures)

| Role | Name | Decision | Reference URL | Date | Expiry |
| --- | --- | --- | --- | --- | --- |
| Agent 02 DBA | — NOT PROVIDED — | PENDING | — | — | — |
| Agent 05 IAM | — NOT PROVIDED — | PENDING | — | — | — |
| Human DBA (independent) | — NOT PROVIDED — | PENDING | — | — | — |
| Human IAM (independent) | — NOT PROVIDED — | PENDING | — | — | — |
| Project Owner | — NOT PROVIDED — | PENDING | — | — | — |
| Agent 06 independent | — NOT PROVIDED — | PENDING | — | — | — |
