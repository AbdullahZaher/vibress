-- PROPOSED ONLY — NOT APPROVED, NOT APPLIED, NOT IN THE MIGRATION JOURNAL.
-- Date: 2026-11-14. Approval request: ../R26-REVOCATION-APPROVAL-REQUEST.md
--
-- R26 remediation: stop PostgreSQL's default EXECUTE ON FUNCTION TO PUBLIC from
-- exposing owner-created functions to every role that can connect.
--
-- This file lives under docs/ on purpose so packages/database/src/migrate.ts and
-- drizzle-kit cannot pick it up. To apply it:
--   1. Replace <MIGRATION_OWNER> with the real owner role (dev fixture: vibress).
--   2. Run the inventory against the production-shaped role set first and
--      attach it to the approval request.
--   3. Apply as the migration owner, never as a runtime role.
--   4. Run the verification section, then re-run
--      scripts/audit-function-privileges.mjs and expect role denial.
--   5. Update the residual integration test to expect SQLSTATE 42501 in the
--      same change; it currently pins the open behavior and will fail otherwise.
--
-- Scope notes:
-- - The default-privilege change is GLOBAL, not schema-scoped. Measured on
--   PostgreSQL 16.15: `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public REVOKE
--   EXECUTE ON FUNCTIONS FROM PUBLIC` stores no entry and changes nothing,
--   because a schema-scoped entry is applied on top of an empty baseline
--   (SetDefaultACL: `def_acl = make_empty_acl()`), while PUBLIC EXECUTE on new
--   functions comes from the hard-wired acl default that only a global entry
--   replaces. Consequence: the global entry also covers functions the
--   migration owner creates outside schema public. Verified in
--   tests/integration/platform-r26-revocation.test.ts.
-- - The migration owner must be the role that actually creates functions;
--   objects created by another role (including a superuser bootstrap) are not
--   covered by this entry and stay PUBLIC-executable until reviewed.
-- - Extension functions (pg_trgm) are intentionally NOT revoked: extension
--   upgrades recreate them, so the revocation would not be durable. They expose
--   no table data (see R26 inventory section 7). ALTER DEFAULT PRIVILEGES does
--   apply to functions an extension script creates later; see the operational
--   risk in the approval request (section 6) before applying.
-- - Trigger functions are executed without a runtime EXECUTE check; EXECUTE is
--   required only when CREATE TRIGGER is issued. Revoking PUBLIC here therefore
--   does not break existing triggers.
-- - This scope does NOT revoke the explicit EXECUTE grants held by the legacy
--   runtime role (vibress_app). That is Scope B in the approval request and needs
--   a provisionRuntimeRole code companion; applying SQL alone would be reverted
--   by the next migration run.

BEGIN;

-- 1. Close direct invocation of the two migration-created trigger functions.
REVOKE EXECUTE ON FUNCTION public.prevent_comment_moderation_events_mutation()
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vibress_plugin_storage_append_only()
  FROM PUBLIC;

-- 2. Future functions created by the migration owner are closed by default.
--    Replace <MIGRATION_OWNER> before running. No IN SCHEMA clause: a
--    schema-scoped entry cannot remove the hard-wired PUBLIC EXECUTE (see the
--    scope note above). Re-running is idempotent.
ALTER DEFAULT PRIVILEGES FOR ROLE <MIGRATION_OWNER>
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 3. Re-grant only to roles with a reviewed need. Leave empty until the
--    production inventory names them, e.g.:
-- GRANT EXECUTE ON FUNCTION public.some_reviewed_function() TO vibress_app;

-- 4. Fail closed if the measured precondition no longer holds: after the two
--    revokes above, no non-extension public function may still be executable by
--    PUBLIC. Any other such function is an unreviewed object; stop and inventory
--    it instead of silently leaving it exposed.
DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND NOT EXISTS (
       SELECT 1
         FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e')
     AND EXISTS (
       SELECT 1
         FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0
          AND a.privilege_type = 'EXECUTE');
  IF remaining > 0 THEN
    RAISE EXCEPTION
      'R26: % non-extension public function(s) still executable by PUBLIC; inventory them before applying',
      remaining;
  END IF;
END
$$;

-- 5. Fail closed if the default-privilege change did not take effect. The
--    entry must be global (defaclnamespace = 0); a schema-scoped entry with
--    the same ACL does not affect object creation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_default_acl d
     WHERE d.defaclnamespace = 0
       AND d.defaclobjtype = 'f'
       AND pg_get_userbyid(d.defaclrole) = '<MIGRATION_OWNER>'
       AND NOT EXISTS (
         SELECT 1 FROM aclexplode(d.defaclacl) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      'R26: owner default function ACL still grants EXECUTE to PUBLIC';
  END IF;
END
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (read-only)
-- ---------------------------------------------------------------------------
-- node scripts/audit-function-privileges.mjs "<database url>"
--   expect: public_functions 33, public_execute 31 (all extension-owned),
--           default_acl_entries >= 1 with one global (defaclnamespace 0)
--           function entry whose ACL has no PUBLIC grantee
-- Then run the residual integration test with its assertion flipped to expect
-- 42501 for the platform runtime role.

-- ---------------------------------------------------------------------------
-- ROLLBACK (run only with owner approval; fully reversible)
-- ---------------------------------------------------------------------------
-- BEGIN;
-- GRANT EXECUTE ON FUNCTION public.prevent_comment_moderation_events_mutation()
--   TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.vibress_plugin_storage_append_only()
--   TO PUBLIC;
-- ALTER DEFAULT PRIVILEGES FOR ROLE <MIGRATION_OWNER>
--   GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
-- COMMIT;
--
-- Scope B rollback (legacy runtime role) is not written yet; it must re-grant
-- the previous explicit and default function privileges and revert the
-- provisionRuntimeRole code companion together with this SQL.
