# Wave 1 — Project Owner Final Action Checklist

> **NO-GO / approvals not prefilled.** 2026-11-16. This is an owner-facing request, not an instruction to deploy or merge. Exact final SHA must be reverified after all docs/source changes.

## Wave 1 exit requests (required now)

- [ ] Appoint named, authorized **DB owner, AppSec reviewer, Infrastructure/SRE owner, IdP administrator, Architecture owner, Release administrator and non-implementing Agent 06 reviewer**; record separation of duties and evidence.
- [ ] Sign **G0** and applicable **G1/G1b** design/security proof for the Wave 1 installation and tenant scope; accept ADR-PLAT-001/002 and security transaction decision ADR-PLAT-003. No blanket future-wave sign-off.
- [ ] Decide **R26-A and R26-B separately** with written impact/extension/caller risk, relevant specialist and Agent 06 concurrence, backup verification, tested rollback, minimal time-limited scope and decision log. No SQL proposal application without this.
- [ ] Decide **F-012 A/B**: for shared CMS deployments require reviewed RLS; restricted self-hosted alternative requires exact boundaries, controls, expiry and independent acceptance. Record **R35** view/foreign-table scope and any exclusions.
- [ ] Approve non-superuser DB owner/registry/worker role separation and patched PostgreSQL 16.16+ verification on disposable production-shaped installation; signed restoration/forward-fix rehearsal.
- [ ] Authorize bounded **W1-T06** real BullMQ/Redis/S3/backup deny harness and **W1-T07** live nonproduction OIDC/JWKS/revocation/RouteExecutor integration; approve identities, duration and teardown, never include secrets in GitHub.
- [ ] Require SCA disposition for Fastify 5.12.7 advisory, Redis outage rate-limit behavior, source provenance, security alerts and defined rollback thresholds.
- [ ] Require full integrated exact-final-SHA CI, actual checkout commit, artifact digests, regression and cross-publication negative tests; resolve AG06 issues [#177–#186](https://github.com/AbdullahZaher/vibress/issues/177) individually with tests and independent disposition.
- [ ] Collect formal SHA-bound **Agent 02, 03, 04, 05 verdicts**, then a fresh non-implementing **Agent 06** verdict. BLOCKED/REJECT => NO-GO.
- [ ] Authorize branch protection only through repo admin with rollback and audit; close all #166 threads based on evidence, not developer statements.
- [ ] Decide **R40** release identity and A1–A8 portions applicable to Wave 1, especially A1/A2/A3/A4/A7/A8; explicitly defer later milestones without declaring them passed.
- [ ] Issue signed **GO / GO WITH CONDITIONS / NO-GO** on exact release candidate with accepted risks (if any), expiry, recovery plan, monitoring window, rollback triggers and explicit merge authority.

## Later roadmap milestones — tracked, not blanket Wave 1 exits

G2 compiler/generated API (M03/M04); G3b clean external CRM SDK/UI, G4 module/event/upgrade (M05–M08); G5 full GA restoration proof, G6 complete support matrix and G7 independent GA release (M08). Some recovery/compatibility controls are still prerequisites for **any actual deployment**, even when their full GA gates are later. Wave 1 completion does **not** authorize production GA.

## Current proposed owner verdict

**NO-GO**. No High risk accepted, no authorized merge, no production access, no Wave 2. Missing signature fields intentionally blank. Date/deadlines: **before GO**, named calendar deadlines unassigned.

See [approval register](WAVE-01-APPROVAL-REGISTER.md), [gate matrix](WAVE-01-GATE-CLOSURE-MATRIX.md), [integrated evidence](WAVE-01-INTEGRATED-PR-COMMIT-EVIDENCE-REGISTER.md).
