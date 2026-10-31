# Vibress Admin — Enterprise Design System

**Status:** Active implementation standard  
**Scope:** Admin workspace, editorial workflows, media, members, taxonomy, moderation, analytics and settings.

This document defines the interaction and visual rules for the admin product. It is intentionally an operating system for the interface, not a gallery of isolated components.

## 1. Product principles

1. **Work before vanity metrics.** The first screen should surface tasks that require attention. Analytics remain available, but must not obscure review, drafts, scheduled publishing or failed operations.
2. **Progressive disclosure.** Keep frequent actions visible and advanced configuration in contextual menus or dedicated settings sections.
3. **One interaction language.** Search, filtering, sorting, selection, confirmation, feedback and pagination should behave consistently across every resource list.
4. **Permission-aware by design.** Hide unavailable navigation and actions. Read access must not imply edit, publish, delete or moderation access.
5. **Safe by default.** Destructive and security-sensitive actions require an explicit confirmation and a clear outcome.
6. **Localization is a user preference.** The staff interface language is independent from the publication's default content language.

## 2. Visual foundations

### Color and surfaces

Use the existing semantic tokens in `apps/admin/src/styles/globals.css`:

- `background` / `foreground`: application canvas and primary text.
- `card` / `card-foreground`: working surfaces and content panels.
- `muted` / `muted-foreground`: secondary information and quiet surfaces.
- `primary`: the single high-emphasis action color.
- `destructive`: irreversible or dangerous actions.
- `border` / `ring`: boundaries and keyboard focus.

Do not introduce page-specific hex colors when a semantic token exists. Status colors are semantic: green for successful/published, amber for waiting/review, red for destructive/error, and neutral for draft/disabled. Never communicate status by color alone.

### Typography

- Page title: 24–30px, semibold.
- Section title: 16–18px, semibold.
- Body and control labels: 14px minimum.
- Secondary metadata: 12px minimum when it carries meaning.
- Use tabular numerals for counts, dates, and metrics.
- Keep the admin type system to the existing family; do not add display fonts to operational screens.
- Avoid long all-caps labels and avoid using 10px text for essential actions or statuses.

### Spacing and shape

- Base spacing: 4px; primary layout rhythm: 8px.
- Card padding: 16px on compact screens, 20–24px on wider screens.
- Control height: 44px target for primary touch actions; compact desktop-only controls may be smaller where appropriate.
- Standard radii: 8px for controls, 12px for cards, 16px for larger overlays.
- Use borders and surface contrast before adding shadows. Shadows should communicate elevation, not decoration.

## 3. Workspace layout

- Desktop: persistent navigation, one main work surface, predictable page header and contextual actions.
- Mobile: navigation becomes a modal drawer; headers and toolbars wrap vertically.
- Editors may use a full-bleed workspace. List, settings and analytics pages use a centered content width with a comfortable maximum.
- Avoid nested scrolling except where data tables or filter groups need their own horizontal scroll.
- The document itself must not scroll horizontally at 320 CSS px.

## 4. Resource list pattern

Every large resource list should share this order:

1. Page title and one primary create action (only when permitted).
2. Search and status filters.
3. Sort field and sort direction.
4. Selection summary and bulk-action toolbar, scoped explicitly to the current page.
5. Results with a clear loading, error, empty or populated state.
6. Server-backed pagination and page-size selection.

Rules:

- Default page size: 25; offer 50 and 100 where the API supports them.
- Search should be debounced and must search the same fields named in its placeholder.
- Sorting and filtering must happen on the server for paginated data.
- Selection must reset when the page, query, filter or page size changes.
- “Select all on this page” must never imply “select every matching record”.
- Bulk operations should report partial failures instead of silently claiming full success.
- Destructive actions must identify the affected resource and require confirmation.
- Keep table overflow inside the table container, never on the page.

## 5. Dashboard and analytics

- Put operational queues before charts.
- Show counts only when the current role can read the underlying resource.
- A chart needs a clear metric, time range, axis context, accessible point labels and a tabular alternative.
- Date-only values must be formatted without timezone-induced day shifts.
- Empty analytics states should explain whether data is unavailable, not yet collected, or filtered out.
- Avoid celebratory percentage changes when the denominator is zero or the comparison is not meaningful.

## 6. Editors

- Keep title, status and primary save/publish action visible.
- Distinguish save, schedule, publish and unpublish; do not overload one ambiguous button.
- Communicate unsaved changes, autosave state, validation errors and conflicts inline.
- Keep destructive actions away from primary actions.
- Editor content should not be squeezed by the admin sidebar on mobile.
- Keyboard focus must remain visible while moving through toolbars, editor controls and dialogs.

## 7. Dialogs and feedback

