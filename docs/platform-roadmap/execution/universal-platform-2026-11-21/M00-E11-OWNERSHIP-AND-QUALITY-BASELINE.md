# M00-E11 — Operational, Privacy and Quality Ownership Baseline

**Status:** ROLE DEFINITIONS PREPARED; all human names and signatures **NOT PROVIDED**. No numeric SLO/RPO/RTO promise is invented.

## Ownership register

| Responsibility | Owning role (not a person) | Name | Authority source | Status |
| --- | --- | --- | --- | --- |
| Architecture decisions | Architecture owner | — NOT PROVIDED — | Project Owner appointment | PENDING |
| Database/RLS/recovery | Principal DBA | — NOT PROVIDED — | Project Owner appointment | PENDING |
| Application security | AppSec lead | — NOT PROVIDED — | Project Owner appointment | PENDING |
| IAM/OIDC/approvals | IAM owner | — NOT PROVIDED — | Project Owner appointment | PENDING |
| Infrastructure/SRE | SRE lead | — NOT PROVIDED — | Project Owner appointment | PENDING |
| Incident response | Incident commander role | — NOT PROVIDED — | Project Owner appointment | PENDING |
| Privacy/tenant offboarding | Data protection owner | — NOT PROVIDED — | Project Owner appointment | PENDING |
| Release authority | Release board / owner | — NOT PROVIDED — | Project Owner appointment | PENDING |
| Independent certification | Agent 06 reviewer | — NOT PROVIDED — | Must be a genuinely separate reviewer | PENDING |

## Operational baseline

- Evidence format: exact SHA/tree, CI run URL, environment versions, command list, positive and negative assertions, explicit skips, named reviewer and timestamp.
- SLI/SLO plan: define measurers and collection points first; no numeric service promise is recorded without measurement and owner acceptance.
- RPO/RTO plan: measure in a disposable full-installation recovery drill (M08); no blanket zero-loss claim.
- Retention/offboarding: bounded contracts exist in `packages/tenancy/src/lifecycle.ts`; backup erasure is never claimed.
- Escalation: any cross-tenant read, privilege escalation, lost acknowledged data or invalid signature is a STOP condition.

## Ownership constraints

- No agent may impersonate a human DBA, IAM owner, IdP administrator, release authority or independent reviewer.
- Governance PENDING entries are not approvals.
- Production remains NO-GO; risk acceptance NONE.
