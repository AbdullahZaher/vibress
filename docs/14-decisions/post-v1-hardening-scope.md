# Post-v1 Hardening Scope

**Decision:** Execute the post-v1 hardening program on branch
`hardening/post-v1-reliability` before further major feature expansion.

**Reason:** The v1 codebase is feature-complete but the documented reliability
guarantees (transactions, durable events, typed configuration) are ahead of the
implementation. Reliability work must come before new product surface area.

## Scope

### P0 — Must fix before the architecture is internally hardened

- H1 Database transaction infrastructure (in progress).
- H2 Transactional outbox + durable domain events.
- H3 Typed configuration, fail-closed secrets.
- H4 API error/CORS/header hardening.
- H5 SSRF correctness.
- H6 Local media streaming/range safety.

### P1 — High-value production engineering

- H7 Complete or rationalize platform packages (config, queue, observability,
  testing, plugin-core, ui, i18n, files).
- H8 Type safety + structured errors.
- H9 Code decomposition.
- H10 Repository/toolchain hygiene.
- H11 Production deployment artifacts.
- H12 Observability/operations.

### P2 — Product/platform polish

- H13 UI/i18n/package rationalization.
- H14 License/governance/docs alignment.

## Final gate

- H15 Full hardening regression, failure drills, performance, restore.

## Explicitly out of scope

While P0 is incomplete, do not add: Gifts, ActivityPub, Donations, new payment
providers, new analytics backends, theme marketplace, advanced automation
builder. No microservices migration, no massive rewrite.

## Execution order

Reliability first, in this order:

1. prevent partial database state
2. prevent lost important events
3. deterministic fail-closed configuration
4. runtime security correctness
5. media resource behavior
6. centralized platform infrastructure
7. types and code organization
8. repository/toolchain
9. production deployment artifacts
10. observability and governance

## Status

- [ ] P0 complete
- [ ] P1 complete
- [ ] P2 complete
- [ ] H15 final gate passed