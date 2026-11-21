# M03-213-03 — Migration 0061 DBA/IAM Governance Decision

**Status:** POLICY PROPOSAL ONLY / GOVERNANCE OPEN. **Human DBA and IAM signatures: PENDING.** 2026-11-21. Immutable implementation SHA a49d0379da06749ef5f163d9e48e9a053d2a375b; tree 419ebd78ebd2294dd7c2482d5fed6f78ec462b5e.

## Verified SQL and privilege boundary

[0061 migration source](../../packages/database/migrations/0061_legacy_cms_publication_identity.sql) is an additive migration; journal entries are contiguous 0–60 with 0061 at index 60. Its installation/publication mapping tables have PK, FKs to Application/Installation/Publication/Workspace, digest/count checks and RESTRICT delete relationships. The guard is a row-level BEFORE INSERT/UPDATE/DELETE SECURITY DEFINER trigger, with search_path pg_catalog, pg_temp; normal runtime session users are denied DML and the runtime role is denied TRUNCATE, including actual SQLSTATE 42501 tests on PG16.16. Owner DELETE is refused. REVOKE ALL FROM PUBLIC exists.

**Remaining high-impact trusted authority:** the table owner may UPDATE any mapping/identity fields and potentially execute TRUNCATE. A row trigger does NOT protect TRUNCATE (statement-level only), and an unrestricted owner/superuser may alter trigger protections. This does not prove ordinary runtime access to TRUNCATE and is not a new confirmed runtime privilege escalation. It is an operator governance gap.

## Threat model and identity invariants

- Immutable under routine reconciliation: installation_id, application_id, publication_id (including pub_default), legacy_workspace_id, legacy_slug, primary_locale, original mapping ownership. No silently reassigned Publication/Tenant or Installation.
- Existing code refuses wrong Application/Installation binding and inventory drift; a forged privileged owner UPDATE can still bypass that policy or damage evidence. Treat trusted owner credentials as high-impact; never assume code review alone controls them.
- Metadata corrections permitted only with separate reviewed authorization: installation publication_count and nonnegative inventory count columns, inventory_digest, mapped_at/mapped_by provenance; publication count columns, publication_digest and mapped_at. The existing idempotent mapping routine **does not authorize or implement corrections**. Unrestricted direct owner SQL UPDATE is not an approved correction workflow.
- Do not UPDATE integrity digest merely to suppress a drift alert. Record affected tenants/publications, original and corrected digest, old/new counts, scoped actor ID, reviewed rollback/compensation plan, before/after backup and human DBA/IAM audit ticket.

## TRUNCATE, role separation and additive enforcement decision

**Runtime:** TRUNCATE must remain denied with verified effective privilege and negative SQLSTATE. **Ordinary trusted operator:** direct TRUNCATE prohibited by policy. A new statement-level BEFORE TRUNCATE guard is optional defense-in-depth; it cannot make a table owner/superuser untrusted. Durable protection requires a separate non-owner correction executor with no DDL or broad table ownership and a narrow audited, approved metadata surface.

**Three actual decision choices (none approved yet):**
1. Accept existing owner credential as a highly restricted *experimental* operator-only root with procedural two-person approval and tested backups. This is NOT an endorsement of production immutability; needs Agent02, Agent05, owner, human DBA/IAM and independent Agent06 approval.
2. Require separate non-owner correction role, column-restricted DML or reviewed function, explicit actor provenance/immutable-key guard, audit and tested recovery before canonical adoption. **Preferred future hardening candidate**, not implemented here.
3. Add statement-level TRUNCATE and identity-column guards through a **new additive** migration with negative role tests; still cannot claim protection from genuine DB owner/superuser with DDL power.

**Owner-controlled outcome:** PENDING. No new migration, role changes, privilege grants or historical SQL edits authorized in this documentation-only batch. If enforcement is mandated, implement the minimum independently reviewed additive migration on a new SHA with complete affected integration, role, backup/restore and CI verification. No M03-213-03 closure until approved governance decision.

## Restore and forward-fix

[Real C01 logical restore](https://github.com/AbdullahZaher/vibress/actions/runs/44831801713) on PG16.16 succeeded: pg_dump -Fc, pg_restore into fresh DB, three Publications, immutable mappings, SHA-256 digest e13689bc5ef5d0720dd6f979ea02d3681f761f6ac9b27b65bf197312eb2d4cf5 retained; owner UPDATE in rolled-back transaction, DELETE refusal, runtime TRUNCATE refusal, wrong binding and induced drift refusal. Custom archive 352960 bytes. **Logical** backup/restore only, not physical cluster PITR and not evidence of production DR.

After restore: verify identities, FKs, per-publication counts, full inventory digests, runtime ACL, trigger owner/search_path and audit records; perform read-only idempotent reconcile. On stale digest or wrong binding, STOP. Proposed forward-fix requires separately authorized verified source state, minimal compensating/additive migration, tested rollback/restore and independently verified recomputed digest. Never rewrite migration 0061, auto-rebind or grant runtime DML.

## Approval / risk decision record

| Field | Actual status |
| --- | --- |
| Agent 02 DBA scope, risk, evidence and verdict | PENDING |
| Agent 05 IAM scope, roles and least privilege verdict | PENDING |
| **Human DBA name/identity, reviewed immutable SHA, timestamp, URL** | **PENDING** |
| **Human IAM name/identity, reviewed immutable SHA, timestamp, URL** | **PENDING** |
| Project Owner explicit enforcement/policy decision | PENDING |
| Agent 06 independent concurrence and signed review URL | PENDING |
| Verified rollback + DR for any privileged correction or additive migration | PENDING |
| Risk acceptance | NONE |
| Production deployment / merge | NOT AUTHORIZED |

Any sensitive exception must have written risk assessment, specialist verdict, Agent 06 concurrence, verified backup and recovery, minimal scope/time and logged expiry or be refused. No fabricated signatures.

**Primary research checked 2026-11-21:** [PG16 privileges/owner](https://www.postgresql.org/docs/16/ddl-priv.html), [statement-level TRUNCATE](https://www.postgresql.org/docs/16/trigger-definition.html), [SECURITY DEFINER](https://www.postgresql.org/docs/16/sql-createfunction.html), [pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html).
