# W1-T07 — Production identity provider adapter — authorization request

> **Status: BLOCKED for production wiring — awaiting an identity-provider
> administrator and the security review owner.** No token, client registration,
> session cookie or IdP configuration has been created. The offline verification
> contract is implemented and tested without network access
> (`apps/platform-reference/src/oidc-principal-verifier.ts`, 21 tests), but it
> is **not wired into the serving process**. The current bearer directory is a
> reference adapter and is not production authentication; it is now refused in
> a production-shaped process and when any other auth mode is requested.
>
> **Implemented 2026-11-15 (offline only):** algorithm allowlist (RS256/ES256),
> strict `kid` lookup against a static JWKS snapshot, signature verification,
> `iss`/`aud`/`exp`/`nbf`/`iat` with bounded skew, required `sub`, application
> and installation binding claims, deterministic principal-id derivation, and
> no trust in tenant/role/permission claims. Undecided and therefore not
> implemented: JWKS fetching/rotation, revocation semantics, cookie/session
> flow, and live membership integration.

## Current state (measured)

- `apps/platform-reference/src/token-directory.ts` maps operator-supplied
  bearer tokens to a server-resolved principal. Tokens are compared by SHA-256
  digest with `timingSafeEqual`; the principal is not trusted from the token
  payload.
- `apps/platform-reference/src/server.ts` reads `Authorization: Bearer …` per
  request. There is no signed token, issuer, audience, expiry, key rotation,
  revocation, cookie or session.
- The directory is loaded from `PLATFORM_REFERENCE_TOKENS` at boot; rotation
  requires a restart, and there is no revocation API.
- Membership and permissions are already resolved server-side
  (`PlatformMembershipResolver` and the tenancy policy engine), which is the
  correct shape for an IdP adapter.

## Requested authorization

| Item | Request |
| --- | --- |
| IdP | A non-production tenant in the organization's identity provider (or a disposable local provider) with OIDC discovery |
| Client registration | One confidential client with a fixed audience for the platform reference application, plus a test public client if a browser cookie flow is required |
| Claims | Issuer, audience, `sub`, `exp`, `nbf`, `iat`, `kid`, and an application/installation binding claim agreed by the security owner (for example `vib_application_id`) |
| Revocation | Either an introspection endpoint or an agreed short access-token TTL plus a revocation signal; the decision is the security owner's |
| Test principals | Three test users: member of test tenant A, member of test tenant B, and a user with no membership |
| Secrets | Client secret and any introspection credential delivered out-of-band, never committed; a `.env` name will be agreed before use |
| Owners | IdP administrator + security review owner must approve before any implementation is exercised against the provider |

## Proposed implementation (after approval)

1. **`OidcPrincipalVerifier`** in `apps/platform-reference/src/`:
   - fetch and cache JWKS from the issuer with a bounded TTL and `kid` lookup;
   - accept only the configured algorithms (RS256/ES256); reject `none`, HMAC
     and unknown keys;
   - verify signature, `iss`, `aud`, `exp`, `nbf` and `iat` with a small clock
     skew;
   - require the application binding claim to equal the application id and the
     installation binding claim to equal `PLATFORM_INSTALLATION_ID`;
   - derive the principal id from `sub` only after verification; never from a
     caller-supplied body or header.
2. **Principal resolution** stays server-side: membership is read through the
   membership reader for `(application, principal)`; disabled membership yields
   401/403; permissions come from the policy engine and the membership record,
   not from token claims.
3. **Revocation**: introspection or deny-list according to the owner's choice,
   checked before the request handler runs and failing closed if the revocation
   service is unreachable.
4. **Cookie/session (only if the browser flow is in scope)**: an
   `HttpOnly`, `Secure`, `SameSite=Lax` cookie carrying an opaque session id,
   server-side session storage, CSRF token, and logout that revokes the session.
   No token is stored in `localStorage`.
5. **Reference-only status**: the static directory stays selectable only behind
   an explicit `PLATFORM_AUTH_MODE=reference` and is refused when
   `PLATFORM_AUTH_MODE` is absent in production-shaped runs.

## Deny matrix to be proven

| Case | Expected |
| --- | --- |
| Valid token, membership in tenant A | 200, only tenant A rows |
| Valid token, membership in tenant B | 200, only tenant B rows |
| Valid token, no membership | 403 |
| Tampered signature / unknown `kid` | 401, no handler call |
| Wrong issuer | 401 |
| Wrong audience | 401 |
| Expired / `nbf` in the future | 401 |
| `alg: none` or HS256 token signed with the public key material | 401 |
| Application binding claim missing or different | 401 |
| Installation binding claim different | 401 |
| Membership disabled during the token lifetime | 403 |
| Revoked token (introspection or deny-list) | 401 |
| Revocation service unavailable | 503/401 fail closed, never allow |
| Cookie flow: missing CSRF token | 403 |
| Cross-tenant request with tenant A token | 403/404, no data disclosure |

## Risks and limits

| Risk | Mitigation |
| --- | --- |
| JWT library/key-confusion bugs | Algorithm allowlist, explicit `kid` lookup, no `jwt.decode` trust, negative tests above |
| Token replay after revocation | Introspection or short TTL plus deny-list, decided by the security owner |
| Session fixation | Rotate session id on login, server-side storage, logout invalidation |
| IdP lock-out during tests | Separate test tenant and test client; production client untouched |
| Secret leakage | Out-of-band delivery, never committed; scanner check before push |
| The reference app is not the production gateway | This adapter proves the platform contract; the organization's gateway still needs its own review |

## Exit criteria

1. Adapter committed with the deny matrix above as executable tests against the
   approved IdP tenant (or a pinned local provider image). **Partially met:**
   the offline deny matrix runs with generated RSA/EC keys and a static JWKS;
   no live provider is exercised.
2. Revocation semantics accepted in writing by the security owner. **Open.**
3. Reference token mode cannot be enabled in a production-shaped configuration.
   **Met at boot:** `assertReferenceAuthenticationMode` refuses reference mode
   when `NODE_ENV=production` or `PLATFORM_ENVIRONMENT` is production-shaped,
   and refuses `PLATFORM_AUTH_MODE` values other than `reference`; a spawned
   process is proven to stop before reading any database URL.
4. No secret appears in git history or logs. **Met for this increment:** tests
   generate ephemeral keys in memory and commit no secret.

The adapter still cannot be certified until the IdP owner supplies the issuer,
client, claims, revocation choice and live test principals.

Until then W1-T07 remains **Pending — blocked by authorization**, and Wave 1
remains **NO-GO**.
