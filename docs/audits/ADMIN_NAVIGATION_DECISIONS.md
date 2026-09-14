# Vibress Admin Navigation & Information Architecture Decisions (Phase 5)

## 1. Executive Summary

This document specifies the canonical Information Architecture (IA), primary navigation structures, and secondary workflow routes for the Vibress Admin application (`apps/admin`).

Following the forensic audit in Phases 0–3 and the remediation in Phase 4, misleading and orphaned navigation entries (notably the standalone "Network" trigger) have been permanently decommissioned. Every user-facing route now maps directly to a proven, backed runtime capability with enforced capability-based authorization and clear operational boundaries.

---

## 2. Core Architectural Boundaries

### 2.1 The Admin vs Studio Separation of Concerns
| Boundary | Surface Area | Primary Responsibilities | Data Layer & Invariants |
| :--- | :--- | :--- | :--- |
| **Admin Operations (`apps/admin`)** | Global sidebar, table listings, batch actions, settings hub, queues | Operational oversight, queue triage, moderation, member management, theme activation, publication configuration | REST API (`/api/admin/v1/*`), Postgres queries, capability RBAC |
| **Studio Creation (`packages/studio-*`, `PostEditor.tsx`)** | Rich block editor, real-time collaboration canvas, sidebar inspector | Focused authoring, content drafting, revision restoration, block manipulation, editorial comments | CRDT sync (`/posts/:id/collaboration/crdt`), autosave REST, revision trees |

---

## 3. Comprehensive Feature Navigation & Workflow Matrix

### 3.1 Posts
- **Canonical Route:** `/admin/posts`
- **Sub-Views:**
  - All Posts: `/admin/posts`
  - Drafts: `/admin/posts/drafts`
  - Scheduled: `/admin/posts/scheduled`
  - Published: `/admin/posts/published`
- **Editor Route:** `/admin/posts/:postId` (New: `/admin/posts/new`)
- **Navigation Placement:** Primary Sidebar (`NavContent.tsx`) with nested tree expansion and direct `+` quick-create button.
- **Permission Required:** `posts.read` for listings; `posts.create` / `posts.edit` for authoring; `posts.publish` for scheduling/publishing.

### 3.2 Pages
- **Canonical Route:** `/admin/pages`
- **Editor Route:** `/admin/pages/:pageId` (New: `/admin/pages/new`)
- **Navigation Placement:** Primary Sidebar (`NavContent.tsx`).
- **Permission Required:** `pages.read` for listings; `pages.manage` for page authoring and deletion.

### 3.3 Translations & Localization
- **Canonical Route:** `/admin/translations`
- **Sub-Views:**
  - Translation Matrix: `/admin/translations`
  - Review Queue: `/admin/translations/queue`
  - Translation Editor: `/admin/translations/:translationId`
  - Translate Action: `/admin/content/:contentType/:contentId/translate/:targetLocale`
- **Secondary Route:** `Settings → Site → Localization` (`/admin/settings/localization`) for locale configurations (default locale, enabled target languages, machine translation providers).
- **Navigation Placement:** Primary Sidebar (`NavContent.tsx`) for translation matrix & review queue; Settings Hub for site-level language settings.
- **Permission Required:** `translations.read` for matrix; `translations.review` for review queue; `translations.create` / `translations.edit` for translation authoring; `translations.manage` for language settings.

### 3.4 Media Library
- **Canonical Route:** `/admin/media`
- **Modal/Embedded Surface:** Studio Media Insert Picker (`packages/studio-react`).
- **Navigation Placement:** Primary Sidebar (`NavContent.tsx`).
- **Permission Required:** `media.read` for browsing; `media.upload` for uploads; `media.delete` for deletion.

### 3.5 Collections & Content Models
- **Canonical Route:** `/admin/models`
- **Sub-Views:**
  - Content Model List: `/admin/models`
  - Model Schema Builder: `/admin/models/:modelId` (New: `/admin/models/new`)
  - Collection Entry List: `/admin/collections/:modelSlug`
  - Entry Editor: `/admin/collections/:modelSlug/:entryId`
- **Navigation Placement:** Primary Sidebar (`NavContent.tsx`).
- **Permission Required:** `models.read` for viewing models/entries; `models.manage` for schema design; `content.manage` for entry creation.

### 3.6 Comments & Moderation
- **Canonical Route:** `/admin/comments` (Legacy alias `/admin/community` redirects to this route)
- **Moderation Surfaces:**
  - Comments Queue (tab 1): View all comments across posts, filter by status, hide/restore/delete comments.
  - Reports Queue (tab 2): View reader flags/reports with reason codes, mark resolved.
- **Secondary Route:** `Settings → Growth → Comments & Discussion` for publication-level comment access policies (`all`, `paid_only`, `disabled`, and pre-moderation toggles).
- **Navigation Placement:** Primary Sidebar (`NavContent.tsx`) under content operations.
- **Permission Required:** `comments.manage` for `/admin/comments` moderation UI; `comments.moderate` for API mutations (`/hide`, `/restore`, `/delete`, `/reports/:id/resolve`).

