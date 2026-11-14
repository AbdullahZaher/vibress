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
  tables (negative tests, real infrastructure). **Database boundary measured; Redis
  keys/objects and backups still unproven.**
- Deployment/runbook review and restore rehearsal for one installation.
- Human architecture/security sign-off recorded on the ADR.

## Evidence in this branch

- `packages/database/src/platform-runtime-role.ts` provisions a non-owner,
  `NOBYPASSRLS` runtime role scoped to platform tenant tables.
- `tests/integration/platform-tenant-isolation.test.ts` proves the role cannot read
  the operator registry, CMS `users`, or another tenant's rows.
- `tests/integration/platform-installation-isolation.test.ts` creates **two**
  installation databases, each with its own non-superuser owner and runtime role,
  and revokes `CONNECT` from `PUBLIC`. Measured results: 8/8 passed —
  - installation B's runtime credentials are rejected at `CONNECT` on A's database
    (`42501`), and A's owner is rejected at `CONNECT` on B's database;
  - no installation role has membership in the superuser role;
  - the same tenant id `t-acme` exists in both installations with independent rows,
    and each runtime role sees only its own installation's row;
  - neither runtime role can read the registry or create objects.

**Still open:** Redis ACL/instance and object-storage IAM boundaries are not tested
here, and a staged deployment/restore runbook has not been exercised.

## Verification status

The database-credential boundary is **measured in tests**, not yet in a deployed
environment. Provisioning a non-superuser owner in the actual Compose topology is an
open Wave 1 item.
