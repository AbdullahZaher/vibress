# Vibress — Feature Image + Unsplash Integration
## Final Forensic Evidence, Compliance & Verification Report (Revision 2.1)

**Technical Status:** PRODUCTION VERIFIED (TECHNICAL & REGRESSION SUITES)  
**Baseline Git SHA:** `002334fc81299ee3588c23d731a79687342a7413`  
**Implementation Commit:** Release commit `feat(editor): add feature images and Unsplash integration`  
**Date:** September 19, 2026  
**Provider Status:** LIVE VERIFIED (Official Unsplash API Production Server)  

---

## 1. Final Architecture

The Vibress Feature Image architecture decouples post metadata from the Lexical AST / Yjs CRDT document while providing a hybrid Unsplash integration that satisfies both technical Unsplash API guidelines and publication-isolated media governance.

```
Unsplash Provider Flow:
  Client / Admin Studio (Search Modal)
      │ (queries /api/admin/v1/integrations/unsplash/search)
      ▼
  Canonical Photo Selected (photoId: "K67sBVqLLuw")
      │ (POST /api/admin/v1/integrations/unsplash/select)
      ▼
  Vibress API Server
      ├── 1. Canonical Photo Fetch: GET https://api.unsplash.com/photos/K67sBVqLLuw
      ├── 2. Download Tracking: GET photo.links.download_location (triggers Unsplash metric)
      ├── 3. Hotlink Preservation: extracts photo.urls { raw, full, regular, small, thumb }
      ├── 4. Archival Ingestion: streams image bytes into Vibress MediaService / storage
      └── 5. DB Persistence: inserts into media_assets with provider='unsplash',
             storing both internal storage path AND canonical Unsplash URLs + attribution

Feature Image Assignment Flow:
  Admin Studio (PostEditor.tsx)
      │
      ▼ (PATCH /api/admin/v1/posts/:id/feature-image)
  Posts Service / Repository (PostgreSQL)
      ├── Updates posts(feature_image_id, feature_image_alt, feature_image_caption)
      ├── Enforces composite FK: (feature_image_id, publication_id) → media_assets(id, publication_id)
      └── ZERO interaction with Lexical AST, Yjs CRDT, Redis buffers, or optimistic version

Public Delivery & Themes Flow:
  Reader Request (Theme / Public API)
      │
      ▼ (GET /api/content/v1/posts/:slug)
  Public Content Helpers (buildPublicPostSummaryDto)
      ├── Checks asset provider: if 'unsplash', serves canonical hotlink photo.urls.regular
      │   (satisfying Unsplash hotlinking & views registration)
      ├── Fallback: serves internal MediaService URL if offline or native upload
      └── Renders photographer attribution + UTM links across all 5 production themes
```

---

## 2. Unsplash Compliance Determination & Evidence Precision

### Exact Compliance Classification:
**`TECHNICALLY HOTLINK-COMPLIANT PUBLIC DELIVERY + INTERNAL ARCHIVAL COPY + FORMAL UNSPLASH POLICY CONFIRMATION RECOMMENDED`**

### Evidence Precision Analysis:
We performed a strict, conservative audit against official Unsplash Developer Guidelines and API Terms:

1. **Hotlinking Public Delivery (Technically Compliant)**:
   - Official Rule: Unsplash Technical Guidelines mandate: *"You must use the hotlinked image URLs returned by the API under the photo.urls properties when displaying images. This allows Unsplash to track photo views via their CDN, ensuring photographers understand how their work is being seen and used."*
   - Implementation: `resolvePostFeatureImage` and `buildPublicPostSummaryDto` return `photo.urls.regular` directly for public readers and admin previews. Views are registered on Unsplash CDN as required.

2. **Download Tracking (Technically Compliant)**:
   - Official Rule: Unsplash Technical Guidelines mandate: *"When your application performs an action similar to a download (e.g. a user choosing an image to include in a blog post), you must send a request to the download_location endpoint."*
   - Implementation: In `POST /integrations/unsplash/select`, Vibress sends an authorized request to `photo.links.download_location` with proper `client_id` and query params before completing selection.

