## Summary
<!-- Provide a brief, high-level summary of what this pull request introduces or fixes. -->

## Changes
<!-- Detail the specific changes made across packages or applications. -->
- 

## Why
<!-- What problem does this change solve, or what capability does it add? -->

## Testing
<!-- How was this verified? List unit tests, integration tests, manual checks, or browser verification. -->
- [ ] Unit & integration tests added / passing (`pnpm vitest run`)
- [ ] TypeScript check passing (`pnpm typecheck`)
- [ ] ESLint passing (`pnpm -r lint`)
- [ ] Build successful (`pnpm build`)

## Security Impact
<!-- Does this change modify authorization, permissions, authentication, crypto, or file handling? -->
- [ ] No security regressions identified
- [ ] Authorization / RBAC checks verified where applicable

## Database / Migration Impact
<!-- Does this PR add or modify database schemas or migrations? -->
- [ ] No database changes, OR:
- [ ] Migrations are additive and non-destructive
- [ ] Migration rollback and schema backward compatibility evaluated

## Breaking Changes
<!-- Are there any breaking changes to APIs, config options, or theme specifications? -->
- [ ] None (fully backwards-compatible)
- [ ] Yes (documented with migration guide below)

---

## Contributor Checklist
- [ ] I have read the [CONTRIBUTING.md](file:///Users/abdullahzaher/vibress/CONTRIBUTING.md) guide.
- [ ] All automated tests pass (`pnpm test`).
- [ ] Static analysis passes with zero errors (`pnpm typecheck && pnpm lint`).
- [ ] No secrets, keys, credentials, or development tokens are committed.
- [ ] Documentation has been updated to reflect these changes.
