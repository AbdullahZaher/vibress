# M00-E07 — Deployment and Identity Security Architecture Baseline

**Status:** NONPRODUCTION DESIGN BASELINE; no production deployment, no privileged grant, no R26/F-012 decision applied.

## Topology (recommended, not authorized for production)

- One application per installation; separate installations never share a database, Redis namespace, object-storage bucket/prefix, queue credentials, secret encryption key or backup identity.
- Distinct PostgreSQL authorities: non-superuser deployment owner, runtime DML role, membership reader, deployment verifier; operator provisioning kept out of request-serving paths.
- API and Worker resolve the principal server-side through OIDC/JWKS and verified membership; the request never supplies a trusted tenant/principal object.
- Secret and backup ownership is assigned per installation; no ambient shared operator credential in serving processes.

## Source-backed current state

| Control | Evidence | Current state |
| --- | --- | --- |
| Three serving roles | `packages/database/src/platform-runtime-role.ts`, `platform-membership-reader.ts`, `platform-deployment-verifier.ts` | Defaults inventoried: runtime/reader/verifier |
| Provisioning separated from serving | `tests/architecture/platform-boundaries.test.ts` | Negative test present |
| Tenant scope verification | `packages/tenancy/src/scope.ts` | Implemented; `pub_default` rejected |
| Installation isolation harness | `scripts/platform/resource-isolation/` | Disposable fixture harness merged in #174; not full runtime proof |
| OIDC verifier | `apps/platform-reference/src/oidc-principal-verifier.ts` | Offline/static-token fail-closed; live IdP pending |
| Read-only privilege inventory | `POSTGRES-SECURITY-INVENTORY.json` | Static scan only; no database contacted |

## Threat model summary

- **T1 cross-tenant read/write** — mitigated by verified scope + FORCE RLS; must be negatively tested with real roles.
- **T2 privilege escalation via PUBLIC/inherited EXECUTE** — R26 scope unresolved; no new grant applied.
- **T3 legacy CMS topology confusion** — F-012 A/B unresolved; `pub_default` must never become an application/tenant identity.
- **T4 stale principal after revocation** — live IdP/JWKS rotation and worker-path revocation tests pending.
- **T5 shared infrastructure leakage** — Redis/S3/queue/backup A/B fixture exists; actual service-principal denial drill pending.
- **T6 backup/restore overreach** — backup erasure is not claimed; recovery authority must be external and per installation.

## Authorization matrix (all PENDING)

| Item | Needed decision | Approver role | Status |
| --- | --- | --- | --- |
| R26 function EXECUTE scope A/B | Choose and apply verified grants | Owner + AppSec + human DBA | PENDING |
| F-012 CMS RLS topology A/B | Choose supported topology | Owner + AppSec | PENDING |
| Non-superuser deployment owner | Approve role boundary | Human DBA | PENDING |
| Live IdP integration | Provide IdP administrator environment | IdP administrator | PENDING |
| Redis/S3/backup A/B drill | Approve disposable topology | Owner + SRE | PENDING |

No privileged SQL, role change or production credential was used in producing this baseline.
