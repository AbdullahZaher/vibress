# Existing Vibress Assets — Reuse and Traceability

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

The master roadmap must reuse *actual* existing work and preserve *historical* progress, without treating proposals as shipped features.

| Existing subsystem | New ownership / target | Caution |
| --- | --- | --- |
| Content Modeler and Drizzle relational schema | M01/M03 schema DSL and data adapter | currently publication-scoped; not universally app-owned |
| Users, roles and permission services | M02 policy and principal adapters | resource-level generated authorization still required |
| Publication isolation and composite FKs | M02 baseline compatibility | RLS not currently activated per security review |
| Plugin SDK, operator lockfile and signed release admission | M05 trusted module runtime | trusted ESM has Node process privileges |
| Plugin upgrade plans and preflight | M05 staged execution/restore | preparatory plan is not completed automated upgrade lifecycle |
| BullMQ and transactional outbox | M06 durable commands/jobs | must verify same transaction and idempotent effects |
| Billing, plans, subscriptions | M06 reusable entitlements/provider adapters | CMS member plans not all SaaS entitlements |
| Vibress Studio Lexical/renderer | M00 baseline + M09 reusable editor controls | Lexical content doc is not app visual layout schema |
| Docker Compose/API/Worker/observability | M08/M11 release & operations | cloud deployment/control plane not yet implemented |

## Current authoritative source documents

- [Existing architecture](../01-architecture/overview.md), [dependency rules](../01-architecture/dependency-rules.md).
- [Publishing implementation phases](../13-roadmap/implementation-phases.md).
- [Plugin platform v3 roadmap](../08-plugins/plugin-platform-master-roadmap-v3.md) and [execution ledger](../08-plugins/plugin-platform-master-execution-plan.md).
- [Plugin trust model](../14-decisions/plugin-trust-model.md).
- [Security review](../../SECURITY-REVIEW.md).
- [Studio readiness source](https://github.com/AbdullahZaher/vibress-studio/blob/main/docs/production-readiness.md).

This plan adds master milestones M00–M12; legacy Plugin Platform M0–M6 stays unchanged. PRs crossing repositories must pin both host and Studio candidate SHAs and validate real host persistence and rendering.
