# ADR-PLAT-001 (PROPOSED) — Application-per-Installation Topology

> **Status: PROPOSED. Not reviewed, not accepted, not implemented in production.**
> Owner: **UNASSIGNED** (architecture lead). Gate document:
> [ARCHITECTURE-DECISION-GATES.md](https://github.com/AbdullahZaher/vibress/blob/c9997a9353a229a4287256f5ba3b94d718e3a5d9/docs/platform-roadmap/ARCHITECTURE-DECISION-GATES.md).
> Proposals here do not authorize hosting external applications or tenants.

## Context

The platform roadmap separates Application, Installation, Environment and Tenant.
Existing Vibress runtimes share one PostgreSQL database and one runtime role that
holds DML on every table plus `CREATE` on `public`
([runtime-role.ts](../../../../packages/database/src/runtime-role.ts)). Namespace
prefixes and distinct role names alone are not an isolation boundary.

## Proposed decision

1. v1 hosts **one Application per Installation**. Each Installation owns a dedicated
   PostgreSQL database, a dedicated runtime credential pair, a dedicated Redis
   namespace or instance with enforceable ACLs, a dedicated object-storage bucket or
   IAM-restricted prefix, and its own secrets and ingress identity.
2. Multiple **tenants inside one Application** are supported through the tenant layer
   in ADR-PLAT-003, not through additional databases.
3. Multiple unrelated customer applications inside one privileged Node process are
   **out of v1** and require a separate threat model and gate.
4. Installation identity is established by deployment configuration and credentials,
   never by a request header or a publication id.

## Rejected alternatives

| Alternative | Why rejected for v1 |
| --- | --- |
| Shared database with per-app role names only | Table-level grants in one `public` schema are one missed `REVOKE` from cross-app reads; no physical boundary |
| Redis key prefixes / S3 path prefixes as isolation | Prefixes are naming, not authorization, unless ACL/IAM enforces them |
| Multi-app shared Node process | In-process code is trusted code; one process has one credential set |

## Consequences

- Operators provision one database and credential set per installation.
- Cross-installation analytics or admin requires an audited, separate identity.
- The current shared-database CMS deployment remains supported as a **single**
  installation with the legacy CMS compatibility adapter.

## Proof required before acceptance

- Two installations with distinct credentials cannot read or write each other's
  tables, queue keys, objects or backups (negative tests, real infrastructure).
- Deployment/runbook review and restore rehearsal for one installation.
- Human architecture/security sign-off recorded on the ADR.

## Evidence in this branch

- `packages/database/src/platform-runtime-role.ts` provisions a non-owner,
  `NOBYPASSRLS` runtime role scoped to platform tenant tables.
- `tests/integration/platform-tenant-isolation.test.ts` proves the role cannot read
  the operator registry, CMS `users`, or another tenant's rows.

**Not proven here:** two separate installations with two separate databases. That
remains an open Wave 1 blocker.
