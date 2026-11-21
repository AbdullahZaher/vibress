# M00-E13 — CRM Developer Adoption Baseline

**Status:** BASELINE DEFINED; no adoption trial has been executed. **No interviews, first-user outcomes, wall-clock timings or competitor measurements are claimed.**

This document defines the measurable first-user task script and the clean-install success criteria for a developer building a CRM from VIBRESS. It is a measurement instrument, not an adoption result.

## Scope and non-goals

- Scope: observable, repeatable steps a developer must complete, with a success criterion and the repository evidence that would prove it.
- Non-goals: adoption percentages, burndown, invented interview quotes, competitor benchmarks, release authorization, production access.
- All task statuses are `NOT_MEASURED` unless independently verified in a real trial. `DX-08` is `BLOCKED`: all 70 workspace packages are currently `private: true` and export TypeScript source, so a genuinely packed public consumer requires the A2/G6 package-publication decision.

## First-user task script

| ID | Task | Success criterion | Evidence | Status |
| --- | --- | --- | --- | --- |
| DX-01 | Bootstrap from a clean checkout | Fresh clone installs with pinned Node/pnpm and no source edits | `package.json` engines, `pnpm-workspace.yaml` | NOT_MEASURED |
| DX-02 | Install without privileged credentials | Install succeeds with no `DATABASE_URL` or owner password | `.env.example`, `scripts/provision-platform-roles.ts` | NOT_MEASURED |
| DX-03 | Define an application with branded identity | `defineApplication` compiles with explicit identities and rejects `pub_default` | `packages/platform-kernel/src/identity.ts` | NOT_MEASURED |
| DX-04 | Declare a CRM resource schema | Versioned declaration compiles to deterministic IR without arbitrary SQL | `packages/schema-engine/src` | NOT_MEASURED |
| DX-05 | Expose a custom HTTP route | Member-authenticated custom route returns the declared action result | `apps/platform-reference/src/application.ts` | NOT_MEASURED |
| DX-06 | Execute a custom action in tenant scope | One transactional CRM change; cross-tenant principal denied | `packages/tenancy/src/scope.ts` | NOT_MEASURED |
| DX-07 | Run tenant/authorization negative tests | Spoof, revoked membership and missing permission fail closed | `tests/security/`, reference app tests | NOT_MEASURED |
| DX-08 | Package and install public contracts externally | Packed public package installs cleanly and exports typed contracts | package private flags, M01-E09 | **BLOCKED** |
| DX-09 | Deploy to isolated nonproduction | Same pinned artifact boots with separate DB/Redis/S3 identities | `compose.dev.yml`, `scripts/platform/resource-isolation` | NOT_MEASURED |

## Clean-install success criteria

1. Clone a clean checkout at a pinned commit; no manual edits to tracked files.
2. Install with the declared Node/pnpm versions and no privileged environment variables.
3. Typecheck and run the unit suite without disabling or skipping tests.
4. Boot a CRM application from exported public contracts only; zero imports from private workspace paths.
5. Exercise one member route and one custom action in a verified tenant scope.
6. Confirm the negative cases fail closed.
7. Record the exact commit, tool versions, command list, pass/fail counts and any skip reason.

A criterion is satisfied only when its evidence is a real command output or test log at a pinned SHA. Source presence alone is not a pass.

## Reproducible benchmark harness

`scripts/platform/dx/crm-adoption-baseline.mjs` exposes:

- `ADOPTION_TASKS` — the machine-readable task script above.
- `validateBaseline(tasks)` — fails duplicates, empty criteria, illegal statuses or invented metrics.
- `measureLocalReadiness(repoRoot)` — deterministic filesystem facts only: application/package counts, private/public package counts, build-script and TypeScript-entry counts, kernel export count, reference-app action/route counts, migration count, and whether a packed public consumer is currently possible.
- `renderReadinessJson(readiness)` — stable JSON output.

Run locally with:

```sh
node --input-type=module -e 'import {ADOPTION_TASKS,measureLocalReadiness,renderReadinessJson} from "./scripts/platform/dx/crm-adoption-baseline.mjs"; console.log(JSON.stringify(ADOPTION_TASKS.map(t=>t.id))); console.log(renderReadinessJson(measureLocalReadiness(process.cwd())));'
```

Measured fields describe source structure only. `adoptionTrialsMeasured` is `false` and `wallClockMeasurements` is `NOT_MEASURED` until a real, recorded trial is performed.

## Benchmark methodology (when a trial is actually run)

Record: exact repo SHA and tree, OS/architecture, Node and pnpm versions, PG/Redis versions, clean workspace path, command list, step boundaries, pass/fail status, retries, and artifact digests. Run at least three independent clean installs before reporting any timing; never extrapolate from source counts. Compare against external products only with separately cited, reproducible methodology — no numbers are present here.

## Blockers and next decision

- **A2/G6 packaging decision** is required before DX-08 can become measurable.
- Agent 06 independent review and a real first-user trial are required before M00-E13 can be formally closed.
