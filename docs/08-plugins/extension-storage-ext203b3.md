# EXT-203B3 — Staff-authorized Host storage binding and additive SDK contract

**Status:** Draft; internal operator-vetted extension functionality.
This is not a generalized database API and is **not** a Member/Public storage API.

## Contract

The existing `PluginApiRoute.handle(input, scope)` method stays unchanged.
`PluginApiScope.storage` is a new **optional** SDK capability with narrow,
typed `get/list/create/update` operations on approved logical model keys.
The extension never supplies `publicationId`, `pluginId`, SQL, table names,
or a Drizzle connection when using the storage API.

The Host creates the per-request storage object only when **all** of the
following are true:

1. The extension route was admitted and executed under the existing Admin
   authentication + origin controls, with an authoritative Staff publication
   context and route-specific Staff permission.
2. The requesting Staff principal independently holds `plugins.manage`
   for that publication, even if the route's declared permission is weaker.
3. The installed plugin is active, scoped to that publication, and declares
   at least one `extension.storage.read/write` capability.
4. The operator-owned `VIBRESS_TRUSTED_PLUGIN_LOCKFILE` has an optional
   `storageModels` array on that plugin entry. Entries are fixed-type scalar
   descriptors, 1–24 columns per model, maximum 16 models, validated and
   SHA-256-matched before the Host constructs a session.
5. The existing PostgreSQL repository revalidates plugin status,
   publication enablement, operation-specific capability, immutable table
   ownership and the approved model schema digest **within each operation**.

Member and Public extension routes **never receive** `scope.storage`.
The Host closes the request session in `finally`; retaining its SDK object
for later use rejects operations with `PLUGIN_STORAGE_SESSION_CLOSED`.
No HTML, shared SQL, cross-plugin model selection or callback transaction API
is exposed. Existing v1 plugins still run without storage.

## Operator lockfile extension (additive)

An example optional entry in the trusted ESM lockfile:

```json
{
  "schemaVersion": 1,
  "plugins": [{
    "manifest": "<existing operator-approved manifest object>",
    "sha256": "<verified module SHA-256>",
    "storageModels": [{
      "key": "courses",
      "schemaSha256": "<SHA-256 of JSON.stringify(columns)>",
      "columns": [{ "name": "title", "type": "text", "required": true }]
    }]
  }]
}
```

The example uses placeholders: substitute the full valid manifest and exact
operator-computed digests, and only approve columns that match the existing
immutable 0042/0043 physical model catalog. The operator must verify the
lockfile/artefact chain and perform approved offline schema admission;
the plugin cannot create physical models during HTTP requests. New model
descriptors cannot silently overwrite an installed table's checksum.
Legacy lockfiles without `storageModels` remain valid.

## Security and rollout limits

This is still trusted in-process JavaScript, **not a sandbox**.
`PluginApiScope.storage` is a Host-mediated service, not a defense against
arbitrary Node process access by a malicious operator-installed extension.

Before implementing member/course registration, lessons or entitlements:
design model-specific ownership and visibility, transactional foreign keys,
composite publication-aware relations, idempotency, and Member publication
authority. Do not enable Member/Public generic CRUD to compensate for missing
LMS domain rules.

Operator-approved physical models must be trialled against a restored,
populated PostgreSQL staging backup before production rollout. Full live
physical schema attestation, signature provenance and cross-model atomicity
remain outstanding. Do not consider the independent LMS pilot complete.

## Verification

Cover operator lockfile legacy acceptance, tampered/duplicate/missing capability
rejection, immutable Host/session binding and revocation, tenant selector
rejection and no-storage Member route behavior. Preserve existing EXT-203B2
database tests for two publications, denied writes, concurrency and upgrade.
Run full CI and PR E2E before merging.
