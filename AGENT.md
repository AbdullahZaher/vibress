# AGENT.md — Vibress Global Platform AI Engineering Agent

These instructions are mandatory for every AI engineering task in the Vibress ecosystem.

Vibress is a production-grade, self-hostable publishing platform and CMS. Treat it as a long-lived global platform in the same product category as mature systems such as WordPress, Ghost, and Drupal — not as a small application, prototype, internal dashboard, or disposable codebase.

The governing principle is:

> Build Vibress as a stable, extensible, secure, globally usable publishing platform while making the smallest correct change required by the current task.

Correctness, security, data integrity, backward compatibility, upgrade safety, architecture boundaries, extensibility, internationalization, accessibility, operational reliability, and regression safety take priority over speed.

---

# 1. Mandatory Role-Based Engineering Review

Before coding any non-trivial task, perform a short Role-Based Engineering Review.

Do not immediately begin editing code.

Select only the roles relevant to the task. Typical roles include:

- Platform Architect
- Domain Architect
- Security Reviewer
- Database Engineer
- API Designer
- Backend Implementer
- Frontend Engineer
- UX / Accessibility Reviewer
- Internationalization / RTL Reviewer
- Plugin / Extension Architect
- Theme Compatibility Reviewer
- Performance Engineer
- Reliability / Operations Engineer
- Migration / Upgrade Reviewer
- QA Engineer
- Test Automation Engineer
- Documentation / Developer Experience Reviewer

Do not mechanically use every role. Choose the smallest useful set.

Typical minimums:

- Normal feature: Platform Architect, Implementer, Security Reviewer when relevant, QA Engineer.
- Database work: Domain Architect, Database Engineer, Migration / Upgrade Reviewer, Security Reviewer when relevant, QA Engineer.
- Admin/public UI: Frontend Engineer, UX / Accessibility Reviewer, Internationalization / RTL Reviewer, Security Reviewer when relevant, QA Engineer.
- Plugin work: Platform Architect, Plugin / Extension Architect, Compatibility Reviewer, Security Reviewer, QA Engineer.
- Theme/rendering work: Platform Architect, Theme Compatibility Reviewer, Internationalization / RTL Reviewer, QA Engineer.

Each role must provide one short, concrete perspective about a design constraint, risk, compatibility concern, or verification requirement.

Then synthesize the perspectives into one implementation plan.

Required pre-implementation shape:

Role Review

Platform Architect:
Short architecture perspective.

Security Reviewer:
Short security perspective.

QA Engineer:
Short validation perspective.

Implementer:
Short implementation perspective.

Synthesized Plan

1. Relevant inspection.
2. Smallest architecture-compatible change.
3. Focused tests.
4. Relevant compatibility/security/migration checks.
5. Final validation.

Only after this review should implementation begin.

Do not produce fictional debates or theatrical personas. Do not expose private chain-of-thought. The purpose is structured engineering review.

---

# 2. Global Platform Mindset

Assume third parties and real production installations depend on Vibress.

Every meaningful engineering decision should consider the relevant impact on:

- publishers and editors;
- authors;
- members and subscribers;
- site administrators;
- self-hosters;
- agencies;
- enterprise operators;
- plugin developers;
- theme developers;
- API consumers;
- third-party integrations;
- multilingual publications;
- RTL publications;
- installations upgrading from older Vibress versions;
- installations operating at scale.

For substantial changes, evaluate only the platform concerns that are relevant:

- backward compatibility;
- database upgrades;
- public APIs;
- themes;
- plugins;
- stored content;
- multilingual content;
- RTL;
- accessibility;
- security;
- SEO;
- performance;
- caching;
- background jobs;
- webhooks;
- search;
- billing;
- members;
- import/export;
- backup/restore;
- observability;
- self-hosting;
- horizontal scaling;
- documentation.

Do not mechanically discuss all of them. Identify the relevant ones.

---

# 3. Platform Stability and Data Durability

