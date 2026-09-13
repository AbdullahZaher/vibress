# Vibress GA Release Checklist

Use this operational checklist before tagging and deploying any production GA release.

---

## 1. Code & Verification Gates
- [x] All unit and integration tests pass: `pnpm vitest run` (135 files, 1,074 tests).
- [x] TypeScript typechecking clean across all 71 Nx targets: `pnpm typecheck`.
- [x] ESLint linting clean with zero warnings: `pnpm -r lint`.
- [x] Explicit `any` ceiling verified: `pnpm verify:explicit-any`.
- [x] Production builds complete without errors: `pnpm build`.
- [x] Clean Git working tree verified: `pnpm verify:clean-tree`.

---

## 2. Database & Migration Gates
- [x] All migrations in `packages/database/migrations` applied sequentially (0000 to 0025).
- [x] Migration journal `_journal.json` consistent with SQL migration files.
- [x] Fail-fast schema assertions verified in `assertDatabaseSchemaReady()`.
- [x] Zero destructive schema removals (all migrations are additive and rolling-safe).

---

## 3. Security & Access Gates
- [x] Zero hardcoded secrets or API keys in repository tracking.
- [x] `enforceProductionGuards()` verified in `@vibress/config`.
- [x] Rate limiting configured on staff login, password reset, search, and webhooks.
- [x] Security response headers active: CSP nonces, X-Content-Type, X-Frame, Referrer.
- [x] Cookie security flags: `HttpOnly; Secure; SameSite=Lax`.
- [x] Non-root execution verified in all Dockerfiles.

---

## 4. Operational & Disaster Recovery Gates
- [x] Physical backup script verified: `./scripts/backup.sh`.
- [x] Physical restore script verified with SHA-256 checksum check: `./scripts/restore.sh`.
- [x] Automated smoke test suite verified: `pnpm production:smoke`.
- [x] Health check probes verified (`/nginx-health`, `/health/live`, `/health/ready`, `/worker-health/ready`).
- [x] Rollback runbook documented.

---

## 5. Documentation & Release Notes
- [x] `CHANGELOG.md` updated with release notes and migration instructions.
- [x] `README.md` verified for quickstart and development instructions.
- [x] `SECURITY.md` and `CONTRIBUTING.md` published in repository root.
- [x] Self-hosting and production guides published in `docs/deployment/`.
