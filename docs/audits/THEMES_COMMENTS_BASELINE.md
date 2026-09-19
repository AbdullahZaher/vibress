# VIBRESS — THEMES COMMENTS INTEGRATION BASELINE
# COMPREHENSIVE THEME ECOSYSTEM INVENTORY & AUDIT

**Document Reference**: `docs/audits/THEMES_COMMENTS_BASELINE.md`  
**Author**: Senior Principal Software Architect & Theme Ecosystem Lead  
**Status**: APPROVED BASELINE  
**Date**: September 18, 2026  

---

## 1. Executive Summary & Inventory

This baseline audit inventories every theme in the Vibress repository, analyzing post detail templates, card metadata presentation, comment mount points, existing comments wiring, RTL/localization readiness, responsive styling, and test coverage prior to the production remediation and Theme Designer Package update.

### Theme Ecosystem Inventory Matrix

| Theme | Source | Runtime | Post Detail | Cards | Comment Count | Comments Mount | RTL | Tests | ZIP |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Default** | `apps/web/src/themes/default` | React (Next.js SC) | `components/Post.tsx` | `components/Home.tsx`<br>`TagArchive.tsx`<br>`AuthorArchive.tsx` | Missing in header byline & cards | Mounted (`<CommentSection />`) | Yes (`i18n` dir) | Web test suite | N/A (Built-in) |
| **Minimal** | `apps/web/src/themes/minimal` | React (Next.js SC) | `components/Post.tsx` | `components/Home.tsx`<br>`TagArchive.tsx`<br>`AuthorArchive.tsx` | Missing in meta & cards | Mounted (`<CommentSection />`) | Yes (`i18n` dir) | Web test suite | N/A (Built-in) |
| **Molten** | `apps/web/src/themes/molten` | React (Next.js SC) | `components/Post.tsx` | `components/PostCard.tsx`<br>`Home.tsx`<br>`TagArchive.tsx` | Missing in meta & `PostCard` | Mounted (`<CommentSection />`) | Yes (`i18n` dir) | Web test suite | N/A (Built-in) |
| **Starter** | `content/theme-starter/`<br>`VIBRESS_THEME_DESIGNER_PACKAGE/starter-theme/`<br>`content/themes/vibress-starter-theme/1.0.0/`<br>`apps/api/content/themes/vibress-starter-theme/1.0.0/` | Liquid (`@vibress/theme-core`) | `templates/post.liquid` | `templates/home.liquid`<br>`templates/tag.liquid`<br>`templates/author.liquid` | Missing in `.article-submeta` & card chips | Missing `{% comments %}` tag | Yes (`locales/ar.json`, `dir`) | Contract tests in `theme-core` | `content/vibress-theme-starter.zip`<br>`VIBRESS_THEME_DESIGNER_PACKAGE/vibress-theme-starter.zip` |
| **Morrowe Magazine** | `content/morrowe-magazine/`<br>`apps/api/content/themes/morrowe-magazine/1.1.0/`<br>`apps/api/content/themes/morrowe-magazine/1.0.0/` | Liquid (`@vibress/theme-core`) | `templates/post.liquid` | `templates/home.liquid`<br>`templates/tag.liquid`<br>`templates/author.liquid` | Missing in `mr-article-stats` & feed rows | Missing `{% comments %}` tag | Yes (`locales/ar.json`, `dir`) | Requires contract test | `content/MORROWE_VIBRESS_MAGAZINE_v1.1.0.zip` |
| **Theme Designer Package** | `VIBRESS_THEME_DESIGNER_PACKAGE/` | Spec & Starter Kit | Developer Guides | Starter Templates | Specification Reference | Full Contract Guide | Yes (`README-AR.md`) | Validator script | `VIBRESS_THEME_DESIGNER_PACKAGE.zip` |

---

## 2. Detailed Baseline Observations & Gaps

1. **Theme Core View Models**:
   - `PostViewModel` had `commentCount?: number`, but did not expose `comment_count?: number` as a camelCase/snake_case symmetrical alias.
   - `mapPostToViewModel` was not consistently populating comment counts from post DTO inputs.

2. **Public Content API Data Flow**:
   - Post listing routes (`/posts`, `/posts/:slug`, `/tags/:slug/posts`, `/authors/:slug/posts`) needed single batched comment-count retrieval via `commentsService.getCommentCounts(pubId, postIds)` to eliminate any possibility of N+1 database queries.

3. **Built-in React Themes**:
   - Default, Minimal, and Molten mounted `CommentSection.tsx` on post pages, but lacked comment count presentation in post header metadata bylines and post feed/archive cards.

4. **Liquid Starter Theme**:
   - `templates/post.liquid` lacked `{% comments %}` and comment count in `.article-submeta`.
   - `home.liquid`, `tag.liquid`, `author.liquid` lacked `post.comment_count` in card metadata.
   - `assets/css/theme.css` lacked theme-native styling for comment cards, form inputs, replies, and RTL mirroring.

5. **Morrowe Magazine Theme**:
   - `templates/post.liquid` lacked `{% comments %}` and `mr-article-stats` comment count.
   - `home.liquid` lacked comment counts in lead story, feature cards, and latest feed rows.
   - `assets/css/theme.css` needed magazine-grade typography styling and `--mr-accent` token integration for comments.
   - Packaging script `pack-morrowe-theme.js` was missing.

6. **Theme Designer Package**:
   - Missing dedicated Comments guide `07B-COMMENTS-AND-COMMUNITY-GUIDE.md`.
   - Outdated view model reference tables missing `post.comment_count` and `SiteCommentsConfig`.
   - Arabic documentation (`README-AR.md`) needed updating.
   - ZIP archives needed rebuild and validation.