Existing Vibress installations may contain years of:

- posts;
- pages;
- media;
- users;
- members;
- subscriptions;
- billing information;
- themes;
- plugins;
- translations;
- configuration;
- custom content models;
- integrations;
- analytics;
- revisions.

Treat customer data and published content as durable.

Never assume a fresh installation.

Never implement a feature that requires valid existing data to be discarded or manually rebuilt unless the product requirement explicitly demands it.

Published URLs, serialized content, plugin contracts, theme contracts, and public APIs are platform assets.

---

# 4. Backward Compatibility

Backward compatibility is a first-class requirement.

Before changing an established contract, determine whether it is consumed by:

- another workspace package;
- public web;
- admin;
- member portal;
- worker;
- themes;
- plugins;
- API clients;
- webhooks;
- stored serialized content;
- tests.

Prefer additive evolution.

Prefer a new optional field, endpoint, capability, schema version, adapter, migration, or compatible default over silently redefining existing behavior.

Breaking changes require an explicit reason and compatibility/migration analysis.

Do not create breaking changes accidentally.

---

# 5. Upgradeability

Always ask both:

- Does this work on a new installation?
- Does this work when upgrading an existing installation?

Database migrations must consider existing rows.

Configuration changes must consider existing deployments and environment files.

New required settings should have a safe migration/default strategy where appropriate.

Stored content should remain readable across upgrades.

Theme and plugin contracts must not change casually.

Upgrade safety is part of correctness.

---

# 6. Extensibility and Ecosystem Rules

Vibress is an ecosystem platform.

Stable extension surfaces include:

- plugin SDKs;
- public contracts;
- capability permissions;
- events and hooks;
- webhooks;
- theme contracts;
- Studio extension points;
- versioned APIs.

Plugins must depend on supported SDK/public interfaces.

Do not encourage plugins to:

- deep-import domain internals;
- access database tables directly;
- bypass capability permissions;
- assume filesystem layout;
- depend on undocumented globals.

Theme-facing changes must consider template contracts, Liquid rendering, theme variables, assets, publication data, members, localization, RTL, and SEO.

Do not expose implementation internals merely to make an extension compile.

At the same time, do not create speculative extension frameworks. YAGNI still applies.

---

# 7. Content Compatibility

Published content is one of Vibress's most valuable assets.

Take special care with:

- Studio document formats;
- card and node serialization;
- Markdown;
- HTML;
- media references;
- revisions;
- translations;
- content-model values.

Never casually change persisted document structure.

When persisted schemas evolve, provide a compatibility or migration strategy.

Old valid published content should continue to load and render wherever reasonably possible.

For Studio changes, trace the full lifecycle:

creation -> editing -> serialization -> persistence -> loading -> rendering

---

# 8. International Product Requirements

Vibress is a global publishing platform.

English-only assumptions are defects.

Relevant product work must consider:

- Unicode;
- Arabic;
- RTL;
- mixed LTR/RTL content;
- locale-aware formatting;
- dates and time zones;
- pluralization;
- translated UI strings;
- long translations;
- non-Latin text and names;
- multilingual search behavior where applicable.

Arabic and RTL are core product capabilities, not optional enhancements.

Do not hard-code English UI strings when the subsystem uses i18n.

Avoid sentence construction that prevents translators from changing word order.

For relevant UI changes, verify both LTR and RTL behavior.

---

# 9. Accessibility

User-facing changes should preserve or improve:

- semantic HTML;
- keyboard operation;
- focus visibility and focus order;
- labels and accessible names;
- screen-reader semantics;
- form validation feedback;
- interaction feedback.

Do not create mouse-only workflows.

Accessibility regressions are functional regressions.

---

# 10. SEO and Publishing Semantics

Public publishing changes may affect:

- canonical URLs;
- metadata;
- structured data;
- redirects;
- sitemap behavior;
- robots behavior;
- social metadata;
- multilingual URL behavior.

Do not unintentionally change public URLs or indexing semantics.

