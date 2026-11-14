# Application Installation, Trusted Code & External Integration Boundaries

> **Proposed target architecture; not a statement that isolation is currently deployed.** See [code-first application contract](APPLICATION-RUNTIME-AND-EXTENSIBILITY.md), [DB/RLS](DATA-ISOLATION-AND-MIGRATIONS.md), [data lifecycle](DATA-LIFECYCLE-AND-OPERATIONS.md).

## Threat model: who is trusted?

| Actor/code | Trust | Boundary |
| --- | --- | --- |
| Platform maintainer / approved installer | Highly privileged **only during reviewed operations** | Owns migrations, signing keys, deployment and emergency actions with audit |
| **Application author/server code** | **Trusted within its own installation** (can execute app-owned server logic) | Must not be co-hosted with untrusted apps in the same privileged runtime for v1 |
| End user / tenant member | Untrusted | Auth + policy + tenant-scoped repository and RLS, no arbitrary SQL |
| Module maintainer with Tier-1 admission | Trusted *operator-approved* code; may share Node privileges | Distribution/approval control, **not an in-process sandbox** |
| Unreviewed marketplace code or generated AI code | Untrusted until reviewed/approved into app-owned source | No in-process execution or database credentials by default |
| Cross-app client/service | External untrusted principal until authenticated | Service audience, explicit scopes, signed/idempotent messages and egress restrictions |

Trusted application code running with installation DB credentials may bypass TypeScript repo interfaces or set custom SQL variables if it can issue arbitrary SQL. **The platform does not claim to sandbox a malicious application author inside their own single-application installation**. Its v1 security claim is isolation between installations and between untrusted end users/tenants **under supported, trusted application code paths**. To host mutually distrusting app authors in one environment would require new isolation design and audits.

## Concrete physical isolation default

**Recommended v1:** one Application per **runtime installation** with a *dedicated PostgreSQL database* or independently audited equivalent isolation boundary, separate runtime/migration credentials, service identity, environment secrets, storage bucket/IAM access policy, Redis ACL/instance and queue/worker authority, ingress/domains and backup lifecycle. Two credentials in a shared `public` schema are **not** assumed isolated because global grants may still expose all tables/functions.

Namespaces and prefixes are organizational aids only unless supported by database role grants, Redis ACL or provider IAM permissions. Test credentials directly: app A should not list/read/write/delete app B's PG objects, Redis keys or queues, storage objects, secrets or backup snapshots.

## Cross-app communication

Applications communicate through a **contracted API/event integration boundary**, not common SQL tables or shared Redis queue subscriptions.

- Authenticate service-to-service with per-app audience, scopes, explicit installation target and expiry/revocation. Avoid confusing platform operator credentials with runtime app user identity.
- Enforce HTTP request validation, signed webhook verification, deduplication/idempotency, replay detection, rate/cost budgets and bounded event schema versions.
- Restrict outbound URLs and network paths according to a reviewed SSRF/egress policy, and verify redirect behavior. Cross-app integrations cannot silently become privileged database RPC.
- Support a documented error/retry/DLQ contract and cross-install event correlation without exporting secrets or excessive personal data in logs.
- Test both denied app A→B access and explicitly allowed API events with least-privileged credentials.

## Deployment, secrets and backup evidence

Before external app hosting, capture an installation inventory listing physical DB name/schema, user/role, Redis ACL/queue namespace, storage policy, deployment identity, TLS/ingress, secrets and backup encryption/restore ownership. Include rotating secrets, revoked app credentials, environment promotion and tenant termination. For future Cloud M11 define delegated operator/tenant actions separately; a Cloud project owner is not automatically a runtime tenant operator.

**Acceptance:** two independent installed applications with intentionally different credentials must survive adversarial boundary checks across DB/Redis/storage/jobs and an individual restore without unexpected access to each other.
