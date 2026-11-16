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
