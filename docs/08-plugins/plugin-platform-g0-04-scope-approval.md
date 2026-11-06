# Vibress Plugin Platform — G0-04 Product Scope and Investment Decision

**Document version:** 1.0 (proposed)  
**Program baseline:** `c641ed063f79ceb109988ec19692338a319c8b96`  
**Status:** PENDING PRODUCT OWNER AND EXECUTIVE SPONSOR APPROVAL  
**Decision sought:** Approve a controlled R1–R3 delivery scope, preserving separate conditional authorization for R4 and R5.

## 1. Decision statement (proposed; not authorized)

Authorize **planning and scoped engineering for R1–R3**, subject to Gate G0 closure, actual capacity/funding confirmation, verified technical estimates, and subsequent G1–G3 release acceptance. The decision is not permission to skip G0 or release operationally unverified code.

**R4** (untrusted-plugin isolation) remains an independently governed feasibility/security investment; **R5** (Marketplace) remains deferred pending G4 and a separate commercial/business case. Existing M7–M8 code is not certification of untrusted execution.

## 2. Business outcomes and measurable acceptance

| Outcome | Evidence required | Release gate |
|---|---|---|
| Reliable trusted plugins | Signed release validation, publication isolation, multi-replica recovery and DR evidence, incident runbooks | G1 |
| Native plugin administration | Independently packaged plugin showing Host-rendered page, table, form, errors, Arabic/RTL and safe publication switching without arbitrary Admin JS | G2 |
| Embedded extension surfaces | Approved, bounded extension slots consumed by an independent plugin without private Admin imports or DOM control | G2 |
| Developer independence | Public SDK and tooling consumed from a repository outside the monorepo, with supported Host/SDK compatibility matrix | G3 |
| Safe upgrade and retirement | Populated DB upgrade, migration preflight, fleet drain, conflict/rollback boundaries, export and data-retention behavior | G3 |
| Operational supportability | Reproducible exact-SHA test evidence and operator-approved recovery guidance | G1–G3 |

No unmeasured uptime, throughput, latency, revenue, adoption or release-date target is approved. The Product Owner must set target customer/publisher metrics; SRE must derive availability/RPO/RTO targets from environment baselines.

## 3. Committed product boundary — R1–R3 proposal

### R1: Trusted Plugin Foundation

Operator-approved immutable releases; signed artifact admission; publication-scoped authorization and settings; lifecycle and audit; event ledger and recovery; operational rollback and key rotation. R1 may operate only in the documented operator-trust model. Trust is not sandboxing.

### R2: Native Extension Experience

Use `@vibress/api-contracts` and `@vibress/plugin-sdk` additive/versioned contracts, a Host-rendered React registry, and validated Native v2 descriptors. Initial demonstrated components: page/section/card, stat, data table, form fields, action button, notice, loading/error. The initial slots should be `admin.navigation`, `admin.dashboard.widget`, and `content.editor.sidebar`. Other slots may be approved separately after the independent consumer and a11y/security design prove their necessity. Include localization/RTL, focus/keyboard/screen-reader support, and secure publication switching. Preserve V1 and legacy iframe behavior under its existing security rules.

### R3: Professional Developer Platform

Publish the SDK only after compatibility policy, packaging/signing tooling, independent consumer CI and real upgrade/recovery acceptance are complete. Provide typed resources and workflows, audited Host actions, event/webhook contracts, developer documentation and supported self-hosting instructions. No second competing runtime SDK.

## 4. Explicit exclusions and approval boundary

| Excluded from R1–R3 GA | Reason or required future gate |
|---|---|
| Arbitrary Admin ZIP, GitHub or npm install-to-run | Unreviewed executable admission; requires deliberate security/product approval |
| Third-party JSX, module federation, Web Components or JS with privileged Admin DOM execution | Violates default Host-rendered untrusted UI model |
| Generic JSON UI programming language, arbitrary CSS/HTML/callbacks/URLs | Unbounded security, accessibility, versioning and maintenance contract |
| Public untrusted plugin execution | G4 mandatory OS/runtime security certification |
| Marketplace publisher onboarding, public distribution, commercial billing | G5 and separately approved investment |
| LMS-specific business feature work inside Core | Only independent plugin contract/pilot acceptance is in scope |
| Replacing V1 or rewriting published migrations | Breaks compatibility and upgrade guarantees |
| Mandatory proprietary service or central control plane for self-hosting | Conflicts with Vibress's operator contract |
| Full plugin monetization, rankings and payments | Requires product/commercial/legal business case |

## 5. Security, compatibility and operational non-negotiables

- Host independently authenticates and authorizes all API and action calls; client-supplied publication IDs never grant access.
- Preserve `requireStaffSession`, `requirePermission`, `validateOrigin`, versioned shared Zod schemas and publication isolation as applicable.
- Plugins may not access the core database or private imports; Host-mediated domain APIs are required.
- Durable content and plugin records survive fresh install, populated upgrade, import/export, backup/restore and disable/uninstall boundaries.
- Arabic/RTL, translated strings, keyboards, focus, accessible semantics and appropriate layouts are required at G2.
- At-least-once events demand idempotency for external effects; receipt tables alone do not provide exactly-once processing.
- Tier 2 untrusted execution remains fail-closed until G4 certification.
- No released migration rewrite, no silent security downgrade and no replacement of active plugin bytes during unsafe mixed-fleet operation.

## 6. Proposed scope change-control policy

A request must state customer problem, impact, affected contracts and consumers, risk, estimate, security review, migration path, operational impact and expected ROI. Architect and Security Lead can impose a technical stop-ship; the Product Owner controls product priority; the Sponsor controls investment/scope changes. No product owner may waive authorization or isolation gates to hit a date. The Program Manager records disposition and adjusts forecasts only after an approved change request.

## 7. Open approval inputs

| Input | Responsible authority | Required record |
|---|---|---|
| Target users and supported plugin categories | Product Owner | Approved product statement |
| R1–R3 in-scope and exclusions | Product Owner + Sponsor | Signed scope baseline |
| Development funding limit and funding period | Executive Sponsor / Finance | Approved budget envelope; amount not yet known |
| Support policy and intended self-hosting profiles | Product + Operations | Approved supported-deployment matrix |
| Product acceptance measures and performance budgets | Product + QA + SRE | Baseline metrics and targets |
| R4/R5 spend authorization | Executive Sponsor | Separate later decision; currently **not authorized** |

## 8. Decision record — FOR AUTHORIZED REVIEW

- **Decision ID:** G0-D01
- **Options:** APPROVE R1–R3 with exclusions / APPROVE WITH CONDITIONS / DEFER / REJECT
- **Recommended disposition:** APPROVE WITH CONDITIONS after funding/capacity and G0 evidence completion
- **Actual disposition:** **NOT RECORDED**
- **Approved scope version and commit:** **TBD**
- **Named Product Owner:** **TBD**
- **Product Owner signature/date:** **TBD**
- **Named Executive Sponsor:** **TBD**
- **Executive Sponsor signature/date:** **TBD**
- **Conditions and expiry/review date:** **TBD**
- **Evidence link / decision minutes:** **TBD**

**Exit condition G0-04:** A named Sponsor and Product Owner approve this precise scope (or a revised version), its exclusions and required decision inputs. Until then **G0-04 remains PENDING**.
