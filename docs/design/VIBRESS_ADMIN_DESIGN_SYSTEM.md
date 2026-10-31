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

## 11. Definition of done

A change is not design-complete until:

- It uses the shared semantic tokens and component patterns.
- It has loading, error, empty, success and disabled states where applicable.
- It works in Arabic and English.
- It passes 320px reflow and keyboard checks.
- It respects role permissions.
- Destructive actions are confirmed and provide a result.
- E2E coverage exists for any changed critical workflow.
- Typecheck, lint, unit tests, build and relevant E2E tests pass.

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

**Design direction:** Content-first publishing interface, informed by the current `TryGhost/Ghost` monorepo, especially `apps/admin` and the `apps/shade` design system. Use principles and patterns, not Ghost brand marks, assets, copied source, or platform feature assumptions.

**Reference investigation (code and product):**
- [Ghost Shade design system](https://github.com/TryGhost/Ghost/tree/main/apps/shade): semantic tokens, reusable PageHeader / SettingGroup / FilterBar / ListPage patterns.
- [Ghost current React Admin](https://github.com/TryGhost/Ghost/tree/main/apps/admin): app-level Admin layout, page chrome, organized content operations.
- [Ghost: Organizing content](https://ghost.org/help/organizing-content/): article-first lists, searching, statuses, view filters and bulk actions.
- [Ghost: Refreshed settings](https://ghost.org/changelog/refreshed-settings/): one searchable settings workspace with dedicated section navigation.
- [Ghost Shade component rules](https://github.com/TryGhost/Ghost/blob/main/apps/shade/AGENTS.md): default, hover, focus, disabled and semantic-theme requirements.
- The former `TryGhost/Admin` repository is archived; never treat it as the contemporary UI source.

### Role review and implementation constraints
- **Product design:** A calm sidebar, content-first white editorial canvas, strong 28/34px headings, no fake home statistics.
- **Frontend:** Only adjust Admin shell, reusable navigation, list and settings presentation; preserve API hooks, async state, mutation semantics, and native Studio editor surface.
- **Internationalization:** Use existing `tr()` strings and CSS logical properties, preserve Arabic/LTR and mixed-direction content.
- **Security:** Existing permission-gated actions and destructive confirmation flows remain authoritative; never create fake controls.
- **QA:** Verify at 320/390/768/1024/1440 CSS pixels, both color schemes, keyboard navigation, input labels, 200% text scaling and authenticated workflows.

### Vibress-specific rules
1. The non-Studio Admin surface is a restrained inset editorial canvas on desktop, with a distinct, quiet navigation rail. Studio stays fullscreen as before.
2. Active navigation states use a neutral fill and semibold label; do not decorate every active item with a high-contrast border and shadow.
3. Publishing lists use a flat, scrollable row pattern, uncluttered search/filter controls, visible bulk action feedback and a clear primary create action.
4. Display actual post image thumbnails if available; do not substitute fake images for content without one. Metadata follows title in a compact, legible inline grouping.
5. Settings keep one searchable workspace; use section headers, plain groups and restrained actions.
6. Semantic status colors and dark mode must remain readable; never rely solely on color to communicate state.
7. Never claim an achieved score, full accessibility certification, or visual comparisons without a running browser and screenshots.

### Verification gate
A GitHub PR and CI will test type-check/lint/tests/build. UI screenshot validation requires a running authenticated instance and remains a release prerequisite. This document records design decisions, not a WCAG certificate.
