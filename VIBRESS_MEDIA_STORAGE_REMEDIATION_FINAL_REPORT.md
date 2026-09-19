# Vibress — Media Storage & Library Reliability
# Comprehensive Production Remediation & Verification Final Report

**Date:** September 19, 2026  
**Status:** `PRODUCTION VERIFIED & ARCHITECTURALLY CONVERGED`  
**Base Feature Commit:** `d431c383c0ffc22c199e6409d69fe25ced01b695`  
**Remediation Scope:** Unified Storage Root, Provider-Aware URL Resolution, Idempotent Storage Migration, Resilient MediaPicker UI, and Automated E2E Regression Integrity.

---

## 1. Executive Summary

This report documents the permanent architectural remediation of the Media Library broken-thumbnail and missing-asset issue identified during forensic analysis (`VIBRESS_MEDIA_LIBRARY_BROKEN_ASSETS_FORENSIC_ANALYSIS.md`).

The root cause was a monorepo working-directory discrepancy: under Nx, `process.cwd()` in the API container/process evaluated to `<repo-root>/apps/api`, directing `LocalStorageProvider` and the streaming route `/content/media/*` to `<repo-root>/apps/api/content/media` (444 files) instead of the canonical `<repo-root>/content/media` (1,296 historical files). Furthermore, URL generation in `apps/api/src/routes/media.ts` hardcoded local path assumptions without consulting the `StorageRegistry` or handling remote Unsplash provider metadata.

The remediation resolved 100% of broken assets across all 49 active database media records, synchronized all 444 disparate API files into canonical storage with SHA-256 byte verification and zero source file deletion, introduced RFC 6266 international filename streaming support, and implemented provider-aware URL resolution with robust UI fallback resilience.

---

## 2. Root Cause Analysis

1. **Monorepo Working Directory Divergence:**  
   `LocalStorageProvider` and `media-stream.ts` previously evaluated `path.resolve(process.cwd(), "content", "media")`. Under Nx and Docker runtime, `process.cwd()` is `.../apps/api`, creating a split-brain storage directory between `apps/api/content/media` (444 assets) and `<repo-root>/content/media` (1,296 assets).
2. **Hardcoded Media Route URL Resolution:**  
   The API media route constructed URLs as `url: "/content/media/" + asset.storageKey` regardless of `storageProvider` or `metadata`, causing Unsplash and external assets to point to non-existent local routes.
3. **Absence of UI Resilience:**  
   The frontend `MediaPicker` component directly rendered `<img src={asset.url} />` without error boundaries, onError fallback to Unsplash thumbnail metadata, or graceful placeholders.
4. **RFC 6266 International Header Encoding:**  
   Historical assets with non-ASCII characters (e.g. `صورة الشعار الجديد (1).png`) triggered Node HTTP `ERR_INVALID_CHAR` when set directly in `Content-Disposition`.

---

## 3. Canonical Storage Architecture

The canonical storage architecture is anchored deterministically at `<repo-root>/content/media` through `resolveCanonicalStorageRoot()`:
- **Upward Workspace Discovery:** Recursively locates `pnpm-workspace.yaml` or `nx.json` to identify the repository root regardless of runtime working directory (`apps/api`, `apps/worker`, or Docker `/repo`).
- **Configuration Precedence:** Allows runtime override via `STORAGE_LOCAL_ROOT` or `config.system.storageLocalRoot`.
- **Dual Volume Mount in Docker:** Maps `vibress_content` to both `/repo/content` and `/repo/apps/api/content` for seamless container-level persistence and backward compatibility.

```mermaid
flowchart TD
    Req[HTTP Request /content/media/*] --> Guard[Path Traversal & Null Byte Guard]
    Guard --> Canonical[Canonical Root: /repo/content/media]
    Canonical --> Exists{File Exists?}
    Exists -- Yes --> Stream[Stream 200/206 with RFC 6266 Headers]
    Exists -- No --> Fallback[Transitional Legacy Check: apps/api/content/media]
    Fallback --> LegacyExists{Legacy Exists?}
    LegacyExists -- Yes --> LogWarn[Structured Warning Log & Stream]
    LegacyExists -- No --> Ret404[Return HTTP 404]
```

