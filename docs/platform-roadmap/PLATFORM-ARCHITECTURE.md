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

## Code-first application runtime boundary

The platform is **not** a general application framework merely because it generates CRUD/Admin. The supported v1 runtime must accept **developer-owned front-end routes/pages**, typed custom HTTP endpoints and transactional actions through public contracts, and then compile an independently deployable app. The end-user web UI can be an ordinary Next.js/React app consuming its typed SDK. The secure host remains responsible for verified identity, tenancy, request validation, policy and transaction scope; it must not leak a privileged raw Fastify/SQL pool to external modules. The canonical IR describes declarative schemas and route/action *metadata*; arbitrary application code stays in developer-owned source.

See [code-first runtime](APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [v1 scope](V1-SCOPE-AND-RELEASE-CRITERIA.md). One app per installation is a recommended **v1 mode**, not a universal truth for every platform deployment. Multi-app shared runtime would require a separate later threat model and assessment.

## Effective infrastructure isolation and rolling releases

“App per installation” is only meaningful with **tested physical and authorization separation**, not just separate names. Recommend dedicated database credentials and databases, enforced Redis ACL/queue isolation, bucket/IAM restrictions, isolated secrets and per-install backups for v1; explicitly document any shared infrastructure exception. Custom app source code is trusted within its installation, and RLS custom session variables cannot defend against malicious code able to run SQL as the same role. Third-party cross-app communication must be authenticated API/event based.

For schema evolution test **mixed API/Worker/SDK/Web versions** and delayed events during expand/backfill/contract. A rollback of code does not imply a safe downgrade of schema/data. See [trust](APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [effective PG privilege proof](POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [version matrix](UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).

## Product packaging

- Vibress Framework: kernel + runtime + SDK + templates; complete self-hosting.
- Vibress Studio: current Lexical editor remains independently versioned; Visual App Builder uses resource IR, **not** Lexical document JSON as app schema.
- Vibress Cloud: optional deployment adapter/control plane; no cloud-only mandatory runtime API.

## Existing architecture references

- [Architecture overview](../01-architecture/overview.md)
- [Dependency rules](../01-architecture/dependency-rules.md)
- [Plugin trust ADR](../14-decisions/plugin-trust-model.md)
- [Content Modeler](../../packages/database/src/schema/content-models.ts)


## Architecture review correction (2026-11-14): deployment topology is a security decision

**Recommended v1 default:** one general Application per **Installation/Runtime** with separate DB credentials, storage namespace, queues/secrets and deployment identity. Support many *tenants inside that one app* only when explicit PostgreSQL RLS/policy contracts are implemented and tested. Do not assume apps from unrelated developers safely share one privileged Node process or SQL credential. Shared multi-app runtime remains deferred until isolation tests and an ADR prove its safety; see [decision ADR-PLAT-001](ARCHITECTURE-DECISION-GATES.md) and [DB contract](DATA-ISOLATION-AND-MIGRATIONS.md).

**Control plane and runtime authorization:** a control-plane user managing an app is not automatically an authenticated member/operator inside that app. Installation and tenant administration require separate delegated credentials, audited flows and narrow service identities. Environment credentials, network routing and artifact ownership must not cross installations.

**M01 security precondition:** Threat modeling and the proposed topology ADR are accepted in M00 **before** new runtime extraction. M01 prototypes run offline/nonproduction until M02 proves RLS, scoped transactions, database privilege separation and cross-tenant boundaries.

**Existing transaction gap:** current `getDb()` is a pooled unscoped connection outside `runInTransaction()`; the latter propagates a DB transaction using AsyncLocalStorage, but does not itself set a verified app/tenant SQL context. New tenant-owned reads/writes must use a dedicated scoped UoW interface, not reuse raw `getDb()`. A GUC alone is not authentication against arbitrary SQL access.

**DDL and resource compiler trust:** code-first/visual/agent definitions compile to bounded validated IR and *reviewable* migration plans, never directly to unapproved privileged SQL at request time. Migration owners and plugin physical-model provisioners are separate from runtime DML roles. Prefer compatible expand/contract deployment with forward-fix where actual schema downgrade is unsafe.

**Architectural portability limit:** PostgreSQL is the supported v1 RLS reference implementation. Other database engines are future adapters without claimed equivalent row isolation or migration guarantees.
