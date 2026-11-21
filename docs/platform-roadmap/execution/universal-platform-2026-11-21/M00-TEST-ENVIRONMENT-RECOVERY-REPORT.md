# M00 — Test Environment Recovery Report

**Status:** RECOVERED and reproduced. No production service, credential or shared database was used or modified.

## Root causes removed

1. **Runtime mismatch:** tests ran under Node v26.13.0 while the repository declares `>=24.0.0 <25`. Node 26 exposes a global `window.localStorage` getter backed by `internal/webstorage`; it shadows jsdom's `Storage`, so `window.localStorage` was `undefined`. Switching to Node v24.22.3 restored jsdom behavior with no assertion changes.
2. **Missing disposable dependencies:** the earlier run had only PostgreSQL. API tests require Redis (rate limits, auth throttling, frame tickets) and S3-compatible storage; absent services produced HTTP 503, `MaxRetriesPerRequestError` and hook timeouts.
3. **Opaque jsdom origin:** `vitest.config.ts` now sets `environmentOptions.jsdom.url = "http://localhost/"`, giving jsdom a non-opaque origin for deterministic Storage behavior.

## Provisioned disposable stack

| Service | Image / version | Host port | Config source | Disposable |
| --- | --- | --- | --- | --- |
| PostgreSQL | `postgres:16-alpine` | 15433 (override `DATABASE_URL`) | `.env.example` semantics | named container, removed after verification |
| Redis | `redis:7-alpine` (digest `sha256:7f7d30b7…`) | 127.0.0.1:6380 | default `REDIS_URL` | named container |
| S3-compatible | `pgsty/silo@sha256:635197cb…` | 127.0.0.1:9000/9001 | `S3_ENDPOINT` defaults, `minioadmin` test credentials | named container |
| Mailpit | `axllent/mailpit:v1.26` (digest `sha256:07975902…`) | 127.0.0.1:1025/8025 | test mail sink | named container |

Port 5433 (the default compose PostgreSQL port) is occupied by an unrelated `ruxbase_db` container, so the disposable database used 15433 and `DATABASE_URL` was overridden locally. No repository configuration was changed to point at any shared or production service.

## Readiness and cleanup

- Containers were started with explicit names (`vibress_t_pg`, `vibress_t_redis`, `vibress_t_minio`, `vibress_t_mail`) and verified running before the suite.
- Global test setup applied migrations and seeds to the disposable database only.
- All four containers were removed after the final verification run.
- No test credentials were written to tracked files or CI logs.

## Reproduction command

```sh
PATH="$HOME/.nvm/versions/node/v24.22.3/bin:$PATH" \
DATABASE_URL=postgresql://vibress:vibress@localhost:15433/vibress \
pnpm test:unit
```

Result: `379 passed (379)` test files, `2733 passed (2733)` tests, exit 0.

## Scope note

This report establishes a reproducible *local disposable* environment. It does not by itself change the repository's CI workflow to provision these services. The application source was not modified to obtain these results; the only tracked changes are the jsdom origin option and a stale ledger-test assertion (see regression evidence).
