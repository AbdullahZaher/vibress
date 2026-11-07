# Vibress CMS — Studio 9+ Host Baseline Findings Register

**Status:** ACTIVE VERIFIED BASELINE  
**Date:** 2026-11-06  
**Host SHA:** `08a727486eaa20d922b3decfee5cf8cff5e5d54b`  
**Studio SHA:** `36fac36d981ee8611b71e0ffecd978ad4773b499`

---

## 1. Verified Baseline Status

- `nx run-many --target=typecheck --all`: PASS (71 projects, 0 errors)
- `node scripts/count-explicit-any.mjs --max 220`: PASS (194 explicit-any, max 220)
- GitHub CI Run `42277615501` (Push on `main`):
  - Job `build`: PASS (15m58s)
  - Job `container-scan`: PASS (3m15s)
  - Job `e2e`: 197 passed, 7 failed (test selector / timing defects detailed below)

---

## 2. Active Findings Register

1. **FINDING-HOST-E2E-01**: `tests/e2e/content-flow.test.ts:61` — Expected `button:has-text("Publish Now")`, but `PostEditor.tsx` renders `tr("Publish")`. Furthermore, `Unpublish` is currently buried in sidebar settings when closed. Expose `Unpublish` on the editor header when published, and update selector in test.
2. **FINDING-HOST-E2E-02**: `tests/e2e/media-delete-protection.test.ts:152` & `tests/e2e/media-flow.test.ts:38` — Tests queried `li:has-text("Gallery")` and `li:has-text("Image")`. Studio renders accessible `[role="option"]` cards.
3. **FINDING-HOST-E2E-03**: `tests/e2e/setup-wizard.test.ts:107` — Test asserts `toContainText("Analytics")`, but modern dashboard displays "Dashboard" / "Overview".
4. **FINDING-HOST-E2E-04**: `tests/e2e/studio-public-render.test.ts:191` — Test clicked `button:has-text("Create Post")`, but `PostsList.tsx` header button renders `{tr("New Post")}`.
5. **FINDING-HOST-E2E-05**: `tests/e2e/admin-ui-design-acceptance.test.ts:104` — Expects count 2 on empty state, overview tab has 1 main timeseries chart.
6. **FINDING-HOST-E2E-06**: `tests/e2e/content-modeler-flow.test.ts:15-16` — Navigation timing and bilingual selector `/Advanced|المتقدمة/i`.
7. **FINDING-YJS-RESTORE-01 (P0)**: `apps/admin/src/components/PostEditor.tsx:183-187` & `apps/api/src/routes/posts.ts` — Collaborative revision restoration is disabled (`restoreDisabledReason`) because restoring in DB does not reset CRDT state or fence stale peer updates.
8. **FINDING-OFFLINE-RECOVERY-01 (P0)**: Host lacks scoped IndexedDB persistence for offline/crash draft recovery.
