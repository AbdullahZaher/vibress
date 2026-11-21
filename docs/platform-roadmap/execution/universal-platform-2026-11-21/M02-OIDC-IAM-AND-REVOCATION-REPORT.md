# M02 — OIDC, IAM and Revocation Report

- Existing offline OIDC verifier contract and static-token fail-closed gate were preserved; no bypass was added.
- `pub_default` is rejected for platform identities; server-verified scope requires application, tenant, principal and membership agreement.
- New authorization decisions bind principal, tenant, application, policy version and membership version; stale versions are denied.
- Explicit `deny:*` permissions override allows; missing permissions default-deny.
- Live OIDC discovery/JWKS/key rotation, real IdP administrator environment and production revocation remain **PENDING** pending an authorized IdP owner. No production-ready identity integration is claimed.
