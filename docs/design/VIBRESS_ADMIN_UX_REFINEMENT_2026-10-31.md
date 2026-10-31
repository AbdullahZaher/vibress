# Vibress Admin — targeted enterprise UX refinement

**Date:** 2026-10-31. **Scope:** A first implementation pass, not certification of all Admin surfaces.

## Role review
- Frontend: retain existing React, Tailwind v4, shared component architecture and API contracts.
- UX/accessibility: improve predictable keyboard handling, semantic links, and responsive navigation.
- RTL: use logical start/end placement and per-component unique IDs.
- QA: introduce a command-palette keyboard regression and require CI/browser testing.

## Evidence-based findings and remediation
| Severity | Finding | Fix |
| --- | --- | --- |
| P1 | Command palette declared a result-scroll ref without attaching it | Attach the ref, expose selected option and keyboard state to assistive technology |
| P1 | Posts navigation reused a static DOM ID across responsive sidebar instances | Replace with useId and pair with aria-controls |
| P1 | Analytics time range used a custom popup without robust listbox/focus behavior | Replace with native select; preserve time-range values |
| P2 | Mobile header page title acted as a surprise dashboard navigation button | Render the current page label without an unrelated click action |
| P2 | Main/sidebar settings controls did not consistently provide 44px height or focus treatment | Unify basic navigation affordances and active marker |
| P2 | Help/View Site used JS popup buttons | Render normal, accessible external links |
| P2 | Page header action row could resist shrinking | Allow wrapping and responsive width |

## Creative direction
Calm editorial-first admin. Keep existing semantic tokens and Arabic/English typography; favor native controls, restraint, clearer focus and stronger information hierarchy over decorative changes.

## Verification limits
Run typecheck, lint, relevant Vitest suites and build. Browser-check 320/390/768/1024/1440px, both languages and themes, and keyboard navigation, as well as editor, permissions, and Studio workflows. No complete audit score or full WCAG certification is claimed for this limited pass.

## Next design review
Review all remaining tables, settings forms, plugins, media, translation and content-model surfaces; capture genuine before/after browser screenshots and fix regressions before marking an enterprise-level redesign complete.
