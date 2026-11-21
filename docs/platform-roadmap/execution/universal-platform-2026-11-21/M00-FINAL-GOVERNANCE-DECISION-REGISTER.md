# M00 — Final Governance Decision Register

**Status:** decision packages prepared; **no decision below is approved**. Blank reference/date fields are not signatures and no AI agent persona is an organization-level signatory.

| Decision | Status | Recommended option | Alternatives | Security / compatibility / recovery / implementation implications | Decision authority | Reference | Date / scope |
|---|---|---|---|---|---|---|---|
| ADR-PLAT-001 Installation topology | PENDING | One application per installation with separate DB/Redis/S3/queue/secret/backup identities | Shared multi-app runtime | Stronger isolation; higher per-install operational cost; no same-process isolation claim; M01/M11 topology impact | Architecture owner + DBA + IAM + Project Owner | NOT PROVIDED | NOT PROVIDED |
| ADR-PLAT-002 Identity vocabulary | PENDING | Branded application/installation/environment/organization/tenant/principal/publication identities; `pub_default` never an app or tenant | Legacy publication-as-tenant fallback | Prevents identity confusion; requires CMS compatibility adapter; migration mapping impact | Architecture owner + Project Owner + A05 | NOT PROVIDED | NOT PROVIDED |
| ADR-PLAT-003 Transaction/RLS architecture | PENDING | Server-verified scope, `SET LOCAL`, FORCE RLS, rollback-only nested transactions, non-superuser deployment owner | Defer to M02 runtime | Strongest tenant fence; requires real PG16 effective-privilege evidence; affects M02/M03/M04 runtime | DBA owner + AppSec owner + A06 prototype review | NOT PROVIDED | NOT PROVIDED |
| R40 Framework release identity | PENDING | Reconcile Host 1.2.0 manifests with Compose `VIBRESS_VERSION:-1.0.0` fallback and ADR-013 before any Framework GA tag | Separate noncolliding namespace/tags | Avoids version collision; requires support-matrix and disclosure decision; no release authorization implied | Product/release owner + A01/A10 | NOT PROVIDED | NOT PROVIDED |
| M00-E11 accountable owners | PENDING | Appoint named humans for DB security/recovery, AppSec, IAM/IdP, SRE, privacy/retention, release, incident response and independent certification | Role-only assignment (insufficient for formal closure) | Governance capacity is a real control; no numeric SLO/RPO/RTO promised | Project Owner | NOT PROVIDED | NOT PROVIDED |
| A1 Architecture | PENDING | Accept only with signed ADR-PLAT-001/002/003 | — | See above | Named architecture owner | NOT PROVIDED | NOT PROVIDED |
| A2 Product/version strategy | PENDING | Resolve R40 first; no private package publication without explicit authorization | — | A2/G6 block public SDK/CLI | Product owner | NOT PROVIDED | NOT PROVIDED |
| A3 Security standards | PENDING | Select ASVS 5.0.0 controls and SSDF handling | — | No marketing certification claimed | AppSec owner | NOT PROVIDED | NOT PROVIDED |
| A4 Supply chain/provenance | PENDING | Define SLSA target, SBOM and digest policy | — | Affects M08 supply-chain gate | AppSec + SRE owner | NOT PROVIDED | NOT PROVIDED |
| A5 Reliability/accessibility | PENDING | Define ISO 25010 measures, WCAG 2.2 AA target, measured RPO/RTO | — | No invented numeric promises | SRE + UX owner | NOT PROVIDED | NOT PROVIDED |
| A6 CMS/Studio/Plugin | PENDING | Freeze compatibility IDs and ABI matrix | — | Affects M03/M08 | Kernel + plugin owner | NOT PROVIDED | NOT PROVIDED |
| A7 Resourcing/governance | PENDING | Appoint named owners and independent reviewer | — | Blocks formal closure | Project Owner | NOT PROVIDED | NOT PROVIDED |
| A8 Final evidence | PENDING | SHA-pinned candidate and responsible maintainer sign-off | — | Current SHA pinned; maintainer sign-off absent | Repository maintainer | NOT PROVIDED | NOT PROVIDED |
| R26 function EXECUTE scope | PENDING | Owner + AppSec + human DBA choose A/B and apply verified grants | — | Privilege escalation risk if wrong | Human DBA + AppSec + Owner | NOT PROVIDED | NOT PROVIDED |
| F-012 legacy CMS RLS topology | PENDING | Owner + AppSec choose supported topology | — | Cross-publication leakage risk | Owner + AppSec | NOT PROVIDED | NOT PROVIDED |
| R35 views/foreign tables | PENDING | Review security_invoker and exclusions | — | Non-row privilege bypass risk | Human DBA | NOT PROVIDED | NOT PROVIDED |
| A2/G6 package publication | PENDING | Authorize public namespace, build artifact and SemVer/ABI matrix | — | DX-08 public SDK remains blocked | Product/release owner | NOT PROVIDED | NOT PROVIDED |
| M03 D-01 / D-02 / D-03 | PENDING | See existing decision packages; no M04 runtime activation, no 0061 rewrite | — | M03 remains conditional | Owner + human DBA/IAM + A06 | NOT PROVIDED | NOT PROVIDED |

## Specialist technical reviews

| Agent | Scope | Status |
|---|---|---|
| A02 | Database architecture and SQL security | NOT OBTAINED — no independent human DBA verdict |
| A03 | Application security | NOT OBTAINED — no independent AppSec verdict |
| A04 | Reliability and recovery | NOT OBTAINED — no independent SRE verdict |
| A05 | IAM and governance | NOT OBTAINED — no independent IAM verdict |
| A06 | Independent engineering certification | OBTAINED — `M00_ENGINEERING_ACCEPTED` at `77a6043b`, restricted scope only |

AI agent persona reports are engineering inputs, not real organization signatories. Human DBA/IAM/security and owner authorizations remain mandatory.
