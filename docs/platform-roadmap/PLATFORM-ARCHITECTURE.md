# Target Architecture — Universal Vibress Platform

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

## Runtime architecture

```text
Developer / Visual Builder / AI Agent
  ↓
Application Definition Registry (canonical versioned IR)
  ↓
Schema Compiler + Policy Compiler + Module Resolver
  ↓
Application Runtime: Fastify API / Admin / Worker
  ↓
Identity / AuthZ / Tenancy / Actions / Events / Billing ports
  ↓
PostgreSQL + RLS / Redis + BullMQ / S3 / email / payment providers
```

**Control plane** owns development projects, application definition versions, installations and environments. **Application runtime** owns authenticated end-user activity, tenant isolation, persistence and jobs. Do not confuse customer organization on the control plane with a tenant inside an application. The first release may be a modular monolith: a logical boundary does not require a microservice.

## Core vocabulary

| Term | Scope |
| --- | --- |
| Project | Development effort / owner group in control plane |
| Application | Versioned app definition, resources and modules |
| Environment | Dev/preview/staging/production configuration |
| Installation | Specific deployed instance and artifact digest |
| Organization | Owner/team or domain organization, explicitly typed |
| Tenant | Isolation unit within a running multi-tenant app |
| Principal | Authenticated end user, staff, operator or service account |
| Publication | Publishing-specific entity inside optional CMS module |

## Boundaries and dependency direction

```text
apps → public domain APIs → kernel contracts ← infrastructure adapters
plugins → versioned plugin SDK; cannot import private DB/admin/Fastify internals
CMS domains → kernel; kernel never imports publications/posts/newsletters
Studio editor → standalone editor contracts; host handles auth/persistence
UI → validated application APIs; never raw database
```

Existing Fastify / Next.js / Vite / pnpm Nx / TypeScript / Drizzle Postgres / Redis BullMQ remains the initial stack. Separation of Workers and the application runtime remains. Expose provider adapters instead of reinventing auth, billing, storage or queues unnecessarily.

## Data/API pipeline

```text
TypeScript defineResource / Visual form schema / Agent tool
         ↓ (same canonical versioned IR)
Validate types, ownership, permission policy and relations
         ↓
Reviewable physical schema/migration plan and RLS/roles
         ↓
Generate REST/OpenAPI + typed SDK + host-rendered forms and lists
         ↓
Execute security/tenant integration tests and compatibility fixtures
```

Offer physical relational tables for transactional data; bounded dynamic models where useful, but not an all-JSONB generic database. Use expand/contract migrations, human review for destructive operations, explicit codegen ownership and versioned compatibility. GraphQL is optional and requires its own authorization/query-complexity audit.

## Security and plugin lifecycle

Use default-deny permission policies at server and database boundaries. Tenant-aware queries require transaction-local Postgres context on the same pooled connection, RLS policy tests and non-BYPASSRLS roles. Separate migration and plugin schema provisioner from ordinary runtime. Outbox and business state share a transaction; job consumers are at-least-once and idempotent. Reviewed Tier-1 ESM plugins can access Node privileges and are **not** sandboxes; arbitrary untrusted plugins must not run before real isolation is certified.

## Product packaging

- Vibress Framework: kernel + runtime + SDK + templates; complete self-hosting.
- Vibress Studio: current Lexical editor remains independently versioned; Visual App Builder uses resource IR, **not** Lexical document JSON as app schema.
- Vibress Cloud: optional deployment adapter/control plane; no cloud-only mandatory runtime API.

## Existing architecture references

- [Architecture overview](../01-architecture/overview.md)
- [Dependency rules](../01-architecture/dependency-rules.md)
- [Plugin trust ADR](../14-decisions/plugin-trust-model.md)
- [Content Modeler](../../packages/database/src/schema/content-models.ts)
