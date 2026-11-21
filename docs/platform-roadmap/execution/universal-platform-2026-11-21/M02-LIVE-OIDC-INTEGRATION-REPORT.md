# M02 — Live OIDC/JWKS Integration Report

Implementation: `apps/platform-reference/src/oidc-live-integration.test.ts`.
Environment: disposable local OIDC provider built on `node:http` on 127.0.0.1, serving OIDC discovery and JWKS over real HTTP; RS256 keys generated in-process; no production IdP contact or secret.

| Assertion | Result |
| --- | --- |
| Discovery + JWKS over real HTTP | PASS |
| Signed token verified into a server-derived principal id | PASS |
| Wrong issuer / audience / app binding / installation binding | PASS denied |
| Expired / not-before | PASS denied |
| Unknown key / algorithm allowlist / forged signature | PASS denied |
| Key rotation: retired key refused | PASS |
| Real HTTP application path 200 / forged token 401 | PASS |

6/6 tests pass. Limitation: this is a locally controlled disposable provider exercising the real verifier contract, not an organization-specific IdP deployment; that production IdP authorization remains PENDING (M02-E01). Worker identity path remains contract-level via signed envelopes.
