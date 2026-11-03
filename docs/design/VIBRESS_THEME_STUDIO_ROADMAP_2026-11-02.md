# Vibress Theme Studio — Design-to-Production Roadmap
**Date:** 2026-11-02  
**Branch:** `design/theme-studio-95-ux`  
**Baseline:** `main` at `e6c94e1f99b792025a4d7ee061301e85099da32f`  
**Owner:** Design / Admin UX  
**Target:** **9.5/10**, not an asserted score. Approval requires authenticated visual QA and automated checks.

## Intent and non-goals
Turn Settings → Site → Themes from a narrow technical drawer into a premium, image-led Theme Studio without altering the content, security, API or publication isolation model. Maintain Vibress calm-density editorial identity and the **single Admin sidebar**. No marketplace, arbitrary JS execution, invented screenshots, uncommitted preview claims, or theme-engine rewrite.

## Grounded audit
- `ThemesManagerCard.tsx`: text-first cards ignore `ApiThemeSummary.previewImage`; `max-w-2xl` drawer; 12px main labels; long developer information dominates; activation/deletion errors silently swallowed; preview icon relies on `title`; drop zone not keyboard-operable; hard-coded English.
- `SettingsCardRow.tsx`: supports `currentValue` in the API but intentionally does not render it, so the Settings page cannot identify the active theme even when data is available. Add a dedicated compact active summary instead of changing every card globally.
- `ThemeSettingsEditor.tsx`: functional schema-powered editor, but raw two-column fields require clear grouping and improved feedback; persisted values per inactive theme are supported.
- `/themes/:id/preview`: short-lived publication-scoped token, not a live unsaved draft preview. Must not imply draft preview without a new secured backend contract.
- `packages/themes-registry`: default, minimal and molten built-ins; preview artwork must be genuinely representative rather than stock images.
- `SettingsModalPortal`: focus and escape management must respect nested confirmations/upload modal.
- PR #115 merged on 2026-11-02; retain its accessibility, focus, bilingual and confirmation hardening.

## Creative direction
**Quiet Editorial Gallery:** image-first visual scan, one clear active site appearance, sophisticated neutral surfaces, clear outlined Preview and a single high-emphasis Publish/Activate action, tech information behind progressive disclosure. Semantic color tokens only, 14px body text, 4/8px rhythm and 44px touch targets. Full-width workspace (not a second sidebar), accessible 16:10 image slots, no placeholder image pretending to be a screenshot. English LTR and Arabic RTL.

## User journeys
1. Settings opens → see published theme name/status even before management is opened.
2. Open Studio → see current theme first → scan real theme screenshots → compare names/features → open secure actual-site preview.
3. Customize → edit only schema-defined values → explicit Save (does not publish inactive theme) → confirm discard on exit.
4. Publish another installed theme → explicit confirmation mentioning live public impact → pending state → server-confirmed success or actionable error → keep previous theme on failure.
5. Install ZIP → accessible picker/drop area → file validation and progress → success/error → catalog refresh; never automatically publish.
6. Uninstall inactive external theme → destructive confirmation → server-confirmed result; never remove active/built-in.
7. Failure/empty/slow network → visible retry, stable layout and appropriate live regions.

## Execution phases and gates
### Phase 0 — Baseline and documentation
- [x] Create isolated branch and track documented design / user journeys / risk boundaries.
- [ ] Capture *actual authenticated* current screenshots: 320, 390, 768, 1024, 1440; dark/light; Arabic/English. Never treat 2026-10-31 legacy screenshots as after evidence.

### Phase 1 — Active summary and lifecycle correctness
- [ ] Load the active theme on Settings render, using API values rather than a default name when requests fail.
- [ ] Distinguish loading vs API error vs not installed; retry and publication changes.
- [ ] Explain activation and report server results without optimistic false success.

### Phase 2 — Theme gallery and spatial UX
- [ ] Responsive, generous studio surface without nested Admin sidebar.
- [ ] Actual `previewImage` support with validation and honest fallback; named theme, active state, non-intrusive metadata and actions.
- [ ] Keep the active theme prominent and all nonactive themes predictable. Preserve accessible action labels and existing operational controls.

### Phase 3 — Preview, publish and safety
- [ ] Preview tokens remain publication-scoped. Open popup synchronously or provide navigation fallback if blocked.
- [ ] Preview changes do *not* affect public theme. Never claim unsaved draft is previewable without backend support.
- [ ] Confirmation before publication, busy state, no double submission, error and success feedback, previous active theme unchanged on error.

