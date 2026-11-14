# Code-first Application Runtime and Extensibility Contract (Proposed)

> **Design proposal for M00/M01/M04/M07. Not implemented by this PR.** The generic framework goal demands more than CRUD and an Admin. This file defines the first realistic supported application class and prevents the slogan "build any project" from becoming an untestable product promise.

## Product compatibility envelope

| Capability | v1 code-first minimum | Post-v1 / conditional |
| --- | --- | --- |
| Typed relational resources | PostgreSQL-backed models with migrations and tenant policies | Additional database engines and arbitrary dynamic SQL |
| Data and admin APIs | Generated REST/OpenAPI, typed client and CRUD admin | Optional GraphQL and complex user-defined query engines |
| Custom business logic | Authorized application actions and **typed custom HTTP handler extensions** with explicit contracts, tenant-context and request validation | Arbitrary untrusted plug-in code, distributed arbitrary compute |
| End-user web UI | A minimal user-facing Next.js / React route or app template **consuming the public SDK**, with authenticated session integration and safe SSR/cache behavior | Full visual page builder, hosted multi-app web editor |
| Jobs and events | Tenant-aware durable jobs, versioned event envelopes, retries and idempotency | Full visual workflow engine, general orchestration platform |
| Data access | Authorized scoped resource APIs and transactions; no raw SQL for untrusted extensions | Unsafe unbounded/raw database shell access |
| Deployment | Self-hosted single app installation, independent credentials/restore | Shared multi-app process hosting, managed Cloud |
| Extensibility | Trusted operator-admitted module registering bounded routes/actions/resources/UI contributions | Arbitrary marketplace install-to-execute, Tier-2 isolated sandbox |

"General-purpose" means **a developer can implement new web/SaaS/back-office domains without kernel edits**, not that one version supports every runtime, platform, mobile app, game, embedded workload or database driver.

## Proposed ApplicationDefinition / module ownership (illustrative, not exported today)

```ts
export default defineApplication({
  id: "customer-crm",
  resources: { customers, deals, activities },
  actions: {
    approveDeal: defineAction({
      input: ApproveDealInput,
      permission: "deals.approve",
      handler: async ({ scope, tx, input }) =>
        approveDeal({ scope, tx, input }),
    }),
  },
  http: {
    "POST /api/deals/:id/approve": {
      input: ApproveDealHttpInput,
      action: "approveDeal",
      auth: "staff",
    },
  },
  web: {
    client: "@example/crm-web",
    publicRoutes: ["/"],
    authenticatedRoutes: ["/dashboard", "/deals/:id"],
  },
});
```

*The above is an interface design sketch, not an executable CLI command or current SDK export.* Custom code remains trusted developer-owned code compiled into the specific application's package. Untrusted plugin code cannot use it to run arbitrary code on a shared host.

## Execution ownership and request context

- App source is versioned separately from runtime and module artifacts. Every installation pins the application definition version, module graph digest, built web/API image and migration state.
- The app-defined route table delegates to the host router and validates path/body/query parameters, size constraints, auth and permission. Custom routes use the same trusted principal/application/tenant resolver and transaction-scoped data access as generated CRUD. No escape hatch returns privileged raw Fastify, database pool, environment secrets or production network access to a low-trust plugin.
- Code-first public web UI can be supplied by the app developer as an ordinary React/Next.js application consuming the typed client and approved APIs. Browser clients never receive DB secrets or operator credentials. SSR must isolate cache keys by app/tenant/principal as necessary and avoid leaking authenticated responses in shared/public caches.
- The runtime must specify supported entry points: public visitor, authenticated staff/member, service-to-service credential, background job, migration installer, trusted operator plugin, and break-glass operator. Each has a clear authorization policy and permitted data boundary.
- Custom code may be used outside declarative IR, but visual/editor/AI tools only round-trip the **declarative subset**, not arbitrary TypeScript. Generated files have explicit ownership and conflict handling.
- The application can be packaged, deployed and tested without linking to CMS internals and without calling Vibress Cloud. Provide a controlled way to configure routes, app keys, secrets, hostnames and deployment environment.

## Concrete v1 independent CRM acceptance scenario

A clean project outside the monorepo must:

1. Define Customers, Deals and Activities with schema/compiler migrations and tenant policies.
2. Generate CRUD REST/OpenAPI/client and admin list/edit views, including denied read/field test cases.
3. Define a **custom action** to approve a deal with policy and transactional idempotency, exposed through a typed custom endpoint; log its audit record.
4. Implement an **end-user web page** (not only admin) that signs in and reads its own deals through typed SDK; test SSR/cache isolation and no secrets in bundles.
5. Execute a queued notification upon approval, using versioned events and tenant-context propagation.
6. Install an approved trusted module from a **packed/published SDK** without private source imports or any kernel code changes.
7. Upgrade a schema and app version using a reviewed migration plan; validate compatibility and recovery with existing records.
8. Repeat on a clean self-hosted installation with an independent PostgreSQL role and record exact artifact digests and tests.

**Blocking criterion:** if accomplishing steps 1–8 requires modifying `platform-kernel`, exposing a globally shared privileged SQL pool to third-party code, or executing untrusted code in-process, M07 and v1 GA are not accepted.

## Developer DX and extensibility principles

Preserve a stable and small **public** SDK surface. Support local test/debug/logging, typed errors, build and package exports, version support windows and a clear dependency graph. Release a working minimal vertical slice before a comprehensive visual or agent product. Measure time-to-first-custom-feature and kernel edit count against Payload with equivalent scoped tasks; report unsupported cases without claiming universal superiority.
