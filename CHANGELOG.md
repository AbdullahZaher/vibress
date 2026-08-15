# Changelog

All notable changes to the **Vibress** publishing platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-rc.1] - 2026-08-16

### Milestone Summary
First official Release Candidate of the Vibress publication platform. Complete implementation, integration, and verification across all 18 phases of the Vibress Master Execution Plan.

### Added
- **Trust & Hardened Foundation (Phase 1)**: Real multi-provider AI gateway, fail-fast database schema startup checks, unprivileged production Docker runtimes, absolute SSR canonical URL resolution.
- **Admin Platform & Studio Cards (Phase 2)**: Navigation route guards, versioned optimistic locking (409 Conflict rejection), all 13 canonical Studio cards (`Button`, `Markdown`, `HTML`, `Callout`, `Bookmark`, `Gallery`, `Video`, `Audio`, `File`, `Divider`, `Product`, `Embed`, `Header`), and background scheduler worker.
- **AI Gateway & Capabilities (Phase 3)**: Multi-model provider routing (OpenAI, Anthropic, Gemini, DeepSeek, Local/Ollama, Deterministic Test), 13 task prompts, user rate-limiting, publication monthly token budgets, circuit breaker, and audit logging.
- **Studio Collaboration & Editorial Workflows (Phase 4)**: Yjs CRDT real-time document synchronization over WebSockets with presence awareness, 7-stage editorial lifecycle (`draft` → `in_review` → `changes_requested` → `approved` → `scheduled` → `published` → `archived`), and side-by-side visual revision diff modal.
- **Content Modeler (Phase 5)**: Visual Schema Builder supporting 18 canonical field types, validation engine, schema evolution backward compatibility, dynamic collections, and public REST delivery.
- **Secure Plugin & Theme Ecosystem (Phase 6 & 16)**: Extension host child process sandbox with capability gates, SHA-256 cryptographic package checksums, deterministic theme template hierarchy, public SDK starter theme, and sample plugin examples.
- **Arabic-First Internationalization (Phase 7)**: Built-in `arDictionary`, automatic RTL layout direction detection, Umm al-Qura Hijri calendar formatting, and multi-lingual translation management with stale version indicators.
- **Search 2.0 (Phase 8)**: Arabic text normalizer, pg_trgm similarity + Full-Text PostgreSQL ranking, worker reindexing pipeline, and zero-result search telemetry.
- **Media Platform 2.0 (Phase 9)**: Multi-variant responsive image scaling (`300w`, `600w`, `1200w`, `1920w`) across WebP/AVIF/JPEG, automatic srcset generation, and non-destructive focal point boundaries.
- **Visual Automations & Run Inspector (Phase 10)**: Event-driven automation engine with conditional branching, recursion guards, versioned execution snapshots, step status tracking, and Visual Automation Builder in Admin.
- **Distribution, GEO & Social Web (Phase 11)**: AI crawler index endpoints (`/llms.txt`, `/llms-full.txt`), RSS 2.0 XML, JSON Feed 1.1, and ActivityPub federation (Inbox, Outbox, Delete with Tombstone objects).
- **Multi-Publication Workspaces & Isolation (Phase 12)**: Multi-tenant database schema, async context propagation, workspace/publication switching, and 13-point cross-tenant isolation enforcement.
- **Enterprise Identity & Governance (Phase 13)**: WebAuthn Passkeys, SCIM 2.0 user provisioning/deprovisioning, active device session tracking and bulk revocation, and role-based MFA policies.
- **Operations, Observability & Reliability (Phases 14, 15, 17)**: SHA-256 verified database backup and restore scripts, disaster recovery drill, OpenTelemetry distributed tracing, Prometheus `/metrics`, OpenAPI 3.1 schema specification, and zero-downtime database migrations.

### Migration Notes
- Database migrations `0000_baseline.sql` through `0021_master_plan_extensions.sql` must be applied in sequence (`pnpm run db:migrate`) prior to starting API and Worker containers.
- Fail-fast schema inspection (`assertDatabaseSchemaReady`) ensures containers will refuse to start if any migration is missing.

### Verification Matrix
- **Vitest Unit & Integration**: 854/854 tests passed (106 test files).
- **Playwright Full E2E**: 94/94 passed, 0 failed, 0 skipped.
- **TypeScript Typecheck**: 71/71 projects passed (0 errors).
- **ESLint**: 58/58 projects passed (0 errors, 0 warnings).
- **Security Audit**: 0 known vulnerabilities (`pnpm audit --prod`).
- **HTTP Load**: 5/5 endpoints 0% error rate under concurrency.