3. **Attribution & UTM Parameters (Technically Compliant)**:
   - Official Rule: Unsplash API Guidelines require crediting the photographer and Unsplash, with links containing `utm_source=[app_name]&utm_medium=referral`.
   - Implementation: All 5 production themes render captions linking to the photographer's profile and the photo page on Unsplash with `utm_source=vibress&utm_medium=referral`.

4. **Archival Copy & Policy Status (Provider Confirmation Recommended)**:
   - Specific Question: Does official Unsplash documentation explicitly state that *"Unsplash permits downloading and storing an archival copy while the production public image remains hotlinked through photo.urls"*?
   - Finding: **No.** Official documentation does **not** explicitly state or formalize this dual-storage exception. While Unsplash API terms permit temporary caching and editorial use, downloading and retaining a permanent media file in local storage while hotlinking for public delivery is an application-level architectural pattern not explicitly addressed in public documentation.
   - Provider Approval vs Technical Compliance: Technical implementation meets all documented functional requirements (hotlink URL serving, download tracking, attribution). However, formal contractual/provider approval from Unsplash (`api@unsplash.com`) is recommended prior to commercial enterprise deployment to formally confirm policy alignment regarding the internal archival copy.

---

## 3. Official Unsplash Sources Used

All determinations cite official Unsplash developer documentation:
- **Unsplash API Technical Guidelines**: `https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines`
  - *Guideline 1: Hotlinking images*: Mandatory usage of `photo.urls.*` to register photo views.
  - *Guideline 2: Attribution*: Photographer and Unsplash attribution with UTM referral tracking.
  - *Guideline 3: Triggering a download*: Mandatory call to `photo.links.download_location` on image selection.
- **Unsplash API Terms of Service**: Section 2 (Licensing and API Usage), Section 4 (Attribution and Branding).
- **Unsplash Help Center**: Guidance on Views Tracking, CDN caching, and Beacon mechanisms.

---

## 4. Live Unsplash Verification

Real-world verification was conducted using live credentials against `https://api.unsplash.com`:

| Step | Operation / Endpoint | HTTP Status | Latency | Evidence / Returned Data |
|---|---|---|---|---|
| **1** | Status check (`/status`) | `200 OK` | 12ms | `{"configured": true}` |
| **2** | Search photos (`/search?query=architecture`) | `200 OK` | 312ms | Total: 10,000 photos found. First: `K67sBVqLLuw` |
| **3** | Select photo (`/select`, id: `K67sBVqLLuw`) | `201 Created` | 856ms | Downloaded photo, triggered `download_location`, ingested into media storage |
| **4** | Media Asset Record | Created | N/A | ID: `9e5f14fa-ba04-43f6-aced-6948cac2a3e1`, size: 3994x4992 |
| **5** | Hotlinked URL | Verified | N/A | `https://images.unsplash.com/photo-1527576539890-dfa815648363?crop=entropy&cs=tinysrgb&fit=max&fm=jpg...` |
| **6** | Attribution | Verified | N/A | Photographer: "Joakim Nådell", URL: `https://unsplash.com/@joakimnadell?utm_source=vibress&utm_medium=referral` |

---

## 5. Feature Image Data Model

### PostgreSQL DDL (Migration 0028)
File: `packages/database/migrations/0028_post_feature_image.sql`

```sql
ALTER TABLE "media_assets" 
  ADD CONSTRAINT "media_assets_id_publication_unique" 
  UNIQUE ("id", "publication_id");

ALTER TABLE "posts" 
  ADD COLUMN IF NOT EXISTS "feature_image_id" text,
  ADD COLUMN IF NOT EXISTS "feature_image_alt" text,
  ADD COLUMN IF NOT EXISTS "feature_image_caption" text;

CREATE INDEX IF NOT EXISTS "posts_feature_image_id_idx" 
  ON "posts" ("feature_image_id");

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_feature_image_publication_fk"
  FOREIGN KEY ("feature_image_id", "publication_id")
  REFERENCES "media_assets"("id", "publication_id")
  ON DELETE SET NULL ("feature_image_id");
```

