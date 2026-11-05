# Vibress Plugin Platform — G0-05 Capacity, Accountability and Resource Commitment

**Document version:** 1.0 (proposed)  
**Baseline:** `c641ed063f79ceb109988ec19692338a319c8b96`  
**Status:** RESOURCE MODEL PREPARED — ACTUAL ALLOCATIONS AND SIGNATURES PENDING  
**Decision sought:** Named owners and protected delivery capacity, with an explicit capacity-based forecast and budget validation.

## 1. Planning case (not a staffing commitment)

The existing roadmap's 8.5–10 FTE planning envelope is represented by a **9.25 FTE capacity case**. These are proposed project allocations, not claims about Vibress employees or current availability.

| Role | Planning FTE | Primary duties | Actual named assignee | Confirmed allocation |
|---|---:|---|---|---|
| Program Manager | 1.00 | Plan, RAID, governance, change control, critical path | TBD | Pending |
| Principal Architect / Plugin Tech Lead | 1.00 | Contract boundaries, ADRs, integration decisions | TBD | Pending |
| Backend/Domain Engineers | 2.00 | Runtime, actions, storage, upgrade orchestration, events | TBD / TBD | Pending |
| Admin/Frontend Engineers | 2.00 | Native v2, Host renderer, extension slots, i18n/a11y | TBD / TBD | Pending |
| QA / Test Automation Engineer | 1.00 | Exact-SHA evidence, E2E, compatibility, release test matrices | TBD | Pending |
| Security Engineer | 0.75 | Trusted release review, auth, isolation policy, adversarial tests | TBD | Pending |
| SRE / Database Engineer | 0.75 | Staging, PostgreSQL/Redis, DR, fleet and deployment profile | TBD | Pending |
| SDK / Developer Experience Engineer | 0.75 | SDK tooling, standalone consumer, docs | TBD | Pending |
| **Total** | **9.25** | Peak proposed R1–R3 capacity | | **Uncommitted** |

**Sensitivity:** Confirmed capacity below 8.5 FTE or loss of a scarce security/SRE role triggers re-estimation, reprioritization, and a new gate forecast. Approval must specify whether fractions represent dedicated protected time and which calendar weeks they cover.

## 2. Responsible owners by workstream

| Workstream | Accountable technical owner (role, proposed) | Delivery support | Release |
|---|---|---|---|
| A — Architecture and contracts | Principal Architect | Backend, Admin, SDK | R1–R3 |
| B — Trusted security and runtime | Security Lead | Backend, SRE | R1 |
| C — Native UI v2 | Admin Lead | Architect, QA | R2 |
| D — Extension Slots | Admin Lead | CMS Architect, QA | R2 |
| E — Data and workflows | Backend Lead | DB/SRE, Security | R2–R3 |
| F — Upgrades and recovery | Backend Lead | DB/SRE, Operations | R1–R3 |
| G — SDK/CLI/developer tools | SDK/DX Lead | Architect, QA | R3 |
| H — Events/public/member/themes | Backend/CMS Lead | Worker, Web, QA | R3 |
| I — Tier 2 isolation | Security Lead | Infrastructure/Runtime specialist | R4, separately resourced |
| J — Marketplace | Ecosystem Product Lead | Security, Legal, Operations | R5, not funded |

A named person and alternate are required for each accountable role before its stage gate. Role assignments alone do not meet G0-05.

## 3. Phase allocations within the same capacity ceiling

Concurrent workstreams **share the above people**. Staffing must not add R1 and R2 allocations together as though each has a separate team.

| Period relative to G0 approval | Backend allocation within 2.0 | Frontend allocation within 2.0 | Special emphasis |
|---|---|---|---|
| W1–W12 | R1 1.5; Native/API discovery 0.5 | Native/UI contract spike 1.5; R1 Admin recovery UX 0.5 | SRE/Security/QA prioritize live R1 drills |
| W13–W28 | Native action/data 1.0; R3 upgrades/events 1.0 | Native renderer/slots 1.75; R3 consumer preview 0.25 | QA focuses R2 integration, SRE supports upgrade staging |
| W29–W44 | R3 upgrades/events 1.5; R2 stabilization 0.5 | R3 consumers/compatibility 1.25; R2 fixes 0.75 | SDK/DX 0.75 focus on external consumer/public contract |
| W45–W48 | Fixes 1.0; release/operational acceptance 1.0 | Accessibility/support fixes 1.0; acceptance 1.0 | Release readiness; no speculative new scope |

All unlisted roles remain bounded by their 1.0/0.75 FTE totals; the table illustrates allocation conflicts, not full staffing assignments. The Engineering Manager must confirm actual team calendars, other program commitments, onboarding, leave and support rotation.

## 4. RACI for program decisions

A = single accountable authority; R = responsible producer; C = consulted; I = informed.

| Decision/action | A | R | C | I |
|---|---|---|---|---|
| Product scope and exclusions | Product Owner | Product Owner | Architect, Security, PM | Leads, Sponsor |
| Funding envelope | Executive Sponsor | Sponsor/Finance | Engineering Manager, PM | Product, Leads |
| Named staffing and availability | Engineering Manager | Engineering Manager | Tech Lead, PM | Sponsor, Leads |
| Technical architecture/ABI | Principal Architect | Relevant Tech Lead | Security, API, QA | Product, PM |
| Security sign-off | Security Lead | Security Team | Architect, SRE, QA | PM, Sponsor |
| Operations/DR sign-off | Operations Lead | SRE/DB | Security, Backend, QA | Product, PM |
| Integrated schedule and RAID | Program Manager | Program Manager | Engineering Manager, Tech Lead, Product, QA | Sponsor |
| G0 Go/No-Go | Executive Sponsor | Program Manager (evidence pack) | Product, Engineering, Architect, Security, Operations, QA | All workstreams |
| R1/R2/R3 release authorization | Designated Release Authority per gate charter | PM / QA evidence assembly | Security, Operations, Product, Tech Lead | Sponsor |

The gate charter must identify the exact release approval authority; this proposal does not assume that the Sponsor can override security or operations vetoes.

## 5. Capacity and financial control

**Cost model:** Σ(confirmed allocation FTE × approved fully loaded cost × committed period) + staging/security/tooling/support cost + approved contingency. The value is **TBD**; no cost rate or budget is assumed.

Use monthly planned-versus-actual FTE, burn rate, schedule variance, change requests and committed remaining capacity. Do not infer team velocity from estimates until at least two measured delivery iterations. If a workstream owner is unassigned, it is a delivery blocker, not a green status.

## 6. Approval request and evidence

| Confirmation | Approving authority | Evidence / current status |
|---|---|---|
| Named people and alternates | Engineering Manager | TBD / not approved |
| Availability by week and competing allocations | Engineering Manager | TBD / not approved |
| 9.25 FTE case or revised approved capacity | Engineering Manager + Sponsor | TBD / not approved |
| Security/SRE staging and drill coverage | Security Lead + Operations Lead | TBD / not approved |
| DX/SDK owner assigned before R3 | Engineering Manager | TBD / not approved |
| Budget envelope | Sponsor / Finance | TBD / not approved |

- **Decision ID:** G0-D02
- **Suggested options:** Confirm stated model / Confirm revised model with reforecast / Defer
- **Actual decision:** NOT RECORDED
- **Named Engineering Manager, signature/date:** TBD
- **Named Executive Sponsor/Finance approver, signature/date:** TBD
- **Approved FTE, start/end dates, funding:** TBD

**Exit condition G0-05:** Signed, named, calendar-bound allocations and funding (or a formally approved reduced-scope plan). Until then **G0-05 remains PENDING**.
