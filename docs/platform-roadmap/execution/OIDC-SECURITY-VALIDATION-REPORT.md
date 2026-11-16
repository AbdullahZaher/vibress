# OIDC-SECURITY-VALIDATION-REPORT

Date: 2026-11-16. Classification: AI-assisted technical candidate review, NOT a human approval.

## Evidence and limitations
Inspected baseline PR #166 at a96ea073767e303b02121d87558adbd12ce111f3: oidc-principal-verifier.ts/.test.ts, token-directory.ts, topology.ts, server.ts, start.ts, database PlatformMembershipResolver, tenancy scope.ts and executor.ts. Existing verifier file has 21 test declarations; the tests have NOT been executed in this assessment. New candidate tests are supplied but MUST be run and re-attested against its exact commit via CI. No approved live provider, tenant, JWKS, session infrastructure or credentials; no live tests performed. No production wiring or migrations changed.

## Findings
IAM-01 HIGH / confirmed code incompatibility: offline verified principal has empty tenantIds; tenant scope guard requires membership in principal. New candidate checks server membership and hydrates only a verified tenant. Independent integration required.
IAM-02 HIGH / production authorization gap: no approved issuer, resource audience, client, secrets or revocation/session contract. Block production. Verify exact signed provider request and tests.
IAM-03 MEDIUM / token confusion: baseline verifier does not enforce access-token typ, client_id or single intended resource audience. Candidate adds strict RFC 9068 profile; use dedicated client and disallow ID token reuse.
IAM-04 MEDIUM / key rotation: static JWKS cannot track production kid changes; candidate adds injected bounded snapshot cache and refresh, but the approved secure network transport has not been supplied. Verify outage, key rollover and forced removal in IdP test environment.
IAM-05 MEDIUM / account/session lifecycle: no browser session, logout, refresh rotation or user-disable propagation; requires owner decision, implementation and evidence.

IAM-06 MEDIUM / conditional dependency advisory: pnpm-lock.yaml on the candidate pins fastify@5.12.7. CVE-2026-120216 (GHSA-3qgw-9275-xf8w; published 2026-11-02) affects Fastify 5.8.0 through 5.12.7 if a nonzero handlerTimeout and streaming response coincide; fixed in 5.12.8. No exploitability assertion is made for platform-reference (its Fastify constructor does not configure a nonzero handlerTimeout). Agent 03 must confirm actual deployment config and schedule lockfile upgrade/retest; no dependency update in Agent 05 scope. Source: https://osv.dev/vulnerability/CVE-2026-120216 (checked 2026-11-16).

## Offline deny matrix — tests authored, EXECUTION PENDING
- malformed/invalid signature/alg/kid, wrong issuer/audience, exp/nbf/iat, application/installation -> reject.
- ID token typ, JOSE crit/jku/x5u/jwk/b64/cty, wrong client_id/azp, multi-audience and excess token lifespan -> reject.
- Unknown or disabled tenant membership, cross-installation context, revoked token, revocation failure, membership outage -> reject before handler.
- Compromised/unknown kid cannot force unlimited refresh. Expired JWKS + source outage -> reject without stale-key acceptance.
- Only active server-verified tenant is returned; token roles and permissions ignored; verifyTenantScope must re-read membership.

## Pending verification
[ ] Run new Vitest file and repo typecheck/lint, report exit codes and commit SHA.
[ ] Run RLS tenant isolation/integration tests at exact candidate HEAD.
[ ] Negative live IdP fixtures: user A, B, no membership, removed user, invalid client, rotated kid, compromised session.
[ ] Agent 03 and Agent 06 independent written reviews with explicit commit SHA.
[ ] Release authority review; never self-certify.

References checked 2026-11-16:
https://www.rfc-editor.org/rfc/rfc8725.html
https://www.rfc-editor.org/rfc/rfc9068.html
https://openid.net/specs/openid-connect-core-1_0-errata2.html

## AG06-04 follow-up — 2026-11-16 (candidate head after patch)
- VERIFIED BY CODE INSPECTION: integration PR #176 head 63c47b3adda183d816727edc7b590979b2a8c2da contains the original candidate adapter blob ab5641ab4ce665744a4d75e23bb3e600a78848f0. It checks server membership and hydrates only that tenant; RouteExecutor separately invokes resolveVerifiedScope and checks membership permission + policy before a tenant transaction. Reference production auth-mode guard remains fail-closed.
- REMEDIATION ON PR #173 ONLY: added RFC 9068 mandatory jti validation and missing/malformed jti negatives; added post-auth membership-removal and principal-binding mismatch regression tests. The original #176 integrated copy does NOT contain these later changes until the integration owner incorporates the new #173 head and reruns CI.
- IAM-07 MEDIUM: RFC 9068 requires jti; initial candidate did not enforce it. Patch added. jti presence alone does NOT prevent bearer replay; sender-constrained tokens or authoritative per-session replay/revocation policy must be approved and verified.
- AG06-04 residual HIGH: no actual HTTP gateway integration, no executable RouteExecutor + real DB negative suite run on the integrated candidate, no live IdP, no independent Agent 06 verdict on the amended SHA. Candidate tests are authored but execution is NOT VERIFIED.
- Coordination: Agent 02 to verify reader role only has effective SELECT on platform_memberships including inherited/default privileges and RLS; Agent 04 to verify dedicated nonproduction service identity, secret-manager delivery, egress, JWKS cache/outage and rollback; Agent 03 to independently threat-model JWT confusion, account disable and cross-tenant boundaries. No signatures inferred from comments.
- Verification commands: pnpm exec vitest run apps/platform-reference/src/oidc-principal-verifier.test.ts apps/platform-reference/src/production-oidc-authentication-adapter.test.ts ; pnpm --filter @vibress/platform-reference typecheck ; pnpm --filter @vibress/platform-reference lint ; execute tenant integration tests and inspect exit codes on exact SHA.
- Additional primary source checked 2026-11-16: RFC 9068 section 2.2 requires jti: https://www.rfc-editor.org/rfc/rfc9068.html .
