# FASTIFY CVE-2026-120216 / GHSA-3qgw-9275-xf8w — APPSEC DISPOSITION

> **2026-11-16** · PR #176 baseline `fdcc3986b0b5be26ee57540e55b213f1ddb4cc79` · Status: **CONFIGURATION MITIGATION PROPOSED; EXACT-HEAD CI PENDING; DEPENDENCY REMAINS 5.12.7**.

## Official advisory

Vendor [GHSA-3qgw-9275-xf8w](https://github.com/fastify/fastify/security/advisories/GHSA-3qgw-9275-xf8w) (published **2026-11-02**) and OpenJS [CVE-2026-120216](https://cna.openjsf.org/security-advisories.html) describe Moderate **CVSS 5.9** availability-only DoS for `fastify >=5.8.0 <5.12.8` **when both** (1) nonzero `handlerTimeout` and (2) streaming response are present. The timeout attempts another response after headers, producing an uncaught error. Patch: **5.12.8 or later**. Official workaround: `handlerTimeout: 0`. The default is 0. Route configuration can override the server default (Fastify [Server Reference](https://fastify.dev/docs/latest/Reference/Server/), reviewed 2026-11-16).

## Actual Vibress reachability analysis at pinned SHA

| Component | Observation | Disposition |
| --- | --- | --- |
| `apps/api/src/main.ts` | One reviewed Fastify server constructor without nonzero `handlerTimeout`; media streamed by `apps/api/src/routes/media-stream.ts` through `fs.createReadStream` and `reply.send(stream)` | **Stream exists**, so nonzero timeout would make the affected configuration plausible; **not observed at baseline** |
| `apps/platform-reference/src/server.ts` | Reference Fastify constructor has bodyLimit and logger options, but no nonzero handlerTimeout | Vulnerable path not demonstrated |
| `apps/worker/src/main.ts` | No Fastify constructor in inspected worker entrypoint | No Fastify request service found on that entrypoint; other modules not exhaustively audited |
| Package / lock | `apps/api/package.json`, `apps/platform-reference/package.json` declare `^5.12.7`; `pnpm-lock.yaml` resolves `fastify@5.12.7` | Affected **installed version**, but package version alone does not prove the conditional exploit |

**Assessment:** The two necessary conditions were not simultaneously found in the reviewed serving constructors. Therefore exploitability is **not confirmed**, not globally disproven. Plugins or dynamic per-route Fastify configuration outside scanned source could change the outcome.

## Focused hardening in this review branch

- Set **explicit `handlerTimeout: 0`** in both Fastify constructors without changing other timeouts or routes.
- Add `tests/architecture/fastify-handler-timeout-guard.test.ts`: asserts explicit safe settings and scans the API and reference TypeScript serving source for nonzero/dynamic `handlerTimeout:` property declarations. **Unexecuted until CI**; static source guard does not replace runtime or deployment attestation.
- No lockfile edit performed: tool environment lacks Node 24/pnpm 11 and npm registry access to regenerate a valid `pnpm-lock.yaml` or run install/audit; manually changing a lockfile would be unverified.

## Remaining actions and exit criteria

1. Upgrade both applications' Fastify constraint to `>=5.12.8 <6` (or an approved current patched 5.x) and **regenerate frozen pnpm lock** with the repo's declared toolchain; run `pnpm install --frozen-lockfile`, `pnpm audit --prod --audit-level moderate`, TypeScript, Vitest, API streaming/range tests, WebSocket and browser E2E.
2. Check all built deployment artifacts for resolved Fastify version and the actual server/route timeout; inspect dynamically configured plugins, generated routes and production environment. A plugin-added positive route-level timeout is not guarded by global 0 alone.
3. Run a safe isolated-stream regression (no external endpoint), prove server stays alive under affected timeout combinations on patched package.
4. Attribute evidence to exact final HEAD + image digest and obtain independent review.

**Current risk:** P2 conditional DoS **OPEN/mitigated by configuration, not fully closed**. Never claim version patched, exploitation reproduced, or deployment verified based on this record.

Sources consulted 2026-11-16: [vendor GHSA](https://github.com/fastify/fastify/security/advisories/GHSA-3qgw-9275-xf8w) published 2026-11-02; [Fastify releases](https://github.com/fastify/fastify/releases) lists 5.12.8 released 2026-11-02; [Fastify server options](https://fastify.dev/docs/latest/Reference/Server/), [PostgreSQL 16 RLS](https://www.postgresql.org/docs/16/ddl-rowsecurity.html) as relevant to larger review.
