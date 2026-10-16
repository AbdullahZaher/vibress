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
Legacy JSONB field definitions may store constraints in `field.validation`;
preview and updates compare those constraints with the same top-level-first
precedence used when validating entry data. Tightening any effective legacy
constraint is unsafe, even when the proposed field switches to top-level keys.
Invalid field definitions (including duplicate or reserved keys) receive a
`400 VALIDATION_ERROR` from Preview rather than a misleading migration plan.
When any entries exist for the model—including soft-deleted records—an
unsafe update is blocked. The existence check and update run in a transaction
with a parent-row lock.

The API returns `400 VALIDATION_ERROR` for such changes, without updating
the stored model. A model with existing records cannot be deleted through
the admin API: it returns `409 MODEL_IN_USE` to avoid a cascading purge.

## Relation integrity and concurrent edits

New relation IDs/slugs must resolve within the active publication. Missing and
foreign references produce the same validation error and no global lookup is
performed. Existing stored dangling references remain readable and are
preserved when unchanged during an entry update; public relation resolution
continues to omit unavailable targets. This intentionally tightens new writes:
clients cannot create fresh dangling relationships.

Entry updates merge against the locked database row, not an earlier snapshot.
The optional `expectedVersion` continues to detect optimistic conflicts;
older clients without it retain field-level merge semantics for partial data.

## Operational procedure

For a breaking change, first back up and export the publication data, review
impacts on public APIs, themes and plugins, and perform a separately approved
migration/backfill. Only then commit the new field definition. Do not rewrite
released SQL migrations or assume that Preview has transformed stored entries.

The preview response is `{ data: { safe, warnings, changes } }`. Each
change contains `key`, `action` (added, removed or modified),
`isSafe`, and an optional `warning`.
