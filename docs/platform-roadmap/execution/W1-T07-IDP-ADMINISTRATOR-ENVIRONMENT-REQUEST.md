# W1-T07 — Exact IdP Administrator and Environment Request

Status: NOT AUTHORIZED — request for APPROVED NONPRODUCTION ENVIRONMENT only. 2026-11-16.

Requested approvals, to be recorded by named IdP administrator and security review owner:
1. Explicit approved nonproduction issuer (HTTPS exact URL), OIDC discovery and issuer-matching jwks_uri, pinned trusted host and network egress limits. Provide no secrets in GitHub.
2. Dedicated API audience and OAuth registered client_id; approve RFC 9068 at+jwt signed RS256/ES256 profile. Signed iss/aud/sub/exp/iat/nbf (if present), client_id, vib_application_id and vib_installation_id, with optional azp restrictions. Provide environment-specific app/installation values.
3. Key rotation schedule, TTL, incident key removal/rollback, JSON size and request timeout, TLS/redirect/SSRF policy.
4. Authoritative revocation/session status service and SLA with outage fail-closed semantics; supply scoped credentials exclusively via secret manager and time-limited access.
5. Test identities: members of tenant A and tenant B, user with no membership, removed principal, revoked member, disabled session, and separate service identity only if needed. No real PII.
6. Browser redirect URI, code+PKCE, state/nonce, cookie, CSRF, refresh, MFA and logout requirements if browser flow is in scope.
7. Named approvers, change ticket, approved expiry, environment/digest and signed evidence for key rollover, provider outage, and cross-tenant denial.

No production secret issuance, privilege expansion, mode switch, deployment or acceptance is permitted by this request. Require independent Agent 06 concurrence and owner GO after complete gates. Until then W1-T07 remains BLOCKED.

Sources checked 2026-11-16: https://openid.net/specs/openid-connect-discovery-1_0.html ; https://www.rfc-editor.org/rfc/rfc9068.html
