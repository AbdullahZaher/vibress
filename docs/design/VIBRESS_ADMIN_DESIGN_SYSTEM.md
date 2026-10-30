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