### 3.7 Collaboration & Editorial Workflows
- **Canonical Route:** Embedded within Studio (`/admin/posts/:postId`).
- **Surfaces:**
  - Editorial comments panel & inline comment threads.
  - Live collaborator presence badge and avatar cluster.
  - Revision history timeline with diff preview and rollback capability.
- **Navigation Placement:** Contextual action bar inside `PostEditor.tsx`.
- **Permission Required:** `posts.read` + `posts.edit` (author or collaborator status).

### 3.8 Publishing & Scheduling
- **Canonical Route:** Embedded within Studio publish dialog (`PostEditor.tsx`) and Post listings.
- **Surfaces:**
  - Publish modal: immediate publish, schedule for future date/time, revert to draft.
  - Newsletter broadcast toggle on publish.
- **Navigation Placement:** Top-right action button in `PostEditor.tsx`.
- **Permission Required:** `posts.publish`.

### 3.9 Themes & Site Customization
- **Canonical Route:** `/admin/settings/themes` (within `SettingsHub → Site → Themes`)
- **Surfaces:**
  - Installed theme browser (Vibress Casper, Headline, Edition, Source).
  - Theme customizer & live preview iframe (`/admin/settings/themes/customize/:themeId`).
  - Theme uploader (zip verification).
- **Navigation Placement:** Settings Hub (`Settings → Site → Themes`).
- **Permission Required:** `themes.manage`.

### 3.10 Members & Subscriptions
- **Canonical Route:** `/admin/members`
- **Sub-Views:**
  - Member List & Search: `/admin/members`
  - Member Profile & Activity: `/admin/members/:memberId`
  - Member Import/Export: Modal within `/admin/members`
- **Secondary Route:** `Settings → Members` (`/admin/settings/members`) for registration policies, email verification, and Stripe subscription tier mappings.
- **Navigation Placement:** Primary Sidebar (`NavContent.tsx`).
- **Permission Required:** `members.read` for listings; `members.manage` for edits/bans; `settings.members.manage` for member system settings.

### 3.11 Centralized Settings Hub
- **Canonical Route:** `/admin/settings`
- **Pillars & Subsections:**
  - **General:** Title, description, timezone, social accounts, publication branding (`/admin/settings/general`).
  - **Site:** Design tokens, navigation menus, themes, code injection (`/admin/settings/site`).
  - **Members:** Access policies, tiers, Stripe billing keys, customer portal (`/admin/settings/members`, `/admin/settings/billing`).
  - **Growth:** Email newsletters, recommendations & blogroll, comments policies (`/admin/settings/growth`, `/admin/settings/newsletters`).
  - **Advanced:** Integrations, webhooks, staff users & RBAC roles, audit logs, system maintenance (`/admin/settings/advanced`, `/admin/settings/users`, `/admin/settings/roles`).
- **Navigation Placement:** Primary Sidebar bottom section (`NavSettings.tsx`).
- **Permission Required:** `settings.manage` (or granular pillar permissions: `settings.general.manage`, `settings.site.manage`, `settings.billing.manage`, `settings.growth.manage`).

### 3.12 Recommendations & Blogroll
- **Canonical Route:** `/admin/settings/growth` (Specifically the "Recommendations & Blogroll" card in Settings Hub)
- **API Surface:** `/api/admin/v1/recommendations`, `/api/content/v1/recommendations`
- **Clarification:** The misleading top-level "Network" nav button was removed. Vibress does not offer a standalone decentralized social network or ActivityPub graph in v1.x; it provides a high-converting **Publication Recommendations & Blogroll** engine.
- **Navigation Placement:** `Settings → Growth → Recommendations & Blogroll`.
- **Permission Required:** `recommendations.read` for viewing; `recommendations.manage` for creating/deleting recommendation entries.

### 3.13 Analytics Dashboard
- **Canonical Route:** `/admin` (or `/admin/analytics`)
- **Surfaces:**
  - KPI overview: 30-day pageviews, unique visitors, member signups, conversion rates.
  - Top posts and referral sources table.
  - Real-time visitor ticker.
- **Navigation Placement:** Top of Primary Sidebar (`NavMain.tsx`).
- **Permission Required:** `analytics.read`.

---

## 4. Verification & Consistency Checklist
- [x] Every sidebar item has a corresponding route definition in `adminRoutes`.
- [x] No phantom buttons or orphan routes exist in the primary UI shell.
- [x] Secondary settings workflows are accessible via deep links within `SettingsHub`.
- [x] All state-changing routes enforce capability-based permission checks before rendering.
- [x] Command Palette (`CommandPalette.tsx`) mirrors the canonical navigation paths.
- [x] Mobile header (`MobileHeader.tsx`) titles align with current active route patterns.
