# M00-E04 / M00-E10 — Compatibility and Capability Baseline Index

## M00-E04 compatibility baseline

The existing pinned two-publication CMS/Studio fixture pack is reused, not recreated. `CMS-STUDIO-COMPATIBILITY-MANIFEST.json` binds twelve required dimensions — two publications, `pub_default` behavior, users/memberships/roles, subscriptions/payments, media, Studio documents, Yjs/document version, delayed jobs, Outbox, URLs/localized content, migration/restore invariants and the kernel identity boundary — to existing source and tests. The fixture pack digest is pinned by `tests/fixtures/cms-studio/fixture-pack.ts`; `tests/unit/cms-studio-fixture-pack.test.ts` fails closed on drift.

The universal kernel does not reinterpret Publication as Application or Tenant: `packages/tenancy/src/scope.ts` rejects `LEGACY_PUBLICATION_FALLBACK`, and the boundary contract test verifies the kernel exposes no publication-domain import.

## M00-E10 v1 capability matrix

`M00-CAPABILITY-MATRIX.json` classifies 18 capabilities as existing Host/CMS, universal platform, restricted experimental, public contract, planned, or unsupported/prohibited. No capability is marked generally available at M00. Explicitly prohibited capabilities include M04 Batch 03 runtime, unsupported production application hosting, native mobile and arbitrary compute.

Source-backed evidence is attached to every row; restricted contract-only work (generated CRUD/Admin, packed SDK proof) is not presented as generally available. Production remains NO-GO.
