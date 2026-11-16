# W1-T07-PRODUCTION-IDENTITY-ARCHITECTURE

Review date: 2026-11-16. Status: OFFLINE CANDIDATE; NO LIVE PROVIDER; NO PRODUCTION APPROVAL.

## Baseline
Original PR #166 code reviewed at a96ea073767e303b02121d87558adbd12ce111f3. OidcPrincipalVerifier supports static JWKS RS256/ES256, kid, signature, issuer, audience, exp/nbf/iat, sub and app/install binding and derives issuer+sub principal ID, with no token-granted roles/tenants. Reference server still uses static ReferenceTokenDirectory; topology.ts refuses reference static auth in production-shaped environments.

## Integration finding IAM-01 (HIGH)
Verifier deliberately emits tenantIds=[] while tenancy/scope.ts verifyTenantScope requires requested tenant in principal. Connecting verifier directly causes a 403 for valid members. New ProductionOidcAuthenticationAdapter checks membership via the server-owned ScopeResolver, hydrates only the verified requested tenant, then requires RouteExecutor to recheck live membership, policy and DB/RLS transaction. No token tenant/role/permission claims are trusted.

## Proposed approved flow
1. IdP administrator approves nonproduction exact HTTPS issuer, OIDC discovery metadata, JWKS URL, API resource audience, OAuth client registration and app/install claims.
2. Gateway requires signed RFC 9068 at+jwt access token (not OIDC ID token). Strict asymmetric alg allowlist, exact client_id and audience, no embedded/referenced JOSE keys, bounded token lifetime. Offline OidcPrincipalVerifier remains unchanged.
3. ApprovedJwksSource supplies only issuer-pinned signing keys with bounded response size/timeouts, no redirect/SSRF or unapproved endpoint; adapter caches for at most configured TTL (default 300s), rate-limits unknown-kid refresh and fails closed after cache expiry if unavailable. The real transport is intentionally not implemented without IdP authorization.
4. RevocationAuthority checks authoritative token/session activity per authentication attempt, hard-denying on outage. External account disable signals/TTL must also be validated with IdP. No raw tokens in logs.
5. The platform membership reader must return an active matching application/principal/tenant membership; RouteExecutor must recheck membership permissions and policy. Service principals must use a distinct credential profile, audience, principal kind and privilege contract.
6. Browser auth only after separate authorization: authorization-code+PKCE, state/nonce, opaque server session cookie (Secure/HttpOnly/SameSite), CSRF checks, refresh rotation and logout invalidation.

## Limits / GO gates
Candidate module is deliberately not imported into main.ts, start.ts or server.ts; reference-only gate is untouched. No live issuer or client, fetch transport, session store, OAuth callback, provider tests, runtime wiring or production secrets exist. Approval requires exact-head CI, live tenant A/B/no-member and service negatives, key rotation/outage, revocation/disabled-user exercise, Agent 03 verdict, Agent 06 independent concurrence and final project-owner decision. Until then W1-T07 BLOCKED, Wave 1 NO-GO.

## Primary sources checked 2026-11-16
https://www.rfc-editor.org/rfc/rfc8725.html (2020)
https://www.rfc-editor.org/rfc/rfc9068.html (2021)
https://openid.net/specs/openid-connect-discovery-1_0.html (2023)
https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/ (2023)
https://csrc.nist.gov/pubs/sp/800/63/b/4/final (2025)