Publishing URLs are long-lived contracts.

---

# 11. Repository and Runtime Context

Vibress is a TypeScript pnpm/Nx monorepo.

Required environment:

- Node.js >=24 <25
- pnpm >=11.17
- repository pnpm version 11.22.0
- TypeScript strict mode
- PostgreSQL
- Redis
- Docker / Docker Compose where infrastructure is required

Primary applications:

- apps/api — Fastify REST APIs, authentication, authorization, publication context, WebSocket/collaboration, transport orchestration.
- apps/worker — BullMQ jobs, transactional outbox delivery, email, indexing, automations, durable async processing.
- apps/web — Next.js SSR public publishing application.
- apps/admin — Vite + React administrative application and publishing Studio.
- apps/portal — Vite + React member/subscriber portal.

Business capabilities live primarily under packages/domains/*.

Shared platform packages include packages/api-contracts, packages/database, packages/security, packages/config, packages/cache, packages/events, packages/queue, packages/observability, packages/i18n, storage packages, plugin packages, theme packages, and Studio packages.

---

# 12. Canonical Architecture Boundaries

Preserve these boundaries unless the task explicitly requires an architectural change:

- business rules -> packages/domains/*
- HTTP concerns -> apps/api
- background execution -> apps/worker
- database infrastructure -> packages/database
- security primitives -> packages/security
- transport schemas/contracts -> packages/api-contracts
- storage implementation -> storage packages
- UI -> APIs and public contracts
- plugins -> SDK/public contracts only
- themes -> documented theme contracts
- Studio -> Studio contracts, not arbitrary Core internals

UI applications must not directly access the database.

Fastify routes should orchestrate domain services rather than become the business layer.

Avoid cross-domain deep imports.

Prefer public package exports.

Keep public package APIs intentionally small.

Media should depend on storage abstractions rather than provider-specific internals.

---

# 13. Sources of Truth

Use this precedence:

1. explicit user requirements;
2. security and data-integrity requirements;
3. established public compatibility guarantees;
4. current architecture;
5. repository documentation and AGENT.md;
6. representative existing implementations;
7. tests that describe intentional behavior.

If implementation, documentation, and tests disagree, investigate before changing behavior.

Do not choose whichever interpretation is easiest to implement.

---

# 14. Security Is Non-Negotiable

Never weaken security to complete a task or make tests pass.

Administrative routes must preserve established mechanisms such as:

- requireStaffSession;
- requirePermission(...);
- publication/workspace context resolution;
- validateOrigin for cookie-authenticated state-changing requests where applicable.

Never trust raw caller-supplied tenant/workspace IDs.

Publication/workspace identity must come from authoritative authenticated context.

Every publication-owned data path must preserve tenant isolation.

An object ID alone is never sufficient authorization.

Security-sensitive areas include:

- authentication;
- authorization;
- sessions;
- roles and permissions;
- publication/workspace isolation;
- setup/bootstrap;
- billing and Stripe;
- webhooks;
- uploads and media;
- HTML and user content;
- plugins;
- themes;
- import/export;
- redirects;
- secrets and encryption;
- collaboration;
- destructive actions.

For these tasks, Security Reviewer should normally participate in the initial Role Review.

---

# 15. Input Validation and API Contracts

Validate all untrusted external input at runtime.

Prefer canonical schemas from @vibress/api-contracts or the owning domain's established validation mechanism.

Validate, as relevant:

- request body;
- query;
- params;
- headers;
- webhook payloads;
- uploaded files;
- external-provider responses.

Do not rely on TypeScript types as runtime validation.

Keep admin, public, member, and machine/integration APIs distinct.

Preserve established route versioning.

Prefer additive API evolution.

Keep response and error shapes stable.

Preserve request IDs where established.

Do not leak stack traces, credentials, database details, tokens, or internal secrets to clients.

---

# 16. Database and Migration Safety

Database changes affect real installations.

For schema work:

1. update the canonical Drizzle schema;
2. generate a new migration;
3. inspect generated SQL;
4. verify existing-data behavior;
5. verify constraints and indexes;
6. apply the migration;
7. test the affected behavior.

Do not rewrite previously released migrations.

Prefer additive, zero-downtime-safe changes.

Avoid destructive drops or irreversible transformations without an explicit migration strategy.

For migrations involving existing data, review:

- NULL/non-NULL rows;
- default values;
- large-table behavior;
- locking;
- index creation;
- backfill strategy;
- roll-forward compatibility;
- rollback consequences;
- application compatibility during deployment.

A migration passing only on an empty development database is insufficient evidence.

Do not repeatedly reset, drop, or reseed the entire database during normal feature work.

---

# 17. TypeScript Standards

The project uses strict TypeScript, including:

- strict;
- noUncheckedIndexedAccess;
- exactOptionalPropertyTypes.

Write code that satisfies these guarantees.

Do not casually add explicit any.

Do not use @ts-ignore, unsafe casts, or lint-disable directives as shortcuts.

The repository's explicit-any regression guard must not regress.

Use existing project utilities and types before inventing duplicates.

Follow nearby code style.

---

# 18. Frontend Engineering

Keep business logic out of UI components.

Use established API, router, query, and state patterns in the owning app.

Relevant flows should handle:

- loading;
- success;
- empty state;
- validation errors;
- permission errors;
- server errors;
- retry/recovery where appropriate.

Do not assume wide desktop, English text, LTR, mouse input, or perfect network conditions.

For public/admin UI changes, UX / Accessibility Reviewer should normally participate.

For localized content/UI changes, Internationalization / RTL Reviewer must participate.

---

# 19. Background Work and Reliability

Durable asynchronous work belongs in established worker, queue, and event infrastructure.

Do not put important long-running work in request handlers when it belongs in the worker.

Preserve transactional outbox/event-delivery patterns where applicable.

Consider:

- retries;
- duplicate delivery;
- idempotency;
- partial failure;
- delayed workers;
- process death mid-operation;
- Redis/PostgreSQL/provider outages.

For queues/events/workers, Reliability / Operations Engineer should normally participate.

---

# 20. External Integrations

Assume external APIs can:

- time out;
- rate-limit;
- return malformed/partial data;
- duplicate webhook deliveries;
- deliver events out of order;
- become temporarily unavailable.

Build integrations defensively.

Verify/authenticate webhook payloads.

Use idempotency where appropriate.

Optional integrations must not destabilize unrelated core functionality.

---

# 21. Self-Hosting and Configuration

Self-hosting is a core Vibress use case.

Changes should remain compatible with:

- Docker deployments;
- reverse proxies;
- TLS termination;
- persistent volumes;
- PostgreSQL;
- Redis;
- backups and restores;
- health checks;
- supported scaling patterns.

Do not introduce hidden dependencies on proprietary hosted infrastructure.

Environment variables are operator-facing contracts.

Before adding or changing configuration:

- reuse existing settings where possible;
- validate through established config infrastructure;
- document behavior;
- provide safe defaults where appropriate;
- avoid unnecessary upgrade failures.

Security-critical production configuration should fail safely, not silently weaken protections.

---

# 22. Performance and Caching

Do not prematurely optimize, but consider obvious scale risks in hot paths such as:

- public page requests;
- post/page listings;
- search;
- analytics ingestion;
- newsletter delivery;
- worker fan-out;
- large publication tables.

Watch for:

- N+1 queries;
- unbounded queries;
- full-table scans;
- serial network calls;
- large in-memory materialization;
- unbounded queues.

Caching must preserve correctness.

Cache keys and invalidation must consider relevant dimensions such as:

- publication/tenant;
- permissions;
- member access level;
- locale;
- content version.

A cache leak between publications or access levels is a security bug.

---

# 23. Search and Event Consistency

When changing searchable content, consider:

- index updates;
- deletions;
- publication isolation;
- locale/text behavior;
- worker delivery;
- event consistency.

Do not update primary content while permanently leaving search state stale.

Use established event/outbox mechanisms.

---

# 24. Billing

Billing changes require additional caution.

Consider:

- Stripe retries;
- webhook idempotency;
- subscription state;
- plan changes;
- currency;
- member access;
- duplicate/out-of-order events;
- payment failure;
- cancellation.

Never infer successful payment from client-side state alone.

Provider-authenticated server-side state is authoritative.

Security Reviewer and QA Engineer are mandatory for billing changes.

---

# 25. Observability and Error Handling

Use established logging, metrics, tracing, health-check, and request-ID patterns.

Operational logs should materially help production diagnosis.

Do not log secrets or sensitive content unnecessarily.

Remove temporary console.log, forensic logs, debug endpoints, bypasses, and temporary instrumentation before completion unless explicitly requested.

Reuse existing Vibress error structures and codes.

Do not create a new error framework for each domain.

---

# 26. Start Narrowly

At task start:

1. inspect git status --short;
2. identify the owning subsystem;
3. perform the mandatory Role-Based Engineering Review;
4. use targeted search;
5. inspect the owning package and one representative analogous implementation;
6. inspect direct dependencies, consumers, tests, and relevant docs only;
7. synthesize one short implementation plan.

Do not scan the entire repository for a localized task.

Search before opening many files.

Do not dump huge files unnecessarily.

Do not repeatedly reread unchanged files.

Exclude generated directories such as node_modules, dist, build, .next, coverage, test-results, playwright-report, and .git unless directly investigating generated output.

---

# 27. Scope Discipline

Make the smallest correct platform-compatible change.

Do not perform unrelated:

- refactoring;
- renaming;
- dependency modernization;
- formatting;
- architecture cleanup;
- lint cleanup;
- directory restructuring.

Do not fix unrelated technical debt unless it blocks the requested work or the adjacent fix is trivial and clearly safe.

Global-platform quality does not mean changing everything. It means making the requested change compatible with the larger platform.

YAGNI is mandatory.

Do not add speculative abstractions, settings, variants, or extension points.

Avoid cascading renames.

Preserve stable interfaces.

---

# 28. Dependency Policy

Before adding a dependency:

1. check existing Vibress packages;
2. check existing dependencies;
3. check stable Node/platform APIs;
4. add a package only when it materially improves correctness, security, or maintainability.

Never run broad dependency upgrades during unrelated work.

Do not reimplement cryptography, password hashing, MIME parsing, HTML sanitization, or similar complex security primitives merely to avoid a dependency.

---

# 29. Protect Existing User Work

Inspect Git status at the beginning and end.

Separate:

- pre-existing user changes;
- agent changes;
- generated artifacts.

Never overwrite, reset, or delete unrelated user work.

Do not push, force-push, merge, open pull requests, rewrite history, or publish releases unless explicitly requested.

Implementation permission does not imply publication permission.

Use Conventional Commits if a commit is explicitly requested.

---

# 30. Testing Strategy

Use progressive validation:

Level 1 — directly affected unit test.

Level 2 — owning package/domain tests.

Level 3 — affected API/integration tests.

Level 4 — relevant E2E scenario.

Level 5 — repository-wide final gate.

Do not run the entire test suite after every edit.

During the Role Review, QA should identify the relevant behavioral matrix, such as:

- happy path;
- malformed input;
- unauthenticated access;
- permission failure;
- wrong publication/workspace;
- not found;
- conflict;
- duplicate/retry;
- provider failure;
- migration compatibility;
- RTL/localization;
- accessibility.

Only include cases relevant to the task.

Relevant security tests are mandatory for authentication, authorization, tenant isolation, uploads, HTML, plugins, billing, webhooks, setup, and destructive operations.

---

# 31. Failure Diagnosis

When a test fails:

1. read the exact failure;
2. identify the responsible layer;
3. inspect targeted code;
4. make one reasoned correction;
5. rerun the narrow failing test.

Do not make random edits until tests become green.

If the same command fails twice for the same reason, investigate instead of repeating it.

Do not skip tests, weaken assertions, disable authorization, remove validation, increase global limits, or change expected behavior merely to hide a failure.

Change tests only when the intended requirement changed or the test is demonstrably obsolete/incorrect.

---

# 32. Infrastructure Discipline

Reuse healthy PostgreSQL, Redis, API, and other infrastructure where safe.

Do not restart every service for a local change affecting one component.

Do not repeatedly reinstall dependencies when package metadata has not changed.

Do not leave duplicate development servers or temporary watchers running.

Stop processes started solely for temporary verification.

Use Nx/pnpm/test caches where safe.

Do not disable caching without a reason.

---

# 33. Final Validation

Before completion, review the scoped diff once.

Look for:

- unintended files;
- secrets;
- debug code;
- generated artifacts;
- unrelated formatting;
- unsafe casts;
- missing tenant scoping;
- migration hazards;
- breaking contracts;
- plugin/theme compatibility issues;
- RTL/i18n regressions;
- accessibility regressions;
- architecture violations.

For substantial changes, final project gates normally include:

    pnpm install --frozen-lockfile
    pnpm audit --prod --audit-level high
    pnpm typecheck
    pnpm lint
    pnpm verify:explicit-any
    pnpm vitest run
    pnpm build
    pnpm verify:clean-tree

Run dependency installation only when appropriate.

Do not repeatedly rerun successful expensive gates.

Release validation may additionally include container vulnerability scanning, Playwright E2E, production smoke tests, and migration verification.

---

# 34. Known Repository Technical Debt

Do not independently expand normal tasks to solve unrelated known technical debt, including:

- Nx + Next.js orchestration issues;
- Studio local package-linking issues;
- unrelated existing lint warnings;
- tolerated existing explicit-any debt.

If relevant, report it. Do not create more debt merely because some already exists.

---

# 35. Documentation and Developer Experience

Update relevant documentation when a change affects:

- public APIs;
- configuration;
- deployment;
- plugin SDK;
- theme APIs;
- migration behavior;
- operator procedures;
- user-visible workflows.

Do not rewrite unrelated docs.

Public developer APIs should be understandable without reading Vibress internals.

For platform-facing APIs and extension contracts, consider:

- discoverability;
- stable naming;
- types;
- errors;
- versioning;
- documentation;
- examples.

---

# 36. Global CMS Decision Questions

For substantial changes, internally evaluate the relevant questions:

- Will existing installations continue working?
- Will existing stored content continue loading?
- Will existing themes continue rendering?
- Will plugins remain compatible?
- Can this migrate safely?
- Is publication isolation preserved?
- Does it work for Arabic and RTL?
- Is the user-facing experience accessible?
- Does it scale beyond a tiny development dataset?
- Can self-hosters operate it?
- Can operators diagnose failures?
- Is the public contract stable?
- Can the system recover from partial failure?

Do not mechanically answer all of these in the final report. Use them to guide implementation.

---

# 37. Role Escalation Rules

Some changes require specific roles in the initial review:

Database schema:
- Database Engineer
- Migration / Upgrade Reviewer

Auth, security, sessions, billing:
- Security Reviewer

Public/admin UI:
- UX / Accessibility Reviewer

Localized UI or content presentation:
- Internationalization / RTL Reviewer

Plugin SDK or capabilities:
- Plugin / Extension Architect
- Compatibility Reviewer

Theme/rendering contracts:
- Theme Compatibility Reviewer

Queues/events/workers:
- Reliability / Operations Engineer

The roles may identify competing concerns. Synthesize them into one implementation strategy before coding.

Example synthesis:

Architect wants the capability in the media domain.
Security requires publication-scoped access.
Compatibility requires the existing MediaAsset contract to remain stable.
QA requires a cross-publication negative test.

Therefore:
extend the media service additively, reuse the existing asset type, scope lookup by publication, and add API plus isolation tests.

---

# 38. Autonomous Engineering

Do not ask the user to choose between ordinary implementation details that can be resolved through repository conventions.

Make reasonable decisions autonomously.

Escalate only when a choice materially affects:

- product semantics;
- architecture;
- security posture;
- irreversible data migration;
- public API compatibility;
- billing/cost;
- destructive operations;
- major ecosystem compatibility.

When ambiguity is minor, choose the solution that best preserves current architecture and compatibility.

---

# 39. Completion Standard

A task is complete only when the relevant conditions are satisfied:

- requested behavior implemented;
- architecture preserved;
- security correct;
- tenant/publication isolation correct;
- runtime validation correct;
- migration safe where applicable;
- backward compatibility considered;
- plugin/theme compatibility considered where applicable;
- RTL/localization considered where applicable;
- accessibility considered where applicable;
- failure behavior covered;
- focused tests pass;
- appropriate broader gates pass;
- documentation updated where required;
- temporary/debug code removed;
- final diff reviewed;
- no unrelated user work changed.

Do not declare success based only on compilation.

---

# 40. Final Report

After implementation, report concisely:

Status

Role Review Result
- only material final conclusions from the selected roles

Changed

Validation
- commands/tests actually executed and results

Platform Compatibility
- API compatibility
- migration/upgrade implications
- plugin/theme implications when relevant
- i18n/RTL/accessibility implications when relevant

Security / Architecture

Remaining Issues
- only genuine blockers, limitations, or newly introduced technical debt

Do not narrate every command.

Never claim a test passed if it was not executed.

Never claim compatibility was verified if it was only assumed.

---

# 41. Core Platform Principle

Develop Vibress as though third parties depend on every stable behavior.

Assume:

- someone has built a theme against this behavior;
- someone has built a plugin against this contract;
- someone has automated this API;
- someone has years of posts in this database;
- someone publishes primarily in Arabic;
- someone runs Vibress behind their own infrastructure;
- someone depends on upgrades being safe;
- someone operates a high-traffic publication;
- someone pays real money through the membership system.

Engineering decisions must respect those users.

---

# 42. Default Vibress Workflow

For each non-trivial task:

1. Inspect git status.
2. Identify the owning subsystem.
3. Perform the mandatory Role-Based Engineering Review.
4. Give one short perspective from each relevant role.
5. Synthesize those perspectives into one implementation plan.
6. Search for the relevant implementation and one representative pattern.
7. Inspect direct dependencies, consumers, tests, and relevant docs.
8. Implement the smallest platform-compatible change.
9. Run focused tests.
10. Run relevant security, migration, RTL, accessibility, compatibility, or integration validation based on the selected roles.
11. Review the scoped diff.
12. Run appropriate final project gates once.
13. Report implementation status and platform-level consequences concisely.

The default operating formula is:

Role-based review
+
smallest correct implementation
+
global-platform compatibility
+
focused validation
+
final verification
=
Vibress engineering

---

# 43. Final Decision Rule

Before any meaningful action ask:

> Does this materially help understand, implement, secure, migrate, or verify the requested change?

If no, do not do it.

Before changing a shared contract ask:

> Can this remain backward-compatible and additive?

Prefer yes.

Before introducing a new abstraction ask:

> Is there a real platform boundary or current extension requirement?

If no, do not add it.

Before a database change ask:

> What happens to an existing production installation during upgrade?

If unclear, investigate before proceeding.

Before a user-facing change ask:

> Does it remain usable with translated strings, Arabic/RTL, keyboard navigation, and supported responsive layouts?

If relevant and unverified, the task is not finished.

Before finishing ask:

> Would this change be acceptable in a globally deployed CMS ecosystem with third-party themes, plugins, integrations, years of stored content, paying members, self-hosted installations, and real production traffic?

If not, continue working.
