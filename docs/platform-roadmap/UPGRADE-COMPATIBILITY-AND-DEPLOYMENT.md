# Application/Schema/Module Rolling Upgrade & Compatibility Matrix

> **Proposed operational contract, not a verified automatic rollback mechanism.** Existing [release strategy](../14-decisions/release-versioning-strategy.md) and [Plugin Platform upgrade ledger](../08-plugins/plugin-platform-master-execution-plan.md) remain authoritative for their historical status.

## Definition of compatibility windows

A deployed application includes **application source version**, **Framework API/runtime version**, **Plugin SDK/ABI**, **module graph and binary digest**, **database schema/migration epoch**, **API/OpenAPI contract version**, **event-envelope version**, **API and worker artifact digests**, and **web client build**. A release is promotable only if their compatibility relationships are explicitly documented and tested.

| Pair under mixed deployment | Mandatory test |
| --- | --- |
| API old + DB schema expanded | Old operations still return valid behavior with new nullable/additive fields |
| API new + DB schema expanded | New endpoints operate under same permission policies |
| Worker old + producer new | New events either deserialize compatibly or are held/rejected safely, never silently corrupted |
| Worker new + producer old | Replay/idempotent handling and schema-version compatibility proven |
| Web client old + API new | Version negotiation, auth/session and cache behavior tested |
| Web client new + API old | Version mismatch reported; no corrupt writes or bypass |
| Module N + runtime SDK ABI N±1 | Explicit compatibility contract or safe admission rejection |
| Two installer processes / backfill workers | Idempotent locks, no duplicated DDL or partial backfill corruption |

## Release phases

1. **Inventory and preflight:** audit current schema version, data volume, DB privileges, active jobs, SDK/app/module graph, backups and support window.
2. **Expand:** review/approve additive schema and compatibility adapters; apply through distinct installer with lock/timeout and independent rollback/forward-fix.
3. **Deploy compatible code:** roll API/worker/web versions while old and new coexist; maintain supported event and query shapes; monitor effective role grants.
4. **Backfill and validate:** bounded/observable/idempotent migration batches, ownership checks, progress and stop/resume behavior.
5. **Contract:** remove old fields/routes only after all old clients and workers are retired and references/backups understood; mark irreversibility and risk sign-off.
6. **Observe/restore:** monitor data consistency and service SLOs; prefer forward-fix for destructive changes; test backup restore with measured RPO/RTO.

## Abort and recovery invariants

- A rollback to prior application code is permitted **only** while the DB schema remains compatible with the prior runtime and event contracts. Otherwise **stop rollout/forward-fix** or restore with disclosed data-loss risk.
- Migration/installer authorization is separate from app-server HTTP credentials; any permission error during rollout aborts activation.
- A stuck schema migration, dead-letter event, shadowed `SECURITY DEFINER` helper, concurrent installer or old worker replay is a defined fault scenario with owner and stop/go rule.
- Release gate is based on a tested compatibility matrix for the supported deployment topology, not on the theoretical reversibility of every migration.

## Explicit evidence requirements

Publish source/runtime/API/worker/DB/module digests, supported version matrix, migration-plan SHA, signed approval, rollback/forward-fix artifacts, two-installation cross-boundary tests and staging recovery measurements. M03/M05/M06/M08/M11 reference this checklist. No zero-data-loss guarantee for arbitrary schema downgrades.
