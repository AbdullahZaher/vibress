# M00-E13 — Actual Developer-Experience Trials

**Status:** TECHNICAL TRIALS EXECUTED for the subset below; no developer interviews, market adoption or competitor measurements were performed. No wall-clock timings are reported.

## Executed trials (observable command evidence)

| Task | What was actually executed | Result | Remaining gap |
| --- | --- | --- | --- |
| DX-08 (bounded subset) | `node scripts/verify-external-consumer.mjs`: `npm pack` of `@vibress/platform-kernel`, extracted tarball installed into a disposable consumer, `tsc --noEmit` against public entry only | PASS; custom `approveDeal` action and `/crm/deals/:dealId/approve` route typecheck; zero private imports | Public registry publication still blocked by A2/G6; private package + TypeScript source entry |
| DX-05/DX-06 | Same external consumer fixture declares custom route and action | Contract and typecheck proof only; no running HTTP server or database | Route execution against real authz pending |
| DX-07 | `tests/architecture/m00-boundary-contract.test.ts`, `packages/tenancy/src/__tests__/lifecycle.test.ts` | 7/7 and 11/11 negative tests pass | Not a browser/DB E2E |
| DX-09 (bounded subset) | `VIBRESS_DRILL_CONFIRM=1 bash scripts/platform/m03/backfill-pitr-drill.sh` | Real PG16 disposable PITR, 9/9 assertions, exit 0 | Not a full CRM deployment |

## Explicitly unmeasured

DX-01 clean checkout, DX-02 privileged-credential-free install, DX-03 identity definition, DX-04 schema declaration, and any measured first-user time or adoption outcome remain **NOT_MEASURED**. They require a real trial with recorded commands and outputs; source presence is not a pass.

## Decision required

A2/G6 package-publication authorization before DX-08 can be measured against a public SDK; a real first-user trial and Agent 06 review before M00-E13 formal closure.
