# R26 — Independent Technical Validation / Authorization Package

**Date:** 2026-11-16  
**Pinned code:** `a96ea073767e303b02121d87558adbd12ce111f3` (PR #166); **Status:** **BLOCKED / NOT AUTHORIZED / NOT APPLIED**  
**Assessor:** Agent 02, AI-assisted technical assessment, not a human owner signature or Agent 06's independent concurrence.

## 1. Separate Scope A and B

**Scope A:** proposal `docs/platform-roadmap/execution/proposals/0055_revoke_public_execute.sql` revokes `PUBLIC EXECUTE` on `public.prevent_comment_moderation_events_mutation()` and `public.vibress_plugin_storage_append_only()`. A **GLOBAL** `ALTER DEFAULT PRIVILEGES FOR ROLE <MIGRATION_OWNER> REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` changes all future functions created by that role in **every schema**. The proposal is outside the migrations directory and journal; this must remain so until authorized. Every creator role has its own defaults.

**Scope B:** explicit grants to legacy `vibress_app` must be remediated independently. `packages/database/src/runtime-role.ts` currently calls:
```sql
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO <legacy_runtime>;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO <legacy_runtime>;
```
It also grants schema `CREATE`, broad DML on all public tables and broad sequence rights. `packages/database/src/migrate.ts` runs that provisioning after migrations, so SQL-only Scope B revocation will be recreated unless the code companion is deployed. Scope B must enumerate legitimate CMS/plugin callables before changing code/grants.

## 2. Observed evidence and absence of verification

- Repository historical fixture inventory (not re-measured): PG16.15, 33 public functions, 31 extension-owned `pg_trgm`, 2 non-extension triggers, 0 `SECURITY DEFINER`, 33 effective `PUBLIC EXECUTE`, 0 default ACL rows, only superuser login on fixture.
- `tests/integration/platform-r26-revocation.test.ts` is written to create a throwaway DB and non-superuser owner/caller and apply/revert the Scope A proposal. Recorded result in PR description: 4/4 PASS. **Not independently run here.**
- This audit cannot confirm production default ACLs, inherited grants, effective role permissions or legitimate out-of-repository callers. Query pack below is **prepared, not executed**.
- A potential post-check inconsistency was corrected in the accompanying request: `defaclnamespace = 'public'::regnamespace` does NOT find the required GLOBAL default ACL. Use `defaclnamespace = 0` for the creating role and object type `f`.
- Trigger functions are not generally direct-callable as ordinary SQL functions. Current impact of their PUBLIC EXECUTE is not presented as an already proven escalation. Future functions and legacy blanket grants are the main concern.

## 3. Exact release authorization request — not an approval

| Decision | Request | Status |
| --- | --- | --- |
| R26-A | Approve *global* default-privilege change for the named actual function creator, and revoke PUBLIC on the two identified trigger functions, after inventory and extension compatibility | **BLOCKED** |
| R26-B | Approve reducing legacy API/worker function grants, schema CREATE and default ACLs via reviewed code+SQL companion with explicit allowlist | **BLOCKED** |
| R26-EXT | Decide how extension update/installation gets required EXECUTE on `pg_trgm` and any additional routines under a global default revocation | **BLOCKED** |
| R26-DEPLOY | Choose a separate non-superuser migration owner, provisioner role, and separate DB administration role | **BLOCKED** |
| R26-ROLLBACK | Verify forward-fix and rollback in a disposable clone, plus a separately tested restore | **BLOCKED** |

**Sensitive authorization prerequisites:** written blast-radius analysis; affirmative DBA-specialist and AppSec verdicts plus Agent 06 concurrence; verified backup and restore/rollback proof; minimal target scope/window; logged decision with expiry for any accepted risk. These are NOT all met; no permission change is approved.

## 4. Blast radius and sequencing

1. Read-only inventory under the intended deployment topology with `R26-ROLE-PRIVILEGE-READONLY-AUDIT.sql`; retain output, timestamp, server version and schema hash. Check every creator role and explicit/inherited grants.
2. Require PG 16.16+ (16.x) after evaluating 2026-11-12 security update, or a later fixed patch. Identify any `pg_trgm` upgrade consequences and required operator-owned routines.
3. Snapshot/restore test into disposable PostgreSQL. Exercise migration replay with non-superuser owner and isolated A/B identities.
4. Rehearse Scope A and its in-file rollback on disposable clone only. Validate two trigger functions lost PUBLIC; unrelated non-extension functions 0 PUBLIC; global default ACL `defaclnamespace=0`; independent session `has_function_privilege=false` and direct callable `42501`; legitimate triggers and trigram search pass.
5. Scope B: deploy code companion so `runMigrations` does not regrant privileges; then revoke explicit and owner default legacy grants. Test against a non-overprivileged runtime, worker, CMS, Studio, plugin installation and migration replay.
6. After any migration or extension upgrade, repeat inventory and reject unexpected PUBLIC/explicit/inherited EXECUTE. Then independent Agent 06 re-verifies source and SQL evidence.

**Important:** Scope A revocation on two trigger functions and a default ACL does not automatically remove the pre-existing explicit grants to `vibress_app`, nor would it cover functions created under another owner.

## 5. Negative and compatibility matrix

| Test | Expected outcome | Proof |
| --- | --- | --- |
| Unrelated login invokes nonextension owner-created callable after Scope A | `42501` | Missing |
| `PUBLIC` ACL for two trigger functions | Absent after A | Missing |
| Global future default owner ACL | No PUBLIC EXECUTE; `defaclnamespace=0` | Missing |
| Explicit legacy API/worker function call not allowlisted after B | `42501` | Missing |
| Inherited grants and `SET ROLE` from serving identities | No exploitable membership, no unauthorized SET | Missing |
| Existing CMS triggers / trigram ranking | Functional | Missing |
| Same migration runner executed a second time | Does not regrant disallowed EXECUTE | Missing |
| Adding owner-created function in another schema | Not PUBLIC-executable | Earlier repo test claim only |
| Non-privileged owner / production-shaped non-superuser role | FORCE RLS denial and correct positive tests | Missing |
| Scope A transaction fails guard after unreviewed function | Full rollback, no partial ACL mutation | Earlier repo test claim only |
| Post-revocation backup restoration | Verified recovery | Missing |

## 6. Rollback / forward-fix

Scope A's rollback section exists **commented** in the proposal: regrant PUBLIC EXECUTE on the two identified functions and restore the creator's PUBLIC function defaults, which also lifts the policy for subsequent functions. A new function created while default PUBLIC was revoked **retains** its created ACL; rollback does not automatically change old objects. If A+B are both applied, restoring B requires a separately reviewed symmetric legacy grant change **and** synchronized code rollback. No verified full rollback or restore evidence exists at this review.

## 7. Specific status

- **R26 Scope A:** SQL proposal prepared; not applied; owner approval absent.
- **R26 Scope B:** not implemented; old code will restore privileges.
- **R26 independent live SQL validation:** BLOCKED, no test DB access.
- **Recommendation:** **NO-GO** until A+B disposition, patched PG version, real-role privilege graph, staged compatibility and independent approval.

## Sources (checked 2026-11-16)

- https://www.postgresql.org/docs/16/sql-alterdefaultprivileges.html
- https://www.postgresql.org/docs/16/sql-grant.html
- https://www.postgresql.org/docs/16/role-membership.html
- https://www.postgresql.org/support/security/CVE-2026-120154/ (fixed 2026-11-12)
- https://github.com/AbdullahZaher/vibress/blob/a96ea073767e303b02121d87558adbd12ce111f3/docs/platform-roadmap/execution/proposals/0055_revoke_public_execute.sql
- https://github.com/AbdullahZaher/vibress/blob/a96ea073767e303b02121d87558adbd12ce111f3/packages/database/src/runtime-role.ts
