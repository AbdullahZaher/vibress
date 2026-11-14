-- PROPOSED ONLY — NOT APPLIED, NOT IN THE MIGRATION JOURNAL.
--
-- R26 remediation: stop PostgreSQL's default EXECUTE ON FUNCTION TO PUBLIC from
-- exposing owner-created functions to every role that can connect.
--
-- This file lives under docs/ on purpose so packages/database/src/migrate.ts and
-- drizzle-kit cannot pick it up. To apply it:
--   1. Replace <MIGRATION_OWNER> with the real owner role (here: vibress).
--   2. Run the inventory against the production-shaped role set first.
--   3. Apply as the migration owner, never as the runtime role.
--   4. Re-run scripts/audit-function-privileges.mjs and expect role denial.
--
-- Scope notes:
-- - Extension functions (pg_trgm) are intentionally NOT revoked: extension
--   upgrades recreate them, so the revocation would not be durable. They expose
--   no table data (see R26 inventory section 7).
-- - Trigger functions are executed without a runtime EXECUTE check; EXECUTE is
--   required only when CREATE TRIGGER is issued. Revoking PUBLIC here therefore
--   does not break existing triggers.

BEGIN;

-- 1. Close direct invocation of the two migration-created trigger functions.
REVOKE EXECUTE ON FUNCTION public.prevent_comment_moderation_events_mutation()
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vibress_plugin_storage_append_only()
  FROM PUBLIC;

-- 2. Future functions created by the migration owner are closed by default.
--    Replace <MIGRATION_OWNER> before running.
ALTER DEFAULT PRIVILEGES FOR ROLE <MIGRATION_OWNER> IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 3. Re-grant only to roles with a reviewed need. Leave empty until the
--    production inventory names them, e.g.:
-- GRANT EXECUTE ON FUNCTION public.some_reviewed_function() TO vibress_app;

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run only with owner approval; fully reversible)
-- ---------------------------------------------------------------------------
-- BEGIN;
-- GRANT EXECUTE ON FUNCTION public.prevent_comment_moderation_events_mutation()
--   TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.vibress_plugin_storage_append_only()
--   TO PUBLIC;
-- ALTER DEFAULT PRIVILEGES FOR ROLE <MIGRATION_OWNER> IN SCHEMA public
--   GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
-- COMMIT;
