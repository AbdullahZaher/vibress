-- PLUG-UPD-02B: durable, operator-only preflight and approval evidence.
-- Additive nullable columns preserve all existing staged/aborted plans.
-- This migration does not activate external code or migrate plugin data.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "plugin_upgrade_plans"
  ADD COLUMN "preflight_sha256" text,
  ADD COLUMN "preflighted_at" timestamptz,
  ADD COLUMN "approved_at" timestamptz,
  ADD COLUMN "approved_by" text;

ALTER TABLE "plugin_upgrade_plans"
  ADD CONSTRAINT "plugin_upgrade_plans_preflight_sha_check"
    CHECK ("preflight_sha256" IS NULL OR "preflight_sha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "plugin_upgrade_plans_preflight_required_check"
    CHECK (
      "status" NOT IN ('preflighted', 'approved', 'quiesced', 'migrated',
                       'activated', 'observed', 'completed')
      OR ("preflight_sha256" IS NOT NULL AND "preflighted_at" IS NOT NULL)
    ),
  ADD CONSTRAINT "plugin_upgrade_plans_approval_required_check"
    CHECK (
      "status" NOT IN ('approved', 'quiesced', 'migrated', 'activated',
                       'observed', 'completed')
      OR ("approved_at" IS NOT NULL AND "approved_by" IS NOT NULL)
    );
