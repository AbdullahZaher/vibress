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
