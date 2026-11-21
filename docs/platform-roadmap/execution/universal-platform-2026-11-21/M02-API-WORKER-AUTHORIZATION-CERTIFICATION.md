# M02 — API/Worker Authorization Certification

- `packages/tenancy/src/authorization.ts` default-deny record/field decisions: 8/8 tests pass (cross-tenant resource, missing permission, explicit deny, stale membership version, field denial, frozen audit decision).
- Live OIDC HTTP path: authorized request 200, forged token 401 (see OIDC report).
- Worker envelopes: installation-bound HMAC, replay/stale/revocation refusal, 6/6 tests.
- Existing verified tenant scope and UOW negatives preserved.
- Not executed: full concurrent cross-tenant HTTP/DB/Worker matrix, API-to-Outbox propagation at production-shaped scale — recorded as partial, not passed.
