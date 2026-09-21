-- Migration: 0030_remove_visual_automations.sql
-- Description: Drop Visual Automations tables, indexes, constraints, and remove automation permissions

BEGIN;

-- 1. Drop tables in strict child-to-parent dependency order
DROP TABLE IF EXISTS "automation_run_steps";
DROP TABLE IF EXISTS "automation_runs";
DROP TABLE IF EXISTS "automation_versions";
DROP TABLE IF EXISTS "automations";

-- 2. Clean up automation permissions from role assignments and permissions dictionary
DELETE FROM "role_permissions"
WHERE "permission_id" IN ('automations.read', 'automations.manage', 'automations.run');

DELETE FROM "permissions"
WHERE "id" IN ('automations.read', 'automations.manage', 'automations.run');

COMMIT;
