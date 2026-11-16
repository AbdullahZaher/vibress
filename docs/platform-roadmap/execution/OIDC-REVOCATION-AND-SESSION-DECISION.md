# OIDC-REVOCATION-AND-SESSION-DECISION

Status: RECOMMENDATION ONLY, not a signed security risk acceptance (2026-11-16).

Recommend short-lived signed RFC 9068 access tokens (initial pilot upper bound 15 minutes, subject to IdP owner agreement); require authoritative per-request revocation/session status check and fail closed on negative/unavailable decisions. Re-query server membership for each action; tenant membership revocation must never depend solely on JWT expiry. Existing offline candidate accepts no optional bypass for revocation.

Browser flows if authorized: authorization-code + PKCE, state/nonce validation, server-side opaque session with Secure/HttpOnly/SameSite cookie, CSRF, inactivity and absolute limits, refresh rotation/reuse detection, logout invalidation and audit. Do not store access tokens in localStorage. Define MFA, stolen session response, service credentials and emergency global logout separately.

Operations: bounded JWKS cache, trusted issuer-pinned fetch, no redirects/SSRF, private-network deny, size/time limits, rotation overlap drills, fail closed on key retrieval expiry. Monitor revoked tokens, repeated tenant failures, key misses, provider outage, revocation latency, anomalous sessions. Never log raw credentials or tokens. Define explicit identity-session RPO/RTO, incident procedures and tested rollback before activation.

PENDING OWNER/IDP DECISIONS: issuer/client/audience, introspection or revocation endpoint SLA, token lifetime, emergency key disable, membership freshness, test identities, logout/refresh behavior, session store availability, MFA and service identity profile. These cannot be invented or approved by implementer.

Source review 2026-11-16: https://csrc.nist.gov/pubs/sp/800/63/b/4/final ; https://www.rfc-editor.org/rfc/rfc9068.html ; https://www.rfc-editor.org/rfc/rfc8725.html
