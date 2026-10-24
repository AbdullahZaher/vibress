# P0-2 — Operator-trusted release catalog v1

**Implementation:** `feat/plugin-platform-trust-catalog-20261024` (not merged or production-certified).
**Scope:** optional metadata on an existing operator-controlled lockfile; no package upload, URL install, downloaded code or executable marketplace.
**Compatibility:** existing `schemaVersion: 1` lockfiles without `release` remain valid. No database migration or plugin SDK ABI change.

## Format and admission

Each `plugins[]` entry in the existing lockfile may add a `release` object:

```json
{
  "schemaVersion": 1,
  "releaseId": "hello-public@1.0.0:<64-lowercase-hex-ESM-SHA256>",
  "publisher": {
    "id": "reviewed-publisher",
    "name": "Reviewed Publisher"
  },
  "compatibility": {
    "minVibressApiVersion": "1.0.0",
    "maxVibressApiVersion": "1.0.0",
    "sdkAbiVersion": "1.0.0"
  },
  "capabilities": ["extension.routes.public"],
  "sbom": {
    "path": "evidence/sbom.json",
    "sha256": "<64-lowercase-hex-file-SHA256>"
  },
  "provenance": {
    "path": "evidence/provenance.json",
    "sha256": "<64-lowercase-hex-file-SHA256>"
  },
  "migrationPlans": [
    {
      "id": "0001_initial",
      "path": "evidence/migration-plan.json",
      "sha256": "<64-lowercase-hex-file-SHA256>"
    }
  ]
}
```

This is an illustrative **fragment**, not a complete valid lockfile: replace every placeholder with final reviewed file hashes, and match `release.capabilities` exactly to the entry's existing `manifest.capabilities`. The optional `sbom`, `provenance` and `migrationPlans` fields can be omitted. Never place a private signing key or credentials in the lockfile or referenced files.

- `releaseId` must equal `<manifest.id>@<manifest.version>:<entry.sha256>` with the entry checksum normalized to lowercase. An upgraded binary changes the identity even when its human-readable version is reused. For metadata-enabled entries, version is limited to safe ASCII version characters and 64 characters.
- `publisher` is an operator-reviewed identity string, **not** independently cryptographically authenticated publisher identity. Signing the lockfile attests the operator's approval, not a third-party publisher's claim.
- `compatibility` currently requires `minVibressApiVersion`, `maxVibressApiVersion` and `sdkAbiVersion` to equal the currently supported `SDK_VERSION` (`1.0.0`). This is an **exact range** only; broader ranges are not implemented or inferred.
- `capabilities` must match the validated installed manifest exactly, including ordering; the metadata cannot add runtime permissions or authorize a publication.
- Evidence paths must be safe, operator-root-relative `.json` paths with bounded depth/length and lowercase SHA-256 values. URLs, drive paths, `..` segments, repeated paths and duplicate migration IDs are rejected. The preflight also requires well-formed UTF-8 JSON objects, but does not certify any particular SBOM/provenance serialization standard or claim contents are truthful.
- Migration plan IDs are metadata only. Starting with P0-3, preflight also checks each pinned migration plan's JSON content against the exact release digest and operator-approved model descriptors. Actual migrations still require separate explicit authorization and application; merely listing a plan never executes or approves SQL.

## Operational verification

1. Stage the immutable ESM, optional Admin HTML and optional JSON evidence in an operator-controlled release directory outside CMS uploads. Review source, transitive dependencies, provenance and licensing offline.
2. Compute SHA-256 of the **final** files, fill the lockfile and sign the complete lockfile bytes using the existing detached Ed25519 process. The public verification key must be operator-controlled and **never** distributed from a plugin package. Legacy unsigned lockfiles remain supported unless strict policy is enabled.
3. Run `pnpm exec tsx scripts/plugins/preflight.ts` (or the production-bundled preflight) **on every API/Worker deployment replica**. This validates actual pinned ESM, Admin HTML and JSON evidence bytes, with file type, size, symlink and directory escape rejection, without evaluating code, fetching URLs, or applying migrations. Evidence is bounded at 2 MiB for SBOM/provenance and 256 KiB for migration plans.
4. Only after preflight and migration approval, register or update the trusted release using the existing operator lifecycle. Global activation and per-publication enablement remain separate. Retain a backup of matched artifact bytes, signed lockfile, DB and queue state before upgrade.
5. During rollback, restore the exact matching operator-owned files and signed lockfile on **all** replicas. A previous release ID does not authorize rollback of incompatible DB migrations.

## Admin contract

The existing operator-only `GET /api/admin/v1/plugins/trusted-available` response is extended **additively** with optional `release`: `releaseId`, `publisher`, `artifactSha256`, `compatibility`, `hasSbom`, `hasProvenance` and `migrationPlanIds`. No evidence paths, URLs, signature/key locations, credentials or executable bytes are exposed. `signatureVerified` remains independent and true only when a detached Ed25519 signature was actually verified. A release summary means **declared and operator-pinned**, not automatically that every evidence file passed runtime preflight at request time.

`POST /api/admin/v1/plugins/register-trusted` retains its existing body and operator-only authorization. Staff cannot upload code, supply package data, grant capabilities or choose publication context from the release catalog. Old API clients ignore the new optional field; old lockfile entries keep working.

## Verification and remaining gates

Unit tests target v1 compatibility, identity and capability mismatch, unsupported compatibility, unsafe/duplicate paths, tampering, symlinks, signature verification and UI display. Full `pnpm typecheck`, `lint`, Vitest, integration, Docker/Worker rolling rollout and CI must pass before release acceptance.

**Not implemented here:** automatic downloads, publisher identity certification, a transitive dependency/SBOM schema scanner, general semantic-version negotiation, active release pinning against registry mutation, automated migration execution, untrusted plugin containment and automatic rollback. See [the production plan](plugin-platform-production-plan.md) and [the security runbook](external-extension-operator-runbook.md).
