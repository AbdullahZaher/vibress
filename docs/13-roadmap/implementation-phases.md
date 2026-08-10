# Recommended Implementation Roadmap

## Phase 0 — Foundation

- pnpm + Nx workspace
- TypeScript strict mode
- lint/typecheck
- config package
- PostgreSQL + Drizzle
- Redis
- API bootstrap
- worker bootstrap
- CI
- Docker development infrastructure
- dependency-boundary enforcement

## Phase 1 — Identity and publishing core

- users
- roles
- permissions
- sessions/auth
- posts
- pages
- tags
- authors
- revisions
- Admin shell
- Content API

## Phase 2 — Vibress Studio integration

- Studio repository
- Lexical base
- default nodes/cards
- Studio JSON format v1
- HTML renderer
- Admin integration
- media upload callback

## Phase 3 — Media and storage

- media domain
- local provider
- storage-core contracts
- S3-compatible plugin
- AWS/R2 presets
- signed URLs
- direct uploads
- encrypted credentials
- storage settings UI

## Phase 4 — Public experience

- Next.js public web
- SEO
- RSS
- sitemap
- theme foundation
- public search baseline

## Phase 5 — Members and commerce

- members
- portal
- products/plans
- offers
- subscriptions
- billing provider abstraction
- member entitlements

## Phase 6 — Newsletters and email

- newsletter domain
- email provider abstraction
- queue-based delivery
- batches/recipients
- delivery events
- unsubscribe/preferences

## Phase 7 — Plugins and integrations

- plugin-core
- plugin-sdk
- manifest/permissions
- lifecycle
- webhooks
- integration plugins
- Studio plugin registration

## Phase 8 — Analytics and automation

- event ingestion
- aggregation
- dashboards
- automation rules
- notifications

## Phase 9 — Hardening

- full security suite
- SSRF validation
- rate limits
- upload hardening
- backup/restore tests
- migration upgrade tests
- load testing
- disaster recovery documentation

## Release principle

Do not optimize for feature count first.

Prioritize:

1. stable contracts
2. domain boundaries
3. migration safety
4. content compatibility
5. security
6. observability
7. extensibility