### Phase 4 — Editor
- [ ] Organize fields into understandable sections using theme-supported schema keys, not hardcoded phantom settings.
- [ ] Clear dirty state, save/cancel, accurate feedback; distinguish Save Settings and Publish Theme.
- [ ] Optional real draft-preview support only behind separate API feature with authorization, expiry and explicit validation.

### Phase 5 — Upload, RTL and accessibility
- [ ] Button/label-driven ZIP picker, keyboard + drag/drop, file-name, file type and size hint, pending/error/success.
- [ ] Translate visible UI, confirmation dialogs and recovery actions, logical start/end spacing.
- [ ] WCAG 2.2 AA: contrast, keyboard, focus restoration, labels, dynamic announcements, 200% text zoom, reduced motion.

### Phase 6 — Quality gates and release
- [ ] Typecheck, lint, Vitest and Playwright pass on exact HEAD.
- [ ] Integration checks: save inactive theme, preview, activation fail/succeed, uninstall active guard, uploads.
- [ ] Manual browser visual QA at 320/390/768/1024/1440, AR/EN, light/dark, keyboard, 200% zoom and reduced motion.
- [ ] Screenshot comparisons and independent signoff. Never assert 9.5 or production-ready without gates.

## Acceptance scoring
| Category | Weight | Gate |
|---|---:|---|
| Visual hierarchy & polish | 25% | 9.6 |
| Discovery/comparison | 20% | 9.6 |
| Preview/customization/publishing | 20% | 9.5 |
| Accessibility & RTL | 15% | 9.5 |
| Responsive density | 10% | 9.5 |
| Reliability/feedback | 10% | 9.5 |

Release needs weighted ≥9.5/10 after visual QA, zero P0/P1 regressions, and no misrepresentation of active/published state.

## Source ownership
`apps/admin/src/components/settings/site/ThemesManagerCard.tsx`, `ThemeSettingsEditor.tsx`, `SettingsHub.tsx`, `SettingsCardRow.tsx`, `SettingsModalPortal.tsx`, `apps/admin/src/lib/api/themes.ts`, `apps/admin/src/lib/admin-locale.tsx`, `apps/admin/src/components/settings/site/__tests__/*`, `tests/e2e/*`, `docs/design/VIBRESS_ADMIN_DESIGN_SYSTEM.md`, and this document.

## Operational risks
- **No real screenshots:** show neutral fallback artwork; never mislabel as theme screenshot.
- **Preview popup blockers:** open browsing context directly from user activation; report block/failure.
- **Legacy tests:** keep existing dialogs, editor and card actions discoverable while modernizing the layout.
- **Concurrent publication changes:** refresh scoped state on `vibress:publication-changed`, prevent stale success.
- **Accessibility:** a full-screen studio overlay is still a dialog, not another sidebar; focus must be trapped and restored.

## Research-derived design principles
- Ghost: simple preview/install decision flow; less admin chrome.
- Shopify: clear published vs draft themes and separate save from publish.
- WordPress: test theme on actual site content before activation.
- WCAG 2.2/WAI-ARIA: predictable accessible dialog, focus management, keyboard-operable controls.
Sources: https://ghost.org/help/ / https://help.shopify.com/en/manual/online-store/themes / https://wordpress.org/documentation/article/appearance-themes-screen/ / https://www.w3.org/TR/WCAG22/ / https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/.


## Implementation log — 2026-11-02 (PR #117, draft)
**Source implementation exists on the branch; these marks do not signify QA acceptance.**

| Phase | Implemented | Still required for acceptance |
|---|---|---|
| 0. Baseline | Branch, roadmap, design-system and domain documentation; reproducible authenticated screenshot-capture script | Run screenshot matrix on an authenticated staging instance and review images |
| 1. Active state | Published theme name/version on Settings, async loading/error/retry, publication-change invalidation, lifecycle feedback | Verify each publication, error recovery, concurrent action safety in browser |
| 2. Gallery | Wide studio surface, responsive image-led gallery, honest missing-image state, search and filters, active-first ordering | Approved real screenshot assets for built-in themes; browser visual signoff; decide whether dedicated route supersedes modal |
| 3. Preview/publishing | Existing short-lived preview token reused; explicit confirmation, success/failure and nonpublishing fallback link | Browser popup tests, expired preview-token UX, in-place device preview if feasible |
| 4. Customizer | Grouped schema-backed controls, human-readable labels, Save vs Publish, local Discard, error/retry | Full design QA of all supported schemas; live unsaved draft preview needs separate secure backend capability |
| 5. Upload/i18n/a11y | Keyboard-operable ZIP drop zone and file input, progress/status, no duplicate install, Arabic labels, modal focus hooks | Manual VoiceOver/NVDA, target-size checks, 200% zoom, Arabic screenshots |
| 6. Release | Gallery unit tests, publish failure/preview fallback unit tests, existing settings E2E adjusted, CI started on draft PR | Exact-head green CI, accessibility review and authenticated visual matrix before production |

