# M00 — Baseline vs Candidate Regression Evidence

## Controlled comparison

| Run | Source | Runtime | Services | Result |
| --- | --- | --- | --- | --- |
| Original | `ac07c737` (M00 completion candidate) | Node v26.13.0 | PG16 only | 2324 passed / 53 failed / 356 skipped |
| Baseline reproduction | `e44477ca` (pre-increment baseline) | Node v26.13.0 | PG16 only | The two sampled failing files failed identically: `expected 503 to be 200` and `window.localStorage` undefined |
| Candidate, corrected environment | `ac07c737` + test-harness fixes | Node v24.22.3 | PG16 + Redis 7 + S3-compatible + Mailpit | 379 files / 2733 tests passed, exit 0 |

## Method

- The same disposable PostgreSQL database was used for baseline and candidate.
- Two representative failing files were checked out at `e44477ca` and rerun: `tests/security/single-publication-boundary.test.ts` and `apps/admin/src/components/settings/__tests__/ImportExportCard.test.tsx`. Both reproduced the original failure modes, establishing that the failures predate the M00 increment.
- The environment was then corrected (supported Node runtime plus declared disposable dependencies) without changing application source or test assertions.
- The full candidate suite was rerun once as the final milestone-end cycle.

## Changes made to test code

1. `vitest.config.ts`: explicit jsdom origin `http://localhost/` (deterministic Storage origin).
2. `scripts/__tests__/execution-traceability.test.mjs`: the "closure without evidence" test previously mutated `M00-E01`, which now legitimately has a pinned implementation SHA. It now mutates `M01-E01`, an Epic with no pinned SHA. This restores the test's original intent (rejecting unevidenced closure) without weakening the validator.

No application assertion, security check or negative test was disabled, skipped or weakened.

## Conclusion

No actual application regression was found. All original failures are attributable to the unsupported Node 26 runtime and absent disposable services. The one post-remediation failure was a stale test fixture in the evidence validator and was corrected. Final candidate result: **2733/2733 passed**.
