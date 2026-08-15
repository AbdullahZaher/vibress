# Testing Strategy

## Test layers

### Unit tests

Pure domain rules and utilities.

### Integration tests

Real PostgreSQL/Redis where behavior depends on persistence or transactions.

### Contract tests

API schemas, plugin contracts, storage provider behavior.

### E2E tests

Full flows using Playwright.

### Security tests

Authentication, authorization, CSRF, SSRF, uploads, rate limits, webhook signatures.

### Performance tests

High-risk paths such as content listing, newsletter fan-out, uploads, and analytics aggregation.

## Repository layout

```text
tests/
├── e2e/
│   ├── admin/
│   ├── web/
│   ├── portal/
│   └── api/
├── integration/
├── security/
├── performance/
├── fixtures/
└── helpers/
```

## Minimum high-value E2E flows

1. Staff login
2. Create/edit/publish post
3. Scheduled publication
4. Media upload
5. Member registration/login
6. Subscription lifecycle
7. Newsletter send
8. Theme activation
9. Storage provider test
10. Plugin install/activate/deactivate

## CI philosophy

Use fast focused tests per change and run complete gates on merge/release.

Recommended gates:

- lint
- typecheck
- unit
- affected integration tests
- migration integrity
- dependency boundary checks
- build
- selected E2E
- dependency/security scanning
