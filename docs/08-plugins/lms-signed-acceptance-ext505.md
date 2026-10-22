# EXT-505: signed plugin-to-Member-storage acceptance (isolated integration)

This is a **CI integration fixture**, not a deployed Vibress LMS installation and not an operator release. Its purpose is to prove that the already-merged core contracts used by the separate `vibress-lms` Pilot work together without bypassing signature, migration or Member ownership checks.

## Verified in one disposable test

- Generate an ephemeral Ed25519 signing keypair **in memory**; sign exact operator lockfile bytes, pin a self-contained ESM plugin fixture and two LMS-shaped model declarations.
- Admit the release through the *production* `readVerifiedOperatorMigrationPlan` signature / artifact / model-digest checks. Reject modified migration metadata and changed executable bytes.
- Apply the exact reviewed migration through `PluginPhysicalSchemaMigrationService` and `DrizzlePluginStorageMigrationRepository`, with append-only ledger, declared physical columns and idempotent same-migration replay.
- Use the *actual* `TrustedExternalPluginHost` to import the pinned module and use the *actual* `DrizzlePluginMemberStorageRepository` behind request-lifetime Member storage sessions, for three test Members in two sites.
- Verify denied cross-Member reads, independent same-course enrollment IDs across sites, audit records without Member identifiers, publication disablement denying access, and persisted records remaining intact when a publication is disabled.

The test creates and drops its own unique PostgreSQL schema and temporary release directory. It does not mount real operator key material, modify released migrations, use a deployed CMS session, or run against customer data. It deliberately uses a small **synthetic LMS-shaped ESM fixture**, not a clone of the independently distributed `vibress-lms` artifact: this is contract/infrastructure verification, **not** end-to-end proof of the actual LMS package.

## Run

In the Vibress repository, with disposable PostgreSQL infrastructure available as required by the existing integration suite:

```sh
pnpm exec vitest run packages/domains/plugins/tests/signed-lms-pilot-postgres.test.ts
```

The standard Vibress PR `CI/build` Vitest job also picks up this test. No new environment variables or runtime dependencies are required for deployments.

## Release gates still open

1. Independently review and build the **real** `vibress-lms` Pilot, merge its operator descriptor into the full release lockfile and sign that lockfile using operator-controlled, offline keys.
2. Quiesce replicas and take a verified signed backup; use the merged read-only `scripts/plugins/check-migration-plan.ts` first and the separate confirmed `scripts/plugins/apply-migration-plan.ts` only against operator-controlled staging. Confirm full upgrade and restore.
3. Register and explicitly enable the real Pilot on two test publications; run `vibress-lms`'s `npm run host:acceptance` in read-only mode, then with fresh **test** Members and deliberate write opt-in. Check actual HTTP session/Origin guards, Arabic/RTL rendering, data retention and revocation.
4. Scan final API/Worker images and the reviewed Pilot artifact, test a two-replica rolling deployment and verify signed restore before production approval.

Neither this test nor a green CI run justifies automatically enabling a trusted Node module. The core runtime executes operator-approved JS in process and **does not sandbox malicious code**.
