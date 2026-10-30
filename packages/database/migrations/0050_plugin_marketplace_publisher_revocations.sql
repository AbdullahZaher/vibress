-- M8.8: additive persistent publisher revocation tombstones.
-- Existing publishers are NOT implicitly approved by this migration.
SET LOCAL lock_timeout = '5s';

CREATE TABLE "plugin_marketplace_publisher_revocations" (
  "publisher_id" text PRIMARY KEY NOT NULL,
  "revoked_at" timestamptz NOT NULL DEFAULT now(),
  "reason" text,
  "operator_user_id" text NOT NULL
);
