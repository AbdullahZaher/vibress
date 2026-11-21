# M02 — Backup/Restore Authority Isolation

Command: `VIBRESS_M02_BACKUP_CONFIRM=1 bash scripts/platform/m02/backup-restore-authority-drill.sh`
Disposable PG16 with two databases, distinct owner/restore/runtime roles, PUBLIC CONNECT revoked.

| Assertion | Result |
| --- | --- |
| SHA-256 backup digest | PASS |
| A/B read own data | PASS |
| A restore role cannot connect to B | PASS permission denied |
| A runtime role cannot connect to B | PASS permission denied |
| Authorized restore recovers A data | PASS |
| A backup did not leak into B | PASS 0 rows |
| Roles non-superuser / non-BYPASSRLS | PASS f|f |

8/8 PASS. No production backup system, credential or RPO/RTO claim.
