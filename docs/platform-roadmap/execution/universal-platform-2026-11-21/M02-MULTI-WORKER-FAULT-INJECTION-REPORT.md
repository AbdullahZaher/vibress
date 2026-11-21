# M02 — Multi-Worker Fault Injection

**Status: NOT EXECUTED for the new atomic candidate.** No disposable PostgreSQL/Redis/BullMQ processes were run in the authoring environment. The historical BullMQ 9/9 result used file-backed replay state and is **not** proof of multi-process idempotency.

Candidate: draft [PR #217](https://github.com/AbdullahZaher/vibress/pull/217) adds an unactivated SQL receipt helper and transaction-mock tests; **those tests were not run**.

## Required real execution matrix

| # | Scenario | Result |
|---|---|---|
| 1 | Two workers deliver same operation concurrently | NOT EXECUTED |
| 2 | Ten concurrent duplicates | NOT EXECUTED |
| 3 | Separate independent Worker processes | NOT EXECUTED |
| 4 | Same nonce with changed payload digest | NOT EXECUTED |
| 5 | Same nonce, different application | NOT EXECUTED |
| 6 | Same nonce, different tenant | NOT EXECUTED |
| 7 | Same nonce, different installation | NOT EXECUTED |
| 8 | Crash before PostgreSQL COMMIT | NOT EXECUTED |
| 9 | Crash after COMMIT | NOT EXECUTED |
| 10 | Crash before BullMQ ack | NOT EXECUTED |
| 11 | Redis reconnect | NOT EXECUTED |
| 12 | PostgreSQL connection loss during COMMIT | NOT EXECUTED |
| 13 | Unknown COMMIT reconciliation | NOT EXECUTED |
| 14 | Delayed delivery after membership revocation | NOT EXECUTED |
| 15 | Retry after process restart | NOT EXECUTED |
| 16 | Dead-letter replay after repair | NOT EXECUTED |
| 17 | Retention boundary | NOT EXECUTED |
| 18 | Forged HMAC | NOT EXECUTED |
| 19 | Invalid application/installation binding | NOT EXECUTED |
| 20 | Expired or revoked signing key | NOT EXECUTED |

## Test evidence required for each case

Record worker count/process IDs, environment versions, initial SQL state, installation/application/tenant/principal, immutable operation ID, payload digest, fault timing, transaction outcome, committed effect count, queue state, database receipt, audit attribution, raw logs, artifact SHA-256 and command exit status. **No values are invented here.**

**Decision:** BLOCKED; no runtime or distributed reliability certificate.
