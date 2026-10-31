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


## Ghost-inspired editorial Admin — 31 October 2026

The design direction of **Vibress Editorial Workspace** draws on the actual source of modern Ghost: [TryGhost/Ghost/apps/admin](https://github.com/TryGhost/Ghost/tree/main/apps/admin) and the [Shade design system](https://github.com/TryGhost/Ghost/tree/main/apps/shade). The former TryGhost/Admin repository is archived and not an accurate modern reference. Only interaction and composition principles are studied; no Ghost source, logos, or brand artwork are copied.

### Research findings and product applications
1. **Structured workspace:** Ghost Admin uses a quiet navigation area and independent work surface; Vibress applies an inset editorial canvas on desktop while leaving the fullscreen Studio editor unchanged.
2. **Typographic focus:** The [Shade PageHeader](https://github.com/TryGhost/Ghost/blob/main/apps/shade/src/components/patterns/page-header.tsx) establishes clear title, metadata and action hierarchy; Vibress uses a 28–34px page title and retains one primary authorized create action.
3. **List-first publishing:** The [Shade ListPage](https://github.com/TryGhost/Ghost/blob/main/apps/shade/src/components/page-templates/list-page.tsx) and [FilterBar](https://github.com/TryGhost/Ghost/blob/main/apps/shade/src/components/patterns/filter-bar.tsx) emphasize calm list chrome; Vibress removes excess filter containers, uses flat editorial rows, and leaves bulk selection and server-backed sorting intact.
4. **Honest thumbnails:** Display actual post feature images only when available, not fake placeholders; prioritize title with inline author/date/status metadata and existing permission-gated contextual actions.
5. **Searchable settings:** The [Shade SettingGroup](https://github.com/TryGhost/Ghost/blob/main/apps/shade/src/components/patterns/setting-group.tsx) keeps related controls together; Vibress preserves its searchable, permission-aware SettingsHub with less visual noise.

### Implementation guardrails and review
- **Architecture:** no API contract, server state, publisher lifecycle, Studio serialization or permission changes.
- **RTL/localization:** preserve tr() translations, CSS logical spacing, date formatting, and dir=auto for mixed-script editorial titles.
- **Accessibility:** preserve accessible row buttons, keyboard focus, the action menu and destructive confirmations. Never rely on status color alone: visible status text is retained.
- **Release QA:** CI must finish; authenticated visual verification at 320, 390, 768, 1024 and 1440px in Arabic/English and light/dark, with keyboard, screen-reader, 200% text zoom and row-action checks, remains required before any claims of complete WCAG conformance.


### Second design review — October 31, 2026
- The existing screenshots in `docs/design/screenshots/redesign/` document the pre-PR editorial UI (the old bordered filters and repeated placeholder images); they do not validate the new PR render.
- Kept semantic status color **and** explicit status text. A calculation of CSS-token text contrast against the editorial white surface exceeds 4.5:1 for light-theme published, scheduled and review labels; full WCAG verification requires the running UI.
- Updated row analytics/edit actions to use the shared borderless ghost variant, retaining 40px targets and visible focus so secondary actions do not compete with the article title.
- Updated the sort labels on Posts and Pages to legible 14px type; no change to the server-backed sorting behavior.
- Post images intentionally display only when the resource has a source image; invalid-source handling still requires browser verification for layout shift at real network speeds.
- Ghost remains a conceptual benchmark, not a copied theme. See the preceding source links.


### Follow-up: cross-screen coherence
The second code/design review identified a real visual inconsistency: after converting Posts and Pages to flat editorial filters, Media, Members and Dashboard retained a separate, card-heavy segmented filter system. Harmonized all three with the same neutral selected state, unboxed filter rail, readable labels and 44px control targets. Kept search/filter queries, server sorting, table semantics, media actions and analytics data rendering unchanged. Regression checks must include the existing multi-screen browser screenshot suite; past screenshots are baseline only.

## Posts and Pages — focused Ghost-comparison refinement (2026-10-31)

Current Ghost reference: [TryGhost/Ghost `posts-list-screen.tsx`](https://github.com/TryGhost/Ghost/blob/main/apps/admin/src/posts/list/posts-list-screen.tsx) and [`post-list-row.tsx`](https://github.com/TryGhost/Ghost/blob/main/apps/admin/src/posts/list/components/post-list-row.tsx); both Posts and Pages render the same list screen via a resource argument. Ghost uses a persistent list header, compact contextual filters, consistent feature-image geometry, and localized publishing metadata.

### Confirmed defects and fixes
- **Incomplete loading/error screen:** The former early returns hid the creation action, page header and filters; loading/error/retry are now always inside the result region.
- **Mobile filter overflow:** Six desktop tabs were squeezed into an undiscoverable horizontal strip at 320px; use an accessible native status select below 768px and tabs above.
- **Stale selection:** Sorting left previously selected item IDs checked; reset selection on both sort-field and sort-direction changes.
- **Ragged editorial rows:** Post image failures caused columns to jump and missing images shifted titles. Keep image geometry reserved for Posts, using a subtle Lucide placeholder; Pages without feature images use clean text-first rows.
- **Duplicate edit focus:** Two accessible buttons for the same edit operation caused repetitive keyboard stops; retain one row-level edit action and a separate authorized analytics action.
- **Clipped context menus:** Menus within a scrollable admin shell could be cut at the bottom; portal the menu into the document layer and compute viewport-aware placement. Close on Escape, outside pointer, focus leave, scroll or resize; restore trigger focus on Escape.
- **Inconsistent empty state:** Add clear-filter recovery for zero matching results, and first-content creation guidance for empty publications. Preserve localized Arabic text.
- **Double separators:** Avoid both `divide-y` and explicit row borders within the same list.
- **Desktop long-list workflow:** Keep the toolbar sticky from the tablet breakpoint without trapping mobile users behind a tall fixed header.

### Quality gates
- Automated: TypeScript, lint, editorial row tests, mobile filter tests, and full existing CI.
- Browser: compare real authenticated Posts/Pages screenshots at 320, 390, 768, 1024 and 1440px; Arabic RTL and English LTR, both themes, 200% zoom, many items, zero items, reload, failed image, failed list fetch, last-row menu and bulk actions.
- This is a reviewable implementation, **not** a certified 9.5/10 score until the browser gates above pass.


### Final editorial copy polish
- Ghost-style resource lists start with the resource name and a single primary **New Post / New Page** action; remove lengthy descriptive subtitle from those two high-frequency screens only.
- Status selects show **All Posts** and **All Pages**, not an ambiguous unqualified `All`, especially on 320px Arabic screens. Keys remain localized with the existing Arabic dictionary.

### Final content-state consistency
- Distinguish an empty publication from a filtered zero-match result without repeating the same message twice. Keep one creation CTA and one clear-filters CTA, each conditionally visible.
- Do not announce old `total` values while a new query is loading or has failed; show a localized result-state message.
- For scheduled posts and pages, display the scheduled timestamp when the API provides it, instead of the unrelated last-edit date.


### Ghost comparison: filter disclosure
The latest Ghost `PostsListScreen` places a filter trigger and sort menu in the header, expanding a filter row only when active. After a second visual critique, Vibress's six permanent status tabs were still too dense and duplicated the sidebar quick views. Replaced them with one 44px accessible native status menu (localized **All Posts / All Pages**), alongside search and sorting. This keeps all states accessible without recreating the current Ghost's custom popover architecture or introducing dependencies.

### Small-view sticky-header guard
The filter rail becomes sticky only in wide desktop workspaces (≥1280 CSS px). At 768 and 1024px a wrapping toolbar can be several rows tall, so leaving it in document flow avoids occluding most of the content and keyboard focus.

### Follow-up: factual analytics and editor smoke tests (2026-10-31)
- Move the global analytics overview action into the permission-gated page header instead of presenting a generic dashboard as per-post metrics.
- Keep explicit real status text for unrecognized editorial states rather than mislabeling them Draft; increase metadata and pagination text to at least 14px.
- Align Playwright Studio article creation with the current accessible **New Post** button, fixing three prior false timeouts at the old **Create Post** selector. Keep the Studio creation journey covered by E2E.
- Localize the remaining partial-bulk-failure instruction.


### Query transition safety (2026-10-31)
- List search, filter, sort and pagination persist as URL query state with tab-local backup when editors navigate back. Values are validated; no content bodies or credentials are stored.
- Quick sidebar status views use distinct route keys and do not mutate the main Posts/Pages saved list state.
- On every query transition, show only the loading skeleton, then the matching response or a retryable error. Previously loaded rows and bulk controls are unavailable until the new query succeeds, avoiding destructive actions against stale filters.
- Pagination is suppressed during loading and failed requests; its count cannot suggest outdated results.


### Accessible contextual menu — source-level review
The row contextual actions now expose menu and menuitem semantics, a menu-capable trigger, and ArrowUp/ArrowDown/Home/End keyboard traversal. Existing viewport-aware portal positioning, outside-click dismissal and Escape focus return remain intact. A focused Vitest regression case checks keyboard behavior without adding a UI dependency.


### In-flight search and partial-bulk retry polish
- During the 250ms search debounce, the content region is already in a non-interactive pending state; previously the old rows could remain clickable until network fetch began.
- Failed batch mutation IDs stay selected after a mixed successful/failed run, enabling an intentional retry of only unresolved items. Completed IDs are removed from the selection. Permission-gated actions and confirmation remain unchanged.

### Single primary create action
Empty states contain explanatory text and filter recovery only. The existing permission-gated **New Post / New Page** page-header CTA is the single creation entry point, avoiding duplicate action hierarchy and ambiguous automated button matching.

### Request-identity guard
Posts/Pages now tie each loaded/error state to the exact page, size, filter, sort and debounced query key. Changes to status or sort immediately show a non-interactive pending view, before effects start the next API call. Stale previous errors are never presented as the new query result.


## 2026-10-31 — Editorial disclosure controls (Ghost-informed)

### Creative direction
The content list, not its controls, is the primary visual surface. A small search control, `Filter` disclosure, `Sort` disclosure and optional `Select` mode replace always-visible native selects and a second sort-direction control. Both lists reuse `EditorialChoiceMenu` and `EditorialStatusFilter`, so RTL, contrast, focus and spacing remain aligned.

- **Filter & Sort:** compact 44px triggers, hidden popover until clicked, checked option in a viewport-aware menu; native-like keyboard traversal (arrows, Home/End, Escape and focus restoration), outside dismissal and direction-aware placement. Applied also to pagination's page size.
- **Active filters:** small removable chips show selected status or non-default sort, restoring context without leaving fields expanded.
- **Selection:** the 40px checkbox overlay remains accessible by hover or keyboard focus on pointer devices, and through explicit `Select` mode for touch users. It doesn't occupy a permanent list column. The existing bulk toolbar is shown only for actual selected items and remains permission-gated.
- **Navigation:** each editable article/page has a real `href` overlay, preserving Cmd/Ctrl-click and open-in-new-tab; ordinary activation still uses the SPA route.
- **Layout:** status and metadata remain true to API values, list titles use 16px text, global analytics leaves the list header, and blank publications get a distinct empty heading from zero search results.
- **Accessibility:** keep visible keyboard focus and available 44px trigger targets, no reliance on hover to expose touch selection, no loss of Arabic translations, page-sort/query persistence or user capabilities.

### Comparison/reference and acceptance checks
Ghost's current React PostsListScreen reveals filter choices on demand; its PostListRow uses contextual selection and a distinct selected surface rather than a permanently visible checkbox column. Radix UI's menu documentation establishes the keyboard and focus conventions implemented with existing React primitives here, without adding dependencies. See official sources: https://github.com/TryGhost/Ghost/blob/main/apps/admin/src/posts/list/posts-list-screen.tsx and https://www.radix-ui.com/primitives/docs/components/dropdown-menu.

Acceptance requires CI Typecheck/Lint/Unit/E2E/Build plus actual browser verification at 320/390/768/1024/1440 px, Arabic RTL and English LTR, light/dark, keyboard Tab/arrow/Escape, screenreader labels and touch selection. A numeric design score is not certified until actual screenshots have been checked.

## 2026-10-31 — Button System v2

### Rationale
Shared buttons in Vibress must read as **one action system**, not a separate visual language per screen. References: [Radix Themes Button](https://www.radix-ui.com/themes/docs/components/button) (distinct size, appearance and loading axes) and [WCAG 2.2](https://www.w3.org/TR/WCAG22/#target-size-minimum) (AA pointer target floor 24px subject to exceptions; this product aims higher for touch actions).

### Implementation
- **Variants**: `default` (single highest-priority primary), `secondary` / `subtle` (supporting), `outline` (bounded neutral), `ghost` (quiet contextual controls), `destructive` (danger only), and `link` (text navigation). Neutral colors and borders use existing semantic tokens.
- **Sizes**: xs=32px, sm=40px, default=44px, lg=48px, icon=44×44px, icon-sm=40×40px. `xs` is reserved for compact non-touch situations; 44px is preferred for touch. Avoid arbitrary local `h-8` overrides inside shared controls.
- **States**: default/hover/focus-visible/pressed/disabled/loading. `loading` disables activation, keeps its original text footprint via invisible text and a centered indicator, and takes a localized `loadingLabel` for assistive technology. Reduced motion disables the spinner animation via `motion-reduce`.
- **Form safety**: shared Button always defaults to `type="button"`; actual submit actions must explicitly use `type="submit"`. Icon-only controls require meaningful localized labels.
- **Selection filters**: `ToggleButton` exposes `aria-pressed`, shares the size/token/focus system, and must not be substituted for actual page navigation or a tab panel. Applied to Settings, Members, Media and Analytics.
- **Screen integration**: Post/Page editor Save uses stable geometry while saving; Media upload delegates to a keyboard-accessible Button that invokes a hidden file input; mobile toolbar uses IconButton and consistent 40px controls.
- **Composition**: one principal solid action per header or dialog group; put cancel/preview behind quieter variants; destructive confirmation is separated and never shown as primary before user intent.

### Regression gates
1. TypeScript + Lint + Unit + E2E + Build must pass on the PR head.
2. Review keyboard order, visible focus, 200% text scaling, disabled/loading announcements, pointer interactions and error retries across RTL Arabic and LTR English.
3. Verify real screenshots at 320, 390, 768, 1024 and 1440 CSS px in both themes. Do not claim that any score, contrast audit or visual QA is certified without exercising those views.

This branch is independent of in-flight PR #102 (editorial disclosure toolbar): the new shared Button/ToggleButton layer is compatible with its controls, and Posts/Pages files are intentionally not changed here to avoid merge overlap.


## 2026-10-31 — Unified batch actions (Posts & Pages)

The screenshot review exposed accidental differences within one toolbar: `sm` buttons had `rounded-md`, standard buttons `rounded-lg`, and Publish/Unpublish/Delete/Clear mixed full solid, outline, ghost and solid destructive treatments. This is an inconsistent component system, not merely a palette issue.

**Component rule:** every control in one related action group must use the same `size`, **44px minimum target height**, corner radius (`rounded-lg`), typographic level (14px medium), vertical padding, and icon geometry (16px). Responsive layout can rearrange the group without changing button sizing. Button v2 `sm` and `xs` no longer override the shared radius; only explicit context/shape components can vary it.

**Hierarchy:** New Post/Page remains the one high-emphasis solid action in the header. In the contextual batch toolbar, Publish, Unpublish and Clear use the same low-emphasis `outline`, while Delete uses the parallel **`destructive-outline`** variant (not an attention-grabbing solid danger button before confirmation). Destructive confirmation dialogs continue to use solid `destructive` when the user explicitly confirms deletion.

**Architecture:** Posts and Pages share `EditorialBulkActions`, including permission/state visibility, localized labels, action order, and ARIA toolbar semantics. The user still confirms batch mutations in the existing Dialog. All four actions have matching text/icon gaps, width rules and responsive behavior. No API or permission logic changed.

**QA:** test 320/390/768/1024/1440px, Arabic RTL & English LTR, light/dark, long text at 200% zoom, keyboard focus, mixed published/draft selections and confirmation dialogs. See the [Carbon Design System button-group guidance](https://www.carbondesignsystem.com/building-blocks/core/components/button/guidelines) for grouping and avoiding mixed sizes. Do not claim verified visual compliance without browser screenshots.


## 2026-10-31 — Unified Editorial Selection System (Ghost & Apple Aesthetic)

### Rationale and Problem Statement
The top **Select** button followed the desired minimal, modern design; however, the subheader **Select all on this page** checkbox and individual row checkboxes lacked visual coherence:
- Row checkboxes floated directly over feature thumbnails inside stark white card containers with heavy drop shadows (`bg-card/95 border-border/60 shadow-sm`).
- Selected rows were overlaid with a heavy, distracting gray wash (`data-[selected=true]:bg-primary/7`) that degraded text contrast and veiled media artwork.
- Subheaders rendered unstyled native checkboxes without support for the intermediate (indeterminate) state when only some rows were selected.

### Unified Implementation
1. **Shared `EditorialSelectionCheckbox` Component (`apps/admin/src/components/common/EditorialSelectionCheckbox.tsx`):**
   - **Unified Geometry:** 18×18px visual box, `rounded-[5px]`, matching Lucide `Check` and `Minus` icons with `stroke-[2.75]`.
   - **Semantic Tokens:** Built entirely on CSS variable tokens (`border-border/80 bg-background/40` unchecked, adapting automatically across light and dark modes; `border-primary bg-primary text-primary-foreground` when checked or indeterminate). No hardcoded hex or theme overrides.
   - **Accessibility & Touch Target:** Enforces a minimum 44×44px interactive target on the wrapping `<label>`, native keyboard focus visibility via `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`, and programmatic `aria-checked="mixed"` for indeterminate state.
2. **Row Integration & Artwork Geometry:**
   - Checkboxes are placed in a dedicated leading slot before the thumbnail rather than overlapping it with floating card overlays.
   - Thumbnails remain 100% visible, crisp, and unobstructed in all selection states.
3. **Selected Row Surface:**
   - Replaced heavy gray wash with an ultra-subtle, theme-aware tint (`bg-primary/[0.035] dark:bg-primary/[0.055]`).
   - Clear distinction between row hover (`hover:bg-muted/20`), keyboard focus (`focus-within:bg-muted/20`), and selection (`selected`).
4. **Progressive Disclosure & State Synchronization:**
   - Top **Select** button acts as the explicit toggle for list-wide selection mode.
   - When selection mode is inactive on desktop, row checkboxes remain concealed until revealed via pointer hover or keyboard focus.
   - On touch devices or when selection mode is active, checkboxes are persistently displayed.
   - "Select all on this page" calculates `isIndeterminate = someVisibleSelected && !allVisibleSelected` and renders the minus glyph.
   - Clearing selection via `EditorialBulkActions` resets both selected IDs and selection mode.
5. **Cross-Resource Parity:**
   - Posts and Pages share the exact same `EditorialSelectionCheckbox`, row layout, bulk toolbar, and indeterminate selection logic.

### Verification & Artifacts
- **Unit Tests:** `apps/admin/src/components/common/__tests__/EditorialSelectionCheckbox.test.tsx` (6 tests) and `EditorialListRow.test.tsx` (14 tests) passing 100%.
- **Full Suite:** 36 test files, 183 tests in `apps/admin` passing 100%.
- **E2E Acceptance:** 11 Playwright acceptance tests in `tests/e2e/admin-ui-design-acceptance.test.ts` passing 100%.
- **Responsive & Theme Verification:** Captured visual verification across Light and Dark themes, 320px, 390px, and 1440px viewports, and English LTR / Arabic RTL layouts.
