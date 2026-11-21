# M02 — Redis/S3/Backup Installation Isolation

Command: `VIBRESS_M02_REDIS_CONFIRM=1 bash scripts/platform/m02/redis-acl-isolation-drill.sh`
Environment: disposable `redis:7-alpine` with real Redis ACL users `install_a`/`install_b`, prefix-scoped key patterns, default user disabled. This is stronger than separate DB numbers because credentials are different and key patterns are enforced by ACL.

| Assertion | Result |
| --- | --- |
| A/B write and read own keys | PASS |
| A read B / B read A | PASS NOPERM |
| A write B queue / B write A queue | PASS NOPERM |
| Default user disabled | PASS off |

Scope limits: S3-compatible credential-level IAM and backup/restore authority drills are **not yet executed**; they remain open M02-E14 items. Redis ACL isolation is logical, not OS/process isolation.
