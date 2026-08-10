# Release Checklist

## Code quality

- [ ] TypeScript passes
- [ ] Lint passes
- [ ] Dependency boundary checks pass
- [ ] No new circular dependencies
- [ ] No debug logging or hardcoded secrets

## Database

- [ ] New migrations are forward-only
- [ ] Released migrations were not modified
- [ ] Migration tested on empty database
- [ ] Upgrade tested from previous supported release
- [ ] Roll-forward recovery documented for risky migration

## Security

- [ ] Auth/permission tests pass
- [ ] Rate limits reviewed for new public endpoints
- [ ] Upload limits defined
- [ ] Outbound HTTP uses hardened SSRF-safe client
- [ ] Credentials encrypted
- [ ] Webhook signatures validated
- [ ] New HTML rendering sanitized as needed

## Async jobs

- [ ] Jobs are idempotent
- [ ] Retry policy defined
- [ ] Poison/failure behavior defined
- [ ] Duplicate events do not corrupt state

## API

- [ ] Request schema exists
- [ ] Response schema exists
- [ ] Stable error codes used
- [ ] Authorization enforced
- [ ] Backward compatibility reviewed

## Studio

- [ ] Document version compatibility maintained
- [ ] New cards have web renderer
- [ ] Email renderer behavior defined
- [ ] Migration added if node/card schema changed

## Storage

- [ ] Local provider still works
- [ ] S3-compatible provider contract tests pass
- [ ] Signed/direct upload path tested
- [ ] Public URL/CDN behavior verified

## Operations

- [ ] Build succeeds
- [ ] Health checks pass
- [ ] Required environment variables documented
- [ ] Backup implications reviewed
- [ ] Release notes prepared
