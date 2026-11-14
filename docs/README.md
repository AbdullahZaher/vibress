# Vibress Architecture Documentation

Vibress is a modern publishing, membership, newsletter, analytics, and extensibility platform inspired by the architectural strengths of Ghost while avoiding legacy coupling.

The system is designed as a **TypeScript modular monolith** with strong domain boundaries, a separate editor product called **Vibress Studio**, and a plugin ecosystem for storage, integrations, editor extensions, analytics, and payments.

## Historical records and repository maintenance

- [September 2026 implementation and release evidence](archive/2026-09/README.md) — preserved for traceability, **not** current production certification.
- [Media storage inventory: historical summary](audits/media-storage-2026-09-19-summary.md) — aggregate evidence only; not an instruction to remove stored media.
- [Repository hygiene and preservation policy](maintenance/repository-hygiene.md) — tracked artifacts, theme distribution, upgrade and testing rules.

## Canonical publication language policy (accepted; implementation pending)

- **Authoritative product/architecture decision:** [Single language by default; publication-scoped localization](14-decisions/publication-language-policy.md).
- **Engineering rollout:** [Localization Policy Implementation Plan](development/LOCALIZATION_POLICY_IMPLEMENTATION_PLAN.md) (T1–T6, compatibility and release gates).
- **Owner documentation:** [Language Configuration Guide](administration/LANGUAGE_CONFIGURATION_GUIDE.md) · [الدليل العربي لإعداد اللغات](administration/LANGUAGE_CONFIGURATION_GUIDE.ar.md).
- **Translation workflow:** [Staff Handbook](administration/TRANSLATION_WORKFLOW_GUIDE.md).

This policy is **adopted as the target contract**, not yet implemented or certified. Historical localization reports retain their original results and must not be interpreted as verification of the new single-language-by-default behavior.

## Social media links and theme documentation

- [Publication social links — owner guide](administration/SOCIAL_LINKS_GUIDE.md) · [دليل الإدارة بالعربية](administration/SOCIAL_LINKS_GUIDE.ar.md).
- [Liquid theme developer guide](themes/developer-guide.md) · [Templating reference](themes/templating.md) · [Public site API](10-api/themes-api.md).
- Default, Minimal and Molten render the social icons in their footers. Custom themes choose where to place them.

## Vibress Studio 9+ delivery and host release gates

- [Full cross-repository Studio 9+ roadmap (English)](https://github.com/AbdullahZaher/vibress-studio/blob/main/docs/roadmaps/world-class-editor-9-plus-plan-2026-11-06.md) — proposed execution phases, engineering/product scorecard and G0–G9 acceptance criteria.
- [Host-specific Studio 9+ acceptance plan](09-studio/editor-9-plus-host-acceptance.md) — coordinated Yjs restore, crash/offline recovery, publish parity, package and staging rollback responsibilities.

Both are **proposed plans**, not release certification. Use evidence on the exact candidate SHAs and authorized approvals before claiming 9+ or deploying.

## Core principles

1. **Modular monolith first**
   - Keep deployment simple.
   - Keep domain boundaries strict.
   - Extract services only when scale or isolation requires it.

2. **Domain-oriented architecture**
   - Business logic lives inside domain packages.
   - HTTP controllers, database code, UI code, and workers must not own domain rules.

3. **Vibress Studio is independent**
   - The editor is a separate repository/package family.
   - Vibress consumes it as a dependency.
   - Studio must not depend on Vibress Core.

4. **Provider-independent infrastructure**
   - Storage, cache, queues, email, and integrations use interfaces and adapters.
   - S3-compatible storage supports AWS S3, Cloudflare R2, Wasabi, Backblaze B2, DigitalOcean Spaces, Hetzner Object Storage, MinIO, and compatible custom providers.

5. **Extensibility by contract**
   - Plugins integrate through a controlled SDK.
   - Plugins must not reach directly into internal implementation details.

6. **Security by default**
   - Least privilege.
   - Encrypted external credentials.
   - CSRF, SSRF, XSS, upload, rate-limit, and session protections are first-class platform concerns.

## Repositories

```text
vibress-ecosystem/
├── vibress/             # Main CMS/platform
├── vibress-studio/      # Independent editor product
├── vibress-plugins/     # Official plugins/providers
├── vibress-sdk/         # Developer/client SDKs
└── vibress-docs/        # Product and developer documentation
```

## Recommended stack

| Layer          | Technology                       |
| -------------- | -------------------------------- |
| Language       | TypeScript                       |
| Monorepo       | pnpm + Nx                        |
| Admin          | React + Vite                     |
| Public Web     | Next.js                          |
| Portal         | React                            |
| API            | Fastify                          |
| Validation     | Zod                              |
| Database       | PostgreSQL                       |
| ORM            | Drizzle                          |
| Cache          | Redis                            |
| Queue          | BullMQ                           |
| Editor         | Lexical via Vibress Studio       |
| UI             | Tailwind CSS + shadcn/ui         |
| Object Storage | S3-compatible + provider plugins |
| Tests          | Vitest                           |
| E2E            | Playwright                       |
| Logging        | Pino                             |
| Tracing        | OpenTelemetry                    |
| Errors         | Sentry                           |
| Containers     | Docker                           |
| CI/CD          | GitHub Actions                   |

## Documentation map

- `01-architecture/` — system architecture and dependency rules
- `02-apps/` — runtime applications
- `03-domains/` — business domains and boundaries
- `04-data/` — PostgreSQL, Drizzle, migrations, transactions
- `05-platform/` — events, queues, cache, observability, config
- `06-security/` — authentication, authorization, secrets, SSRF, uploads
- `07-storage/` — provider abstraction, S3 compatibility, direct uploads
- `08-plugins/` — plugin lifecycle, SDK, permissions, extension points
- `09-studio/` — Vibress Studio architecture and integration
- `10-api/` — API conventions and contracts
- `11-testing/` — test strategy
- `12-infrastructure/` — development and production deployment
- `13-roadmap/` — recommended implementation phases

This documentation defines **Architecture v1** for Vibress.

## Universal Application Platform — proposed master roadmap (2026-11-14)

**Security/architecture review:** [2026-11-14 PR #151 findings and revised English program gates](platform-roadmap/REVIEW-FINDINGS-2026-11-14.md) · [Architecture decisions](platform-roadmap/ARCHITECTURE-DECISION-GATES.md) · [RLS and migration authority](platform-roadmap/DATA-ISOLATION-AND-MIGRATIONS.md) · [v1 release cut](platform-roadmap/V1-SCOPE-AND-RELEASE-CRITERIA.md). The English plan is currently authoritative; the older Arabic summary remains informational until translated and reconciled.

The new [Vibress Universal Application Platform master roadmap](platform-roadmap/README.md) proposes **five waves and 13 master milestones (M00–M12)** to evolve Vibress beyond publishing into a general, self-hostable application development platform. See the [Arabic overview](platform-roadmap/README.ar.md), [architecture](platform-roadmap/PLATFORM-ARCHITECTURE.md), [security/release gates](platform-roadmap/SECURITY-AND-RELEASE-GATES.md), [existing-asset traceability](platform-roadmap/EXISTING-ASSETS.md), and [GitHub tracking issues](platform-roadmap/MILESTONE-TRACKER.md).

**Status: proposal on Draft PR #151; not an implementation or release certification.** This program does not supersede the existing Plugin Platform v3 M0–M6 implementation evidence or the current Studio/source security reports.
