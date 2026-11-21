# M00-E02 — ADR and Standards Decision Packages

**Status:** PACKAGES PREPARED; all decisions **PENDING**. No ADR is approved by this document.
**Production:** NO-GO. Risk acceptance: NONE.

Agent 01 prepared these packages with technical input constraints from Agents 02–05. Preparation is not sign-off; no owner, DBA, IAM, AppSec or architecture-authority signature is represented here.

| Decision | Technical recommendation (not approval) | Required actual approvers | Status |
| --- | --- | --- | --- |
| ADR-PLAT-001 installation topology | One application per installation; separate operator, runtime, reader and verifier identities; no same-process cross-install isolation claim | Architecture owner + DBA + IAM + Project Owner | PENDING |
| ADR-PLAT-002 identity vocabulary | Branded application/installation/environment/organization/tenant/principal/publication identities; `pub_default` never an application or tenant | Architecture owner + Project Owner + Agent 05 | PENDING |
| ADR-PLAT-003 tenant transaction/RLS architecture | Server-verified scope bound to `SET LOCAL`, FORCE RLS, rollback-only nested transactions, non-superuser deployment owner | DBA owner + AppSec owner + Agent 06 prototype review | PENDING |
| R40 release identity | Reconcile Host 1.2.0 manifests with Compose `VIBRESS_VERSION:-1.0.0` fallback and ADR-013 before any Framework GA tag/namespace | Product/release owner + A01/A10 | PENDING |
| A1–A8 standards decisions | Selected ASVS 5.0.0 controls, SSDF handling, SLSA target, ISO 25010 measures, WCAG 2.2 AA target, signed architecture evidence and owner capacity | Named human architecture/security/product owners | PENDING |

## Evidence available

- Source-backed inventory: `REPOSITORY-INVENTORY.json`, `SDK-COMPATIBILITY-INVENTORY.json`.
- Boundary contract: `tests/architecture/m00-boundary-contract.test.ts`.
- Read-only privilege inventory: `POSTGRES-SECURITY-INVENTORY.json`.
- Existing Wave 1 engineering: merged PRs #166/#174/#176 — engineering evidence, **not** a Wave 1 GO.

## Evidence still missing

- Actual named human approvers and signed decisions for every row above.
- Independent Agent 06 review of the ADR-PLAT-003 prototype.
- Runtime effective-privilege evidence for R26/F-012/R35 and non-superuser ownership.
- Release namespace/tag decision for R40.

## Approval record (blank fields are not signatures)

| Decision | Name | Role | Reference URL | Date |
| --- | --- | --- | --- | --- |
| ADR-PLAT-001 | — NOT PROVIDED — | — | — | — |
| ADR-PLAT-002 | — NOT PROVIDED — | — | — | — |
| ADR-PLAT-003 | — NOT PROVIDED — | — | — | — |
| R40 | — NOT PROVIDED — | — | — | — |
| A1–A8 | — NOT PROVIDED — | — | — | — |