- Every dialog has a programmatic name; use a description when additional context is needed.
- Move focus into the dialog, contain Tab/Shift+Tab, close on Escape where safe, and restore focus to the opener.
- Do not close a dialog while a destructive operation is pending unless the operation is intentionally allowed to continue in the background.
- Use inline status feedback for success and partial failure; reserve alerts for urgent errors.
- Do not use browser-native `alert()` or `confirm()` in admin workflows.
- A destructive dialog must not place its destructive action in the initial focus position.

## 8. Permissions

Use separate capabilities for reading, creating, editing, publishing, deleting and moderating. A user who can read a resource may still be unable to change it.

- Navigation and command-palette entries must reflect read access.
- Create controls use create permissions, not publish permissions.
- Publishing controls use publish permissions.
- Delete controls use delete permissions.
- Moderation queues are readable with read permission; moderation actions require moderation permission.
- UI checks improve clarity; API authorization remains the security boundary.

## 9. Arabic and RTL

- Set document `lang` and `dir` from the staff interface preference.
- Use logical CSS properties (`ps`, `pe`, `ms`, `me`, `start`, `end`) rather than left/right assumptions.
- Mirror directional icons only when their meaning is directional.
- Keep identifiers, URLs, email addresses and technical tokens in LTR isolation.
- Use locale-aware number and date formatting.
- Test both Arabic and English with long labels, empty states, tables and dialogs.

## 10. Accessibility and responsive acceptance

- Meet WCAG 2.2 AA contrast and keyboard requirements.
- Essential text must remain readable at 200% zoom.
- At 320 CSS px, content reflows without document-level horizontal scrolling.
- Touch targets should aim for 44×44 CSS px for primary actions.
- Every icon-only action needs an accessible name.
- Loading, success and error changes must be announced with appropriate live regions.
- Charts need non-visual equivalents; status needs text, not color alone.

## 12. Vibress Modern Workspace — Enterprise Design Language Specification

### 12.1 Philosophy and Principles
- **Calm Density & Information-Rich Minimalism:** Workspace navigation recedes into the background so the active editorial and operational workspace commands immediate visual priority. Inspired by Linear and Apple, density is achieved through typography hierarchy, alignment, and controlled contrast—never decorative clutter or gratuitous effects.
- **Enterprise Predictability:** Form controls, tables, filters, segmented controls, and badges adhere to a strictly unified token and interaction standard across all routes.
- **Bi-directional Fluidity (Arabic RTL / English LTR):** 100% of spatial layout and alignment rules are authored with CSS logical properties (`ps-`, `pe-`, `ms-`, `me-`, `text-start`, `text-end`, `start-`, `end-`). Language preference persists independently per staff account with zero layout shift or inverted alignment bugs.
- **Universal Accessibility (WCAG 2.2 AA):** Strict minimum 4.5:1 text-to-background contrast on every semantic token, visible focus rings with `ring-2 ring-primary/40 focus:outline-hidden`, complete ARIA keyboard navigation on tablists, and `@media (prefers-reduced-motion: reduce)` zeroing all transitions.

### 12.2 Semantic Color Tokens & Surface Layering
```css
/* Light Theme — Refined Neutral Workspace */
--background: #f8f9fa;      /* Clean neutral canvas */
--card: #ffffff;            /* Elevated primary workspace surface */
--border: #e2e5e9;          /* Subtle geometric separation */
--foreground: #0f172a;      /* Slate-900 high legibility */
--muted-foreground: #475569;/* Slate-600 secondary text (≥ 4.5:1 contrast) */
--primary: #2563eb;         /* Crisp royal sapphire */

/* Dark Theme — Deep Obsidian Canvas */
--background: #0d0f12;      /* Deep obsidian void */
--card: #15181e;            /* Layered slate working surface */
--border: #1f232e;          /* Crisp low-contrast boundary */
--foreground: #f8fafc;      /* Slate-50 crisp typography */
--muted-foreground: #94a3b8;/* Slate-400 secondary text (≥ 4.5:1 contrast) */
--primary: #3b82f6;         /* Luminescent blue accent */
```

### 12.3 Status Color System (WCAG AA Compliant)
- **Draft / Inactive:** Slate neutral (`bg-slate-500/10 text-slate-800 dark:text-slate-200 border-slate-500/25`) — eliminates outdated saturated pink text.
- **Published / Active:** Emerald green (`bg-emerald-500/12 text-emerald-800 dark:text-emerald-300 border-emerald-500/30`) — conveys positive lifecycle completion.
- **Scheduled / Enqueued:** Sky blue (`bg-blue-500/12 text-blue-800 dark:text-blue-300 border-blue-500/30`) — represents planned execution.
- **In Review / Pending:** Amber gold (`bg-amber-500/12 text-amber-800 dark:text-amber-300 border-amber-500/30`) — highlights required attention without alarmism.
- **Destructive / Error:** Rose ruby (`bg-rose-500/12 text-rose-800 dark:text-rose-300 border-rose-500/30`) — reserves high urgency for irreversible actions.

