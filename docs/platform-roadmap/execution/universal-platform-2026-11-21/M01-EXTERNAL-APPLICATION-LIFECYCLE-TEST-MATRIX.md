# M01 — External Application Lifecycle Test Matrix (isolated continuation)

**Branch:** `m01-external-consumer-continuation` (isolated; not merged into M00 or `main`).
**Status:** test definitions prepared and the **M01 milestone-end suite executed** (381 files / 2748 tests passed). The `NOT EVIDENCED` rows below refer only to *runtime* lifecycle/installation operations that belong to later milestones (M05/M08), not to the completed M01 unit/contract suite. No production activation is claimed.

| Lifecycle step | Test intent | Current evidence | Status |
| --- | --- | --- | --- |
| Public contract import | Consumer imports only `@vibress/platform-kernel` | `examples/external-crm-consumer/src/app.ts`; negative fixtures in `tests/architecture/m01-external-consumer-negative.test.ts` | Test defined |
| Application definition | Branded app identity, versioned manifest | same fixture | Test defined |
| Custom route | Member-authenticated CRM route | same fixture | Test defined |
| Custom action | Transactional `approveDeal` action contract | same fixture | Test defined |
| Private import refusal | Private workspace paths, DB/config adapters, Fastify and relative siblings are refused | negative fixtures | Test defined |
| Registry digest | Persisted manifest digest and drift refusal | existing M03-registry contracts (frozen) | Preserved, not re-opened |
| Install / activate / deactivate / upgrade | Lifecycle ledger with crash-safe transitions | **NOT EVIDENCED** | Requires M05 Wave gate |
| Production application hosting | Explicitly out of scope | — | NOT AUTHORIZED |

The negative fixtures validate only boundary rules. They do not start a server, contact a database, publish a package or enable unsupported hosting. Full M01 acceptance requires the milestone-end suite after integration and authorization.
