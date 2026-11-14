# Delivery Governance, GitHub Organization and Definition of Done

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

## Hierarchy

Wave → master milestone (`M00`–`M12`) → epic (`M03-E02`) → engineering Issue → PR → immutable CI/evidence → owner sign-off. Existing plugin milestone `M0–M6` IDs remain unchanged. The 13 master milestone tracker Issues are **not** native GitHub Milestones unless separately created through supported permissions/tooling.

## Work item template

- **Problem / desired outcome**, acceptance criteria and explicit non-goals.
- **Existing code** and ADR references, public contract changes and expected dependencies.
- **Security model**: affected app/tenant/principal/permission and denied operations.
- **Data migration and versioning**: expand-contract, operator approval, rollback or forward-fix.
- **Tests and evidence**: unit, integration, real PG, security, E2E, accessibility, clean consumer, fault injections.
- **Operational impact**: feature flag, monitoring, logs, runbook and restoration.
- **Change record**: PR, immutable SHA, CI logs, reviewer and decision.

Naming: `[Platform M03][E02] Resource registry — canonical IR`. Suggested labels after checking existence: `area:kernel`, `area:tenancy`, `area:schema`, `area:plugins`, `area:builder`, `area:ai`, `priority:P0`, `type:security`.

## Definition of Ready

Scope and non-goals agreed; dependencies named; API/Schema ADR drafted; threat/tenant model clear; migration and compatibility plans specified; test fixtures and reviewers assigned.

## PR-level Definition of Done

- Build, strict typecheck, lint, unit, integration and required contracts pass at immutable SHA.
- Tenant/authorization negative tests for affected runtime surfaces; secrets/dependency/container scans as appropriate.
- Actual PostgreSQL migration and backfill tests for persistence changes; no edited released migrations.
- CMS/Studio compatibility fixtures and E2E where impacted; RTL/a11y tests for UI.
- No new forbidden imports; public SDK documented and semver decisions explained.
- Restore/rollback or forward-fix defined; accepted alerts/metrics and sign-off linked.

## Milestone closure

Every mandatory epic closed with direct evidence, immutable CI links, pinned DB/runtime fixtures, reviewer, accepted exceptions and explicit milestone decision. A checkbox is not evidence of production certification. Separate independent audit acceptance is compulsory for M08 GA.

## Working rules

Keep plan on a separate documentation branch and Draft PR until reviewed. Make small implementation PRs on focused branches; never rewrite old evidence ledgers or deploy automatically from roadmap merge. Do not invent calendars, budgets, teams, claimed quality scores or a completion percentage. Deliver runnable code-first application framework before building Wix-style editor or PaaS.