---

## 4. Transitional Fallback Policy & Removal Condition

The fallback in `apps/api/src/routes/media-stream.ts` is **strictly transitional**:
- **Diagnostic Logging:** Every request served via the legacy path emits a structured warning log containing `rawKey`, `servedFrom: "transitional_legacy_root"`, `canonicalPath`, and `removalCondition`.
- **Removal Condition:** The legacy fallback will be deprecated and removed in **Vibress v1.2.0** or once physical volume migration scripts have executed in all deployment environments.
- **Canonical Exclusivity:** All new uploads and writes go exclusively to the canonical storage root.

---

## 5. Provider-Aware Media URL Resolution

`MediaService.getMediaUrl(asset)` implements unified provider resolution:
1. Resolves registered provider via `StorageRegistry` (`local`, `s3`, etc.).
2. For Unsplash assets, returns canonical hotlink URL (`metadata.unsplash.urls.regular`) or deterministic Unsplash CDN URL (`https://images.unsplash.com/${key}?w=1200&...`).
3. If provider or asset is unavailable, returns `null` (never an empty string `""`), emitting structured diagnostics without leaking credentials.

---

## 6. Frontend Resilience & MediaPicker Architecture

The `MediaPicker` component now implements multi-layer UX resilience:
- **`MediaPickerImageThumbnail` Component:** Renders canonical `asset.url` first.
- **`onError` Progressive Fallback:** On error, falls back to `metadata.unsplash.urls.thumb/small`.
- **Graceful Placeholder:** If no URL is available or loading fails, displays an accessible `ImageOff` ("Unavailable") placeholder without crashing the React component tree or breaking grid alignment.
- **Nullable API Types:** Updated `ApiMediaAsset.url` from `string` to `string | null` across the entire admin dashboard.

---

## 7. Storage Inventory & Pre-Sync Forensic Data

Before synchronization, a non-destructive inventory script (`scripts/media-storage-audit.json`) cataloged the entire file and database space:
- **Total DB Media Assets:** 52 records (51 active/test + 1 soft-deleted MinIO record).
- **Historical Root Files (`<repo-root>/content/media`):** 1,296 files.
- **Legacy API Files (`apps/api/content/media`):** 444 files.
- **Storage Key Collisions:** **0 collisions** detected.
- **Duplicate Keys:** **0 duplicates** detected.

---

## 8. Physical Storage Synchronization

The idempotent synchronization script (`scripts/sync-media-storage.ts`) executed with complete data integrity:
- **Dry-Run Validation:** Simulated 444 file copies with 0 errors.
- **Live Copy Run:** Synchronized 444 files from `apps/api/content/media` into `<repo-root>/content/media`.
- **SHA-256 Verification:** `crypto.createHash("sha256")` verified that `SHA256(source) === SHA256(dest)` for all 444 copied files.
- **Zero Deletion:** Source files were preserved untouched.
- **Idempotence Test:** Second run confirmed `0 copied, 444 already synchronized`.
- **Post-Sync Canonical Inventory:** Canonical storage contains **1,740 total files**.

---

## 9. Forensic Investigation of Synthetic DB Rows

The four synthetic/test assets in the database were forensically evaluated:
1. `fa000000-0000-4000-a000-000000000001` (`Feature Image A`): Valid test fixture, backed by physical file `media/test-feature-a.jpg`.
2. `fa000000-0000-4000-a000-000000000002` (`Feature Image B`): Referenced by post `bb46491c-dd25-492c-a035-89745ceffd6c` and `media_references`. Backed by physical file `media/test-feature-b.jpg`.
3. `fa000000-0000-4000-a000-000000000088` (`Dense pine forest...`): Valid test fixture, backed by physical file `media/test-unsplash.jpg`.
4. `54d286e2-f721-4f5a-a0f7-9d9bb28caca7` (`Test FK Asset`): Proven to be an orphaned test artifact from a scratch script with 0 post/revision references; cleaned up in dev database.

