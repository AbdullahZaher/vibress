# Vibress Content Modeler — Schema Evolution

Content Modeler uses PostgreSQL JSONB field definitions. The diff preview
`POST /api/admin/v1/content-models/:id/schema-evolution-preview` classifies
field changes; it is **not** a migration or backfill engine.

The editor lives under
`/admin/settings/advanced/content-models/:modelId`. Historic admin URLs
redirect to the new Settings location without changing public APIs.

## Safe changes

Optional additions are generally safe. Field removals leave historical JSONB
data stored, but the removed keys stop appearing in the active model output.
Changing a field key is classified as an addition and a removal; no implicit
key-renaming or migration takes place.

## Breaking changes

New required fields (even with defaults), changed types, narrowed select
options, tightened validation constraints, different relation targets,
localization changes, and increased field exposure are treated as unsafe.
When any entries exist for the model—including soft-deleted records—an
unsafe update is blocked. The existence check and update run in a transaction
with a parent-row lock.

The API returns `400 VALIDATION_ERROR` for such changes, without updating
the stored model. A model with existing records cannot be deleted through
the admin API: it returns `409 MODEL_IN_USE` to avoid a cascading purge.

## Operational procedure

For a breaking change, first back up and export the publication data, review
impacts on public APIs, themes and plugins, and perform a separately approved
migration/backfill. Only then commit the new field definition. Do not rewrite
released SQL migrations or assume that Preview has transformed stored entries.

The preview response is `{ data: { safe, warnings, changes } }`. Each
change contains `key`, `action` (added, removed or modified),
`isSafe`, and an optional `warning`.
