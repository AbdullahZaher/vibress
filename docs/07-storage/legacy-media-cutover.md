# Legacy local media cutover — preserve availability during migration

**Applies to:** Vibress CMS media stream at `apps/api/src/routes/media-stream.ts` and `scripts/sync-media-storage.ts`. This is an operational checklist, **not** an assertion that a specific deployment has been migrated.

## Why the migration marker is not a runtime switch

The sync tool emits `.media-storage-migrated.json` after a zero-error, zero-conflict run with at least one source file. It records the inventory **at the moment of verification**. It does **not** guarantee that no legacy writer can subsequently create a new file, that no references were missed, or that database publication ownership has been revalidated.

Therefore, a marker alone must **not** suppress the authenticated legacy-root fallback. A late-arriving asset could otherwise return 404 despite existing in the old root. The media route checks the canonical root first, then — unless an operator explicitly disabled it — checks the legacy root using the existing realpath containment, publication context and `mediaService.canStreamLocalMedia` authorization.

**Only `VIBRESS_STORAGE_LEGACY_FALLBACK=0` disables fallback.** Deployments that have not independently verified cutover must leave this variable unset.

## Safe operator cutover sequence

1. **Inventory and backup** both storage roots and their database media records, including publication IDs. Confirm canonical `STORAGE_LOCAL_ROOT` and whether other API/worker instances still write to legacy `apps/api/content/media`.
2. **Dry-run** the sync using `pnpm exec tsx scripts/sync-media-storage.ts --dry-run`, reviewing conflicts and missing paths. Do not overwrite conflicting destination assets or delete legacy assets.
3. **Live sync** using `pnpm exec tsx scripts/sync-media-storage.ts`; inspect the summary, errors and conflicts. Copy errors and conflicts must block cutover.
4. **Quiesce legacy writers** at all nodes. Configure all new uploads to use canonical storage and confirm that no instance, scheduled task or worker continues to write to legacy root. Record the inventory snapshot and cutover window.
5. **Verify** using `pnpm exec tsx scripts/sync-media-storage.ts --verify`, ensuring all legacy files have matching SHA-256 contents in canonical storage. **Note:** this mode does not copy files, but the current tool can create or remove its marker file; it is *not entirely filesystem read-only*.
6. **Validate HTTP**: test canonical and previously legacy URLs with the correct publication host and authentication, including private media, ranges, SVG download policy and 404 for cross-publication assets. Verify a second inventory after the quiesce window and inspect fallback warning telemetry.
7. Only after independent checks and an approved rollback plan, set `VIBRESS_STORAGE_LEGACY_FALLBACK=0` in the deployment's managed environment and roll services safely. Confirm no unexpected 404 increase. Preserve legacy data in a protected archive until the retention/migration policy explicitly permits removal.

## Rollback

If media disappears after cutover, restore the previous environment by removing `VIBRESS_STORAGE_LEGACY_FALLBACK=0` (or using the previous fallback-allowed configuration), restart/reload according to deployment procedure, and retest the affected authorized media URLs. Do not erase or rewrite data as a shortcut. Re-run the inventory and checksum verification to diagnose late-arriving files.

The presence or absence of the JSON marker alone is not the on/off switch, and is never sufficient evidence for production sign-off. The historical claim of **448 migrated assets** requires a retained deployment-specific verification log, asset inventory, time, root identifiers and reviewer acknowledgment; CI unit tests on synthetic fixtures do not establish it.

## Verification

- Regression test: `apps/api/src/__tests__/media-stream-publication.test.ts` (requires the existing integration-test database/services) covers publication authorization, late-arriving legacy files with an old marker, and the explicit disable flag.
- Sync tool tests: `scripts/__tests__/sync-media-storage.test.ts` cover empty source, partial migration, hash conflicts, marker creation and stale marker removal.
- Run the repository's normal unit/integration, security and E2E workflows on the final PR SHA and review exact job results before merge.

No application-specific assets, keys, production storage changes or release tags are modified by this documentation.
