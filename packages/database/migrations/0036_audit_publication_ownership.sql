ALTER TABLE "audit_events" ADD COLUMN "publication_id" text;
--> statement-breakpoint
UPDATE "audit_events"
SET "publication_id" = "metadata"->>'publicationId'
WHERE "publication_id" IS NULL
  AND "metadata" IS NOT NULL
  AND jsonb_typeof("metadata"->'publicationId') = 'string'
  AND length(trim("metadata"->>'publicationId')) > 0;
--> statement-breakpoint
UPDATE "audit_events"
SET "publication_id" = "metadata"->>'publication_id'
WHERE "publication_id" IS NULL
  AND "metadata" IS NOT NULL
  AND jsonb_typeof("metadata"->'publication_id') = 'string'
  AND length(trim("metadata"->>'publication_id')) > 0;
--> statement-breakpoint
UPDATE "audit_events" AS ae
SET "publication_id" = p."publication_id"
FROM "posts" AS p
WHERE ae."publication_id" IS NULL
  AND ae."target_type" = 'post'
  AND ae."target_id" = p."id";
--> statement-breakpoint
UPDATE "audit_events" AS ae
SET "publication_id" = p."publication_id"
FROM "pages" AS p
WHERE ae."publication_id" IS NULL
  AND ae."target_type" = 'page'
  AND ae."target_id" = p."id";
--> statement-breakpoint
UPDATE "audit_events" AS ae
SET "publication_id" = m."publication_id"
FROM "media_assets" AS m
WHERE ae."publication_id" IS NULL
  AND ae."target_type" = 'media'
  AND ae."target_id" = m."id";
--> statement-breakpoint
CREATE INDEX "audit_events_publication_id_created_at_idx" ON "audit_events" ("publication_id", "created_at");