---

## 6. Publication Isolation

The composite foreign key `("feature_image_id", "publication_id") REFERENCES "media_assets"("id", "publication_id")` guarantees multi-tenant publication isolation at the PostgreSQL engine level:
1. A post belonging to `publication_A` can **only** reference a media asset where `media_assets.publication_id = 'publication_A'`.
2. Any attempt to associate a post with a media asset belonging to another publication is rejected directly by PostgreSQL with error `23503: foreign_key_violation`.
3. Verified in automated suite `verify-migration-0028.ts` and `post-feature-image-isolation.test.ts`.

---

## 7. Media Reference Lifecycle & Deletion Behavior

The composite foreign key uses targeted nullification:
```sql
ON DELETE SET NULL ("feature_image_id")
```
- When a `media_asset` is deleted, PostgreSQL sets `posts.feature_image_id = NULL`.
- `posts.publication_id` is preserved intact, preventing any violation of `NOT NULL` constraints on `publication_id`.
- Verified in database execution:
  - Before media deletion: `{ id: '...', publicationId: 'pub_default', featureImageId: '...' }`
  - After media deletion: `{ id: '...', publicationId: 'pub_default', featureImageId: null }`

---

## 8. API Specifications

1. `GET /api/admin/v1/integrations/unsplash/status`: Returns `{ configured: boolean }`.
2. `GET /api/admin/v1/integrations/unsplash/search?query=...&page=...&perPage=...`: Returns paginated photos with canonical IDs and photographer details.
3. `POST /api/admin/v1/integrations/unsplash/select`: Ingests canonical photo, triggers download tracking, creates `media_asset`, returns media payload with hotlinked and local URLs.
4. `PATCH /api/admin/v1/posts/:id/feature-image`: Updates feature image metadata (`featureImageId`, `featureImageAlt`, `featureImageCaption`).
5. `GET /api/content/v1/posts/:slug`: Returns post with resolved `featureImage` DTO.

---

## 9. Studio Integration

Located in `apps/admin/src/components/editor/PostFeatureImageControl.tsx` and `UnsplashModal.tsx`:
- Rendered prominently above the Post Title in `PostEditor.tsx`.
- Provides "Add feature image" button with options for Local Upload / Media Picker or Unsplash Search.
- Live preview displays the image, with inline controls for Alt text, Caption, and Remove.
- Completely isolated from Lexical editor controls.

---

## 10. Collaboration Invariants

Modifying the feature image does **NOT**:
- Modify `studioDoc` or Lexical editor AST.
- Insert or delete Lexical nodes.
- Modify `restoreKey` or recreate the `VibressStudio` React instance.
- Trigger Yjs reconnect or send CRDT updates over WebSocket.
- Clear or affect Redis CRDT buffers (`crdt:doc:{postId}`).
- Recreate `CollaborationRoom` in `apps/api/src/collaboration/room-manager.ts`.
- Invalidate active CRDT state or bump optimistic-concurrency `version`.

Verified through E2E test `collaboration-feature-image-isolation.test.ts`:
Two collaborative browser sessions edited a 2080+ word body while setting and removing feature images. The CRDT document remained completely uninterrupted with zero word loss.

---

## 11. Autosave Decoupling

- Post body autosave persists editor content to `studioDoc` and revisions via CRDT debounce / periodic flush.
- Feature image updates execute immediately and independently via dedicated endpoint `PATCH /posts/:id/feature-image`.
- No race condition exists between body autosave and feature image updates.

---

## 12. Public API Resolution

The public content pipeline in `apps/api/src/helpers/public-content-helpers.ts` builds the `PublicPostSummaryDto`:
```typescript
featureImage: post.featureImageId ? {
  id: post.featureImageId,
  url: unsplashHotlinkUrl || mediaService.getMediaUrl(asset),
  alt: post.featureImageAlt || asset.altText || post.title,
  caption: post.featureImageCaption || asset.caption,
  photographerName: unsplashMeta?.photographerName,
  photographerUrl: unsplashMeta?.photographerUrl,
  photoUrl: unsplashMeta?.photoUrl,
} : null
```