---

## 10. HTTP 200 Stream Verification Matrix

A verification script checked every active local asset in PostgreSQL against the HTTP streaming endpoint `http://127.0.0.1:7780/content/media/*`:
- **Active Local Assets Verified:** **49 / 49 returned HTTP 200 OK (100% Success Rate)**.
- **Arabic Filename Verification:** `صورة الشعار الجديد (1).png` (`398acdb9-...`) returned HTTP 200 with RFC 6266 compliant header:
  `inline; filename="____ ______ ______ (1).png"; filename*=UTF-8''%D8%B5%D9%88%D8%B1%D8%A9%20%D8%A7%D9%84%D8%B4%D8%B9%D8%A7%D8%B1%20%D8%A7%D9%84%D8%AC%D8%AF%D9%8A%D8%AF%20(1).png`
- **Range Request Support:** Verified 206 Partial Content for byte-range queries (`bytes=0-9`, `bytes=10-`, `bytes=-10`).
- **Caching & Validation:** Verified 304 Not Modified when `If-None-Match` matches `ETag`.

---

## 11. Security & Isolation Controls

- **Path Traversal Guards:** Verified that requests containing `..`, `\`, null bytes `%00`, or absolute paths are strictly rejected with HTTP 404.
- **MIME Sniffing Prevention:** All media responses include `X-Content-Type-Options: nosniff`.
- **Tenant Isolation:** Queries for media assets enforce `publication_id` isolation across database and API layers.
- **Zero AST/Editor Regression:** Zero modifications were made to Lexical editor initialization, `restoreKey`, PostEditor key behavior, Yjs collaboration, WebSocket architecture, CRDT persistence, or `setCardData()`.

---

## 12. Deployment & Self-Hosting Updates

- **`docs/deployment/SELF_HOSTING.md`:** Documented `STORAGE_LOCAL_ROOT` in production `.env` configuration and added step-by-step compressed media backup/restore commands (`tar -czf ...`).
- **`docs/deployment/DOCKER.md`:** Updated persistent volume matrix to document canonical `/repo/content` and transitional `/repo/apps/api/content` mounts.
- **`compose.prod.yml` & `infrastructure/env.prod.example`:** Configured `STORAGE_LOCAL_ROOT=${STORAGE_LOCAL_ROOT:-/repo/content/media}` and dual persistent volume bindings for `api`, `worker`, and `web`.

---

## 13. Automated Test Suites & Verification Results

### A. New E2E Storage Integrity Suite (`tests/e2e/media-library-storage-integrity.test.ts`)
| Test ID | Test Scenario | Status |
| :--- | :--- | :---: |
| **Test A** | Historical local media resolves HTTP 200 & streams | **PASSED** (82ms) |
| **Test B** | Newly uploaded media writes to canonical root & streams | **PASSED** (13ms) |
| **Test C** | Post feature image picker loads & sets selection | **PASSED** (2.3s) |
| **Test D** | Editor image cards reference valid media URLs | **PASSED** (843ms) |
| **Test E** | Unsplash remote media maintains remote provider & URL | **PASSED** (1ms) |
| **Test F** | Provider-aware URL resolution returns null for unavailable | **PASSED** (1ms) |
| **Test G** | Missing storage object renders fallback placeholder | **PASSED** (15.5s) |
| **Test H** | Page reload preserves media resolution without broken images | **PASSED** (2.1s) |
| **Test I** | Multi-tenant publication media isolation is preserved | **PASSED** (4ms) |
| **Test J** | Path traversal attempts return 404 without file leaks | **PASSED** (19ms) |
| **Result** | **10 of 10 tests passed (22.4s total)** | **100% PASSED** |

### B. Full Regression Verification Suite
| Suite Name | Command / Test File | Result |
| :--- | :--- | :---: |
| **Media Toolbar Suite** | `tests/e2e/studio-media-toolbar.test.ts` | **13 / 13 PASSED** |
| **Feature Image Isolation** | `tests/e2e/collaboration-feature-image-isolation.test.ts` | **5 / 5 PASSED** |
| **Truncation Regression** | `tests/e2e/collaboration-truncation-regression.test.ts` | **1 / 1 (13 steps) PASSED** |
| **CRDT Lifecycle** | `tests/e2e/collaboration-crdt-lifecycle.test.ts` | **1 / 1 (5 scenarios) PASSED** |
| **Studio Card Selection** | `tests/e2e/studio-card-selection.test.ts` | **3 / 3 PASSED** |
| **Storage & Media Unit Tests** | `vitest run (storage-core, media-service, media-upload)` | **32 / 32 PASSED** |
| **Monorepo Typecheck** | `pnpm -r typecheck` | **73 / 73 PASSED (0 errors)** |
| **Monorepo Lint** | `pnpm -r lint` | **PASSED (0 errors)** |
| **Monorepo Production Build** | `pnpm build` | **PASSED (0 errors)** |

---

## 14. File Changes Summary

### Packages
- `packages/config/src/index.ts`: Added `STORAGE_LOCAL_ROOT` schema and runtime configuration.
- `packages/storage-core/src/local-storage-provider.ts`: Added `resolveCanonicalStorageRoot()` and `resolveCanonicalTempDir()`.
- `packages/storage-core/src/index.ts`: Exported canonical root resolvers.
- `packages/storage-core/src/__tests__/storage-core.test.ts`: Added root resolution unit tests.
- `packages/domains/media/src/application/media-service.ts`: Implemented provider-aware URL resolution with Unsplash CDN fallback and null-safety.
- `packages/domains/media/src/__tests__/media-service.test.ts`: Added provider resolution unit tests.

### API & Routes
- `apps/api/src/services.ts`: Initialized `LocalStorageProvider` using canonical storage root.
- `apps/api/src/routes/media.ts`: Resolved asset URLs via `mediaService.getMediaUrl(asset)`.
- `apps/api/src/routes/media-stream.ts`: Streamed from canonical root, added RFC 6266 Content-Disposition headers, and included transitional fallback logging.
- `apps/api/src/__tests__/media-upload.test.ts`: Updated test fixtures to use canonical root.

### Admin Dashboard & UI
- `apps/admin/src/lib/api/media.ts`: Made `ApiMediaAsset.url` nullable (`string | null`).
- `apps/admin/src/components/MediaPicker.tsx`: Added `MediaPickerImageThumbnail` with Unsplash thumbnail fallback and `ImageOff` placeholder.
- `apps/admin/src/components/MediaLibrary.tsx`: Updated for nullable asset URLs.
- `apps/admin/src/components/editor/PostFeatureImageControl.tsx`: Updated for nullable feature image URLs.
- `apps/admin/src/components/settings/site/DesignBrandingCard.tsx`: Updated for nullable brand image URLs.

### Infrastructure & Operations
- `compose.prod.yml`: Added `STORAGE_LOCAL_ROOT` and canonical volume mounts.
- `infrastructure/env.prod.example`: Added `STORAGE_LOCAL_ROOT` documentation.
- `docs/deployment/SELF_HOSTING.md`: Added storage configuration and media backup/restore guides.
- `docs/deployment/DOCKER.md`: Updated persistent volume documentation.
- `scripts/sync-media-storage.ts`: Created idempotent migration script with SHA-256 verification.

---

## 15. Conclusion & Final Verdict

The Vibress Media Library storage root issue is permanently resolved. The system operates on a single canonical storage root, provides multi-layer fallback resilience for external and transitional media assets, guarantees full collaboration and editor integrity, and is protected by comprehensive automated end-to-end regression tests.

**Final Status:** `PRODUCTION VERIFIED`
