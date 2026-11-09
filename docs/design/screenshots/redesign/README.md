# Admin redesign screenshot evidence

These screenshots are historical design-review evidence. They are **not** a certification of current UI accessibility, completeness, security, or production readiness; fresh review of a running, authenticated CMS remains required.

## Corrected evidence record — 2026-11-09

The file formerly named `08-subscriptions-list-1440-dark.png` was **byte-for-byte identical** to `09-settings-hub-1440-dark.png` (Git blob SHA `8f57dd32e9dd5dfab1a2d5490b830c44ba8c0e6d`). Inspection confirmed that the image depicts the **Settings hub**, not a subscriptions list. To avoid presenting fabricated coverage, the mislabeled copy was removed from this active evidence directory. The correctly named `09-settings-hub-1440-dark.png` is retained unchanged, and the removed blob is available through Git history.

In the current admin router, `/admin/subscriptions` resolves to the **SettingsHub** with its membership section selected. A separate `SubscriptionsList` component exists but is not exposed by that router path. Do not relabel a screenshot from the membership settings page as an independent subscriptions list.

## Recapturing evidence

To supply a genuinely distinct subscriptions-list capture, first verify that a supported public admin route exposes that UI, that the signed-in user is authorized for the publication, and that the screen shows real **non-sensitive seeded test data**. Use a real browser and inspect the result before committing it. Do not change app routing solely to satisfy a screenshot name.

The current CI image artifact (`admin-ui-design-review-<run-id>`) includes authenticated Theme Studio/Settings screenshots but is not evidence of an independent subscriptions list. Store new raw screenshots under ignored `artifacts/` for review, with both Arabic/RTL and English/LTR coverage where appropriate. Never use simulated UI images or screenshots containing actual customer information.

The existing [repo hygiene regression test](../../../../scripts/__tests__/repository-hygiene.test.ts) checks that committed active screenshots are PNG files and **no two have identical bytes**. It does not replace real visual, accessibility, or route verification.

## Evidence coverage limits

The eleven remaining captures show selected historical dashboard, posts, members, settings, desktop/mobile, and RTL states, not every admin screen or viewport. See the [design system document](../../VIBRESS_ADMIN_DESIGN_SYSTEM.md) for the broader verification requirements.
