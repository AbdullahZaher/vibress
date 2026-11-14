# Golden Applications and Comparative Benchmark Program

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

## Golden Application acceptance tiers

**Mandatory for v1 GA:** (A) *existing Vibress CMS* compatibility and (B) *external CRM* generated from new universal contracts. The latter must be a clean install with PostgreSQL tenant security, users/roles, customers/deals/activities, REST/OpenAPI, generated Admin and stable module path. Both must pass immutable source/DB fixture tests.

**Progressive post-v1 / capability-specific tracks:** Real Estate, Booking and Commerce are reference designs and tests, but **not three complete products required to block first v1 GA**, unless individual capabilities (files, scheduling, ecommerce) are claimed as v1-supported. A focused booking/inventory fault-injection example can validate M06 minimum workflow without claiming an entire shipped booking platform.

## Five reference consumers (two v1 mandatory; three expansion tracks)

| Golden application | Business coverage | Non-negotiable proof |
| --- | --- | --- |
| Vibress CMS | posts/pages/publications, media, members/plans, themes, newsletters, Studio | zero unintended backward-compatibility loss |
| CRM | customers, deals, activities, staff, organizations, policy scopes and dashboard | no publication import, generated CRUD, safe RLS |
| Real Estate | properties, listing moderation, photos, filters, Arabic/RTL | scoped files and search, relations and workflows |
| Booking | slots/reservations, state transitions, cancellation, notifications | transactions/concurrency, retries and fault recovery |
| Commerce | products, orders, inventory, payments/subscriptions | webhook idempotency, entitlements, audit and recovery |

Build new consumers *outside* the platform kernel through published SDK/templates; any internal edit required to implement a domain is a platform design defect to track explicitly.

## Competitor benchmarks and fair comparison

- **Payload:** time to define a resource + generate secure API/admin SDK and customize forms.
- **WordPress:** plugin lifecycle compatibility, upgrades, rollback and editor journey.
- **Wix:** app/page/forms workflow from visual editing to preview/publish; note proprietary managed constraints.
- **Ghost:** editorial content quality, membership flows, writing/recovery; note publishing-focused scope.
- **Directus/Appsmith/Budibase-class tools:** time to build backoffice forms, tables, actions, data binding and deploy.

Metrics: setup time from clean checkout, scaffolding LOC/touches, authorization/isolation tests, upgrade survival, external package install, developer task success, operator restore times, p50/p95/p99 on disclosed infrastructure, mobile/RTL/a11y and AI task completion with manual correction cost. Never claim universal superiority based on star count or unaligned scenarios.

## Benchmark test cases and success thresholds

M00 must register baseline hardware/seed fixtures, supported database/runtime/SDK versions and preagreed performance/security/DX budgets. Report **median and p95** onboarding and action timing, CI/recovery failure rates, cross-tenant denied attempts, number of manual steps, module compatibility across supported versions and kernel edits required (target zero for new app domains). No arbitrary superiority ranking until all comparator tasks and limitations are disclosed. Missing capability is recorded as **not supported**, not silently removed from the benchmark.

## Evidence protocol

Pin versions/SHAs, hardware, PG version, seeded dataset and scripted tasks; run clean setup; publish raw artifacts and scripts; capture failures; explain unmatched features. Repeat after platform releases and security patches; independent reviewer signs the comparison.
