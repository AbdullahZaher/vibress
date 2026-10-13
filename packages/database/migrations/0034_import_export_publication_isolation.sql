-- Existing jobs originated before tenant-aware job creation and are owned by
-- the historical default publication. Do not infer ownership from requested_by.
ALTER TABLE "import_export_jobs"
  ADD COLUMN "publication_id" text NOT NULL DEFAULT 'pub_default';
ALTER TABLE "import_export_jobs"
  ADD CONSTRAINT "import_export_jobs_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;
CREATE INDEX "import_export_jobs_publication_created_idx"
  ON "import_export_jobs" ("publication_id", "created_at");