**Release status:** IN PROGRESS — NOT PRODUCTION APPROVED. No claim of 9.5/10 until exact-head CI, screenshot comparison and WCAG 2.2 AA verification. The branch intentionally does not change the active public theme or deploy any code.

### Preview-workspace refinement (2026-11-02)
- A secure in-Studio, sandboxed responsive preview (desktop/tablet/mobile) uses existing publication-scoped tokens and persisted theme settings; visitors cannot publish from the preview.
- An explicit external-tab link and preview-token refresh control remain available. The responsive iframe uses the requested device width, horizontally scrollable on narrow screens rather than misreporting the viewport.
- Live unsaved settings preview **remains out of scope** until a separate secure draft-preview API is designed and tested; do not confuse saved-settings preview with live draft changes.

### Theme Studio refinements — 2026-11-02
- Published theme now appears in a dedicated full-width editorial hero; other themes remain in a responsive 16:10 library.
- Built-in themes still need real privacy-reviewed screenshots. The gallery NEVER substitutes generic images for a screenshot. Capture only from a seeded, authorized staging publication; approve output before including in public theme manifests.
- The editor displays live schema-bound color swatches and unsaved field changes; these are NOT fake live site previews. Save settings before previewing the actual site.
- The iframe preview is static/sandboxed, with visible limitations and an error/timeout fallback to a full preview tab. Real theme JS may require the full preview.
- Sources: https://developer.wordpress.org/themes/core-concepts/theme-structure/ ; https://help.shopify.com/en/manual/online-store/themes/adding-themes ; https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/.
- PR #117 remains draft until image assets are genuine, CI succeeds and screen reader / RTL visual acceptance is completed.

### Responsive preview, category semantics and CI capture hardening (2026-11-02)
- The pending-delete guard now explicitly consumes isDeleting, fixing the exact-head CI typecheck error (TS6133).
- On a 320px viewport the mobile preview canvas flexes to its available width up to 390px instead of forcing two-dimensional chrome scrolling. Tablet/desktop retain intentional canvas scrolling with explanatory copy.
- Customizer classification places footerText and other content keys into Content, with header/footer style and widths in Layout; the action bar is sticky only at larger widths.
- E2E screenshot assets are now stored in artifacts/theme-studio-ci (instead of test-results, which the next Playwright run cleans). They are uploaded as a short-lived PRIVATE CI QA artifact, never auto-published.
- Genuine screenshots must be visually inspected, redacted if needed and only then added to published theme manifests. This cannot be replaced with synthetic gallery artwork.
- References: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html ; https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor .

## Appearance Consolidation Addendum (2026-11-03, PR #118)

- **Site Identity:** The Site Settings card owns logo and favicon uploads only. Its stable `design-branding` registry ID and `site-branding` anchor remain for legacy navigation; `coverUrl` and publication metadata persist without newly invented editors.
- **Theme Studio:** Accent color, palettes, typography and layout are controlled only by each theme's validated schema-supported options. Settings searches for `accent`, `palette`, and corresponding Arabic terms route to Theme Studio rather than Site Identity. No mock live palette preview is shown.
- **Published upgrade parity:** Migration 0051 preserves the previously effective Default theme accent for each existing publication, including installations without an explicit active theme row, while retaining other choices and inactive-theme settings.
- **Public rendering:** Default, Minimal and Molten use theme-owned validated accents. Announcement bars use the active or authorized preview theme's color with WCAG AA black/white foreground contrast; unsupported theme schemas use a neutral background. External Liquid theme site-level accent fields remain in the compatibility contract.
- **No false preview promise:** Saving theme settings does not automatically publish another theme, and unsaved draft values are not displayed in the actual site preview.
- **Release verification:** Test at 320/390/768/1024/1440 in both writing directions and appearance modes; inspect keyboard navigation, upload failure/success, published color before/after a real upgrade and exact-head CI before releasing.
