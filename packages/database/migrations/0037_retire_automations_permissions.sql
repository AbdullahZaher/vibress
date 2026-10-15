-- Retire only workflow automation permission grants. Existing workflow data is preserved.
DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  SELECT "id" FROM "permissions"
  WHERE "key" IN ('automations.read', 'automations.manage', 'automations.run')
);
--> statement-breakpoint
DELETE FROM "permissions"
WHERE "key" IN ('automations.read', 'automations.manage', 'automations.run');
