# Changelog

All notable changes to the **Vibress** publishing platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-09-17

### Milestone Summary
Vibress v1.1.0 brings multi-publication tenant isolation (Migration 0026), dedicated workspace domain service, bundled trusted plugin registry, remote "What's New" notification subsystem, CRDT 64KB/rate-limited collaboration security controls, 740px Studio reading measure redesign, and full Playwright E2E browser verification.

### Added
- **Multi-Publication Tenant Isolation**: Added Migration `0026_multi_publication_tenant_isolation.sql` introducing `publication_id` scoping with foreign keys across all database tables (posts, pages, media, tags, themes, products, plans, billing, translations, automations, newsletters).
- **Workspace Domain Service (`@vibress/workspaces`)**: Introduced workspace management domain package with `DrizzleWorkspaceRepository`, `WorkspaceService`, and cross-tenant isolation enforcement.
- **In-App "What's New" Notification System**: Added remote notification subsystem (`@vibress/utils`, `@vibress/api-contracts`, `@vibress/api`) with semver-aware targeting and user dismiss tracking.
- **Bundled Trusted Plugin Registry**: Deprecated dynamic vm sandbox in favor of an explicit bundled plugin registry (`@vibress/plugin-core`) with prototype protection and capability-scoped access.
- **CRDT State Exchange Controls**: Implemented strict 64KB message cap, Base64 validation, and rate limiting for real-time collaborative editing sessions.

### Changed
- **Studio Editorial Workspace**: Redesigned canvas reading measure to 740px typography alignment, refined floating formatting toolbar, block handle gutter, and card action toolbars.
- **Studio Document Hydration**: Initialized Lexical editor state synchronously from parsed Studio JSON documents during `initialConfig` initialization prior to collaborative bootstrap.
- **Security Base Dependencies**: Upgraded container base packages and `smol-toml` to resolve Trivy security scan findings.

### Fixed
- **Multilingual E2E Database Seeds**: Added missing `publicationId` foreign key references to direct test seed inserts in `multilingual-browser-qa.test.ts`.
- **Post & Page Editor Hydration**: Corrected asynchronous loading lifecycle and component instance keying in `PostEditor.tsx` and `PageEditor.tsx` to prevent blank editor canvas on post reload.
- **Dynamic Site Locale Resolution**: Fixed content resolution in API to dynamically resolve site locale settings instead of hardcoding `en`.

### Infrastructure
- **Container Registry Pull Reliability**: Switched CI workflow to `quay.io/minio/minio` to eliminate Docker Hub unauthenticated pull rate limits.
- **Repository Cleanliness**: Hardened `.gitignore` and added automated clean-tree verification check (`scripts/verify-clean-tree.mjs`).

---

## [1.0.0] - 2026-09-13

### Milestone Summary
Official General Availability (v1.0.0) open-source release of the Vibress publication platform. Hardening across security, authorization, disaster recovery, multilingual RTL publishing, trigram search indexing, containerized deployment architecture, and open-source release automation.

### Added
- **Containerized Full-Stack Architecture**: Decoupled Fastify REST API backend, Next.js Server-Side Rendered (SSR) public web, and Vite + React Admin & Member Portal SPAs.
- **Collaborative Block Editor**: Studio block editor with real-time CRDT synchronization (Yjs), 7-stage editorial lifecycle, and all 13 canonical Studio cards (`Callout`, `Button`, `Bookmark`, `Gallery`, `Video`, `Audio`, `File`, `Divider`, `Product`, `Embed`, `Header`, `Markdown`, `HTML`).
- **Memberships & Subscriptions**: Member tiers, Stripe payment integration, gated premium posts, and transactional email newsletters.
- **Visual Automations Engine**: Event-driven automation workflows with visual builder in Admin, conditional execution branches, and execution inspector.
- **Content Modeler**: Visual Schema Builder supporting 18 canonical field types, dynamic collections, schema validation, and REST delivery.