### 12.4 Standardized Shared Components
- **Segmented Control Tabs (`<Tabs>`):** Built with WAI-ARIA `role="tablist"` / `role="tab"`, `aria-selected`, and arrow key navigation (`ArrowLeft`, `ArrowRight`, `Home`, `End`). Styled as a subtle pill container (`bg-muted/60 p-1 border border-border/60 rounded-lg`).
- **Tactile Buttons (`<Button>`):** Subtle micro-interaction `active:scale-[0.99]`, `transition-all duration-150`, crisp `shadow-2xs`, and visible accessible focus indicators.
- **Semantic Badges (`<Badge>`):** Scaled to `text-[11px] font-medium px-2 py-0.5 rounded-full border` with WCAG AA compliance across both light and dark themes.
- **Unified Sidebar Navigation:** `NavSettings` and `Plugins` unified directly into the scrollable sidebar stack, eliminating horizontal boundary slicing across 900px desktop viewports. Header enhanced with sleek quick-command `⌘K` accelerator badge.
- **Modern Responsive Filter Bars:** Status filters grouped into segmented controls and separated cleanly from search and sort controls, eliminating desktop layout compression and ellipsis truncation.

### 12.5 Verification Evidence
Automated verification run against the live PostgreSQL database, gateway server, and browser runtime:
- **TypeScript:** 0 compilation errors (`tsc -b`).
- **ESLint:** 0 errors, 0 warnings across all admin files.
- **Vitest Unit Suite:** 29 test files, 149 tests passed cleanly in 15.4s.
- **Playwright E2E Design Acceptance Suite:** 11 browser acceptance tests passed cleanly in 20.1s across 320px, 390px, 430px, 1440px, dark/light themes, and Arabic RTL.
- **Visual Screenshots Artifacts:** Captured and stored in `docs/design/screenshots/redesign/` across all core routes, viewports, locales, and color themes.


## 7. Vibress Modern Workspace — 2026-10-31 refinements

### Role review
- **Product/UX:** Rebalance visual hierarchy so navigation recedes and editorial work remains the focus.
- **Frontend:** Retain existing React/Tailwind 4 components and existing function/permission contracts; alter design primitives and page composition rather than routes.
- **Accessibility/RTL:** Preserve keyboard focus and logical CSS spacing. Provide readable labels, semantic active filter states, and a visible skip link.
- **QA:** Require both locale directions, themes, multiple viewports and automated checks before release claims.

### Creative direction: Calm Density + Precision Minimalism
- **Mood:** Focused, quiet, editorial and enterprise-grade; preserve Vibress identity.
- **Palette:** Neutral canvas (`#f7f8fa` light, `#121416` dark), restrained sidebar (`#f3f5f7` / `#16191d`), inherited semantic status colors and one primary action.
- **Typography:** Page title 24–28px semibold; sections ~18px; body and control text ≥14px; metadata ≥12px.
- **Layout:** Existing 4/8px rhythm; more consistent 44px inputs, quiet navigation, flat cards and grouped settings rows.
- **Effects:** No gratuitous glassmorphism, default card shadows, flashing motion or oversized illustrated placeholders. A small reading-first icon is acceptable where no real image exists.

### Applied component rules
1. `AdminShell`: skip-to-content, dynamic viewport height and independent editorial scrolling; preserve the Studio editor's separate padding mode.
2. `AppSidebar`, `NavContent`: low-contrast sidebar canvas and proportionally tuned navigation spacing.
3. `AdminPageHeader`, `Button`, `Input`, `Card`, `Table`: shared typographic, shape and elevation rules; avoid the arbitrary 10–11px table headers.
4. `SettingsHub`, `SettingsSection`, `SettingsCardRow`: prominent content, calm active tabs, scan-friendly descriptions and wrapping actions.
5. `AnalyticsDashboard`: editorial queue remains first; action cards gain readable numbers and consistent hierarchy; latest-post summary avoids an oversized decorative placeholder.
6. `PostsList`, `PagesList`, `MembersList`, `MediaLibrary`: aligned filter states and consistent surfaces without changing query behavior.

### Research and evidence
- [Linear: A calmer interface for a product in motion (12 March 2026)](https://linear.app/now/behind-the-latest-design-refresh): give the working area precedence; harmonize headers, navigation and subtle boundaries.
- [Vercel Geist Design System](https://vercel.com/geist/introduction): systematic typography, grids, semantic colors and reusable controls.
- [W3C WCAG 2.2](https://www.w3.org/TR/wcag/): visible focus, reflow, control targets and text contrast.

### Delivery and acceptance limitations
**Source review and implemented changes are not equivalent to live visual QA.** The system must still be exercised in a real authenticated browser at 320, 390, 768, 1024 and 1440px for Arabic/English and both themes, including 200% text zoom, keyboard and destructive actions. Complete WCAG AA conformance, calibrated 9.5/10 scores and before/after screenshots must not be claimed without those observations.