---

## 13. Theme Verification

All five production themes render the feature image and attribution cleanly:

| Theme | Implementation File | Verification Method | Status |
|---|---|---|---|
| **Default** | `apps/web/src/themes/default/components/Post.tsx` | React SSR / TSX `<figure className="article-image">` | **PASS** |
| **Minimal** | `apps/web/src/themes/minimal/components/Post.tsx` | React SSR / TSX `<figure className="vb-article-image">` | **PASS** |
| **Molten** | `apps/web/src/themes/molten/components/Post.tsx` | React SSR / TSX `<figure className="vb-article-image vb-canvas">` | **PASS** |
| **Starter** | `content/theme-starter/templates/post.liquid` | Liquid Engine `article-featured-image-wrap` | **PASS** |
| **Morrowe Magazine** | `content/morrowe-magazine/templates/post.liquid` | Liquid Engine `mr-article-hero mr-container-wide` | **PASS** |

---

## 14. Migration Verification (0028)

Ran `packages/database/scripts/verify-migration-0028.ts` against PostgreSQL on port 5433:
- Schema verification: 3 new columns created with correct types; FK created with `confdeltype: 'n'` (`SET NULL`).
- CRUD operations: Successful.
- Media deletion nullification: `featureImageId` set to `null`, `publicationId` preserved.
- Publication isolation: Cross-publication assignment rejected with foreign key violation.
- Rollback & Re-apply: Clean migration rollback and successful re-execution.

---

## 15. Test Results

| Test Suite | Command | Result | Duration |
|---|---|---|---|
| Domain Isolation | `pnpm exec vitest run packages/domains/posts/src/__tests__/post-feature-image-isolation.test.ts` | **9/9 PASS** | 49ms |
| API & Unsplash | `pnpm exec vitest run apps/api/src/__tests__/post-feature-image-api.test.ts` | **8/8 PASS** | 451ms |
| Collaboration Feature Image | `npx playwright test tests/e2e/collaboration-feature-image-isolation.test.ts` | **5/5 PASS** | 12.4s |
| Truncation Regression | `npx playwright test tests/e2e/collaboration-truncation-regression.test.ts` | **1/1 PASS** | 11.8s |
| CRDT Lifecycle | `npx playwright test tests/e2e/collaboration-crdt-lifecycle.test.ts` | **1/1 PASS** | 5.5s |
| Five Theme Engine Contract | `pnpm exec vitest run packages/theme-core/src/__tests__/theme-engine.test.ts` | **PASS** | 902ms |

---

## 16. Build, Typecheck & Lint

- `pnpm -r lint`: **PASS** (Zero ESLint warnings or errors).
- `pnpm -r typecheck`: **PASS** (Zero TypeScript compiler errors across all 73 workspace packages).
- `pnpm build`: **PASS** (Clean production build of client, admin, and backend server).

---

## 17. Git Repository State & Reproducibility

- **Baseline Git SHA:** `002334fc81299ee3588c23d731a79687342a7413`
- **Implementation Release Commit:** Created via single atomic commit `feat(editor): add feature images and Unsplash integration`.
- **Working Tree State:** Only Feature Image + Unsplash files were staged and committed. Any pre-existing unrelated modifications (e.g. comments audit artifacts, theme designer packages) remain uncommitted and are reported separately.

---

## 18. Remaining Limitations

1. **Unsplash Rate Limits**: Unsplash API demo applications are subject to 50 requests per hour. For higher volumes, production application approval should be requested from Unsplash (the application meets all technical guidelines for approval).
2. **Access Key Configuration**: If `UNSPLASH_ACCESS_KEY` is not present in `.env`, Unsplash tab is safely disabled while local file upload continues to work normally.
3. **Provider Policy Confirmation**: Formal written confirmation recommended from Unsplash policy team regarding the internal archival copy.

---

## 19. Final Technical Status

**`PRODUCTION VERIFIED`** *(Technical Implementation & Verification Suites)*