### Security
- **Role-Based Access Control**: Centralized `@vibress/security` authorization guards enforcing role permissions across Owner, Admin, Editor, Author, and Contributor roles.
- **Ownership & Content Isolation**: Ownership checks ensuring Authors and Contributors can only edit and view their own unpublished posts and pages.
- **Tenant & Boundary Defense**: Gateway-level stripping of spoofable tenant headers (`x-publication-id`, `x-workspace-id`, `x-tenant-id`), isolating multi-publication data.
- **Staff Lifecycle Hardening**: Secure single-use hashed password reset tokens, token invalidation on use, and session revocation across active devices.
- **First-Run Setup Lock**: Fail-closed one-time setup wizard locked permanently once the primary Owner account is created (`OWNER_ALREADY_EXISTS`).
- **Webhook HMAC Verification**: Timing-safe signature verification for Stripe and email webhook endpoints.

### Publishing
- **Dynamic Routing & Liquid Themes**: Sandboxed Liquid template rendering engine supporting customizable themes, live previews, and SHA-256 package verification.
- **Syndication & Distribution**: Automatic generation of RSS 2.0, JSON Feed 1.1, `/sitemap.xml`, `/robots.txt`, `/llms.txt`, and ActivityPub federation endpoints.
- **Responsive Media Platform**: Automated multi-variant image generation (`300w`, `600w`, `1200w`, `1920w`) in WebP/AVIF formats with focal point cropping.

### Localization
- **Arabic-First Multilingual & RTL**: Built-in RTL layout detection, Umm al-Qura Hijri calendar formatting, Arabic text search normalizer, and multi-lingual translation matrix with stale revision tracking.

### Infrastructure
- **Network Isolation**: Production Docker Compose topology (`compose.prod.yml`) isolating PostgreSQL 16 and Redis 7 on an internal network (`internal: true`) with zero public exposure.
- **Non-Root Containers**: Unprivileged execution across all containerized services (`node` user, unprivileged NGINX uid 101, postgres/redis non-root).
- **Transactional Outbox Dispatcher**: Asynchronous event delivery decoupled via BullMQ queue worker with failure retries and dead-letter handling.
- **Full-Text & Trigram Search**: Text search powered by PostgreSQL `pg_trgm` GIN indexes over indexed document contents (observed low-latency query results in release verification benchmarks).

### Developer Experience
- **Monorepo Tooling**: pnpm workspace tooling with Nx coordination, frozen lockfile validation, and zero-error TypeScript/ESLint gates.
- **OpenAPI 3.1 Specification**: Comprehensive REST API schema definitions generated for all core public and administrative endpoints.
- **Community Templates**: Standardized GitHub issue templates (`bug_report.md`, `feature_request.md`), pull request template, and security disclosure policy (`SECURITY.md`).

### Deployment
- **Canonical Deployment Script**: Deterministic 6-phase deployment pipeline (`scripts/deploy-production.sh`) executing preflight, backup, migration, container build/rollout, health polling, and smoke tests.
- **Automated Backup & Restore**: Transactional PostgreSQL dump tooling (`scripts/backup.sh`, `scripts/restore.sh`) generating gzip-compressed SQL dumps with SHA-256 checksums.
- **Operational Runbooks**: Comprehensive self-hosting (`docs/deployment/SELF_HOSTING.md`), production guide (`docs/deployment/PRODUCTION.md`), Docker topology (`docs/deployment/DOCKER.md`), and troubleshooting guides (`docs/deployment/TROUBLESHOOTING.md`).

### Validation
- **Vitest Unit & Integration Suite**: 135/135 test files passed (1,074/1,074 tests, 100% pass rate in verification environment).
- **TypeScript Static Verification**: 71/71 workspace projects passed (`pnpm typecheck`, 0 errors).
- **ESLint Code Quality**: 74/74 packages passed (`pnpm -r lint`, 0 warnings, 0 errors).
- **Production Smoke Tests**: 10/10 endpoints verified on local gateway (observed latencies between 2ms and 80ms during release verification).
- **Security Vulnerabilities**: 0 vulnerabilities (`pnpm audit --prod`).

---

## [1.0.0-rc.1] - 2026-08-16

### Milestone Summary
First official Release Candidate of the Vibress publication platform. Complete implementation, integration, and verification across all 18 phases of the Vibress Master Execution Plan.
